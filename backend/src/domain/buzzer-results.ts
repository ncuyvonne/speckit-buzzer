import type { ActivityState } from './activity-state.js';
import type { GroupRoster } from './group-roster.js';

export interface GroupSubmission {
  readonly groupId: string;
  readonly questionId: string;
  readonly answerText: string;
  readonly receivedOrder: number;
  readonly acceptedAt: number;
  readonly locked: boolean;
}

export type BuzzerResultsErrorCode =
  | 'STAGE_CONFLICT'
  | 'GROUP_INVALID'
  | 'QUESTION_INVALID'
  | 'ANSWER_EMPTY'
  | 'ANSWER_LOCKED';

export type SubmitAnswerResult =
  | { readonly accepted: true; readonly submission: GroupSubmission }
  | { readonly accepted: false; readonly code: BuzzerResultsErrorCode };

export interface TeacherQuestionProgress {
  readonly questionId: string;
  readonly groups: readonly {
    readonly groupId: string;
    readonly submitted: boolean;
    readonly answerText: string | null;
  }[];
  readonly winningGroupId: string | null;
  readonly winningAnswer: string | null;
}

export interface TeacherProgress {
  readonly questions: readonly TeacherQuestionProgress[];
}

export interface StudentQuestionResult {
  readonly questionId: string;
  readonly winningGroupId: string | null;
  readonly winningAnswer: string | null;
  readonly ownAnswer: string | null;
  readonly ownStatus: 'SUBMITTED' | 'NOT_SUBMITTED';
  readonly ownGroupWon: boolean;
}

export interface StudentResults {
  readonly questions: readonly StudentQuestionResult[];
}

export interface StudentOwnProgress {
  readonly questions: readonly {
    readonly questionId: string;
    readonly submitted: boolean;
    readonly answerText: string | null;
    readonly locked: boolean;
  }[];
}

export class BuzzerResultsQueryError extends Error {
  constructor(readonly code: 'STAGE_CONFLICT' | 'GROUP_INVALID') {
    super(code);
    this.name = 'BuzzerResultsQueryError';
  }
}

export interface BuzzerResultsServiceOptions {
  readonly activity: ActivityState;
  readonly roster: GroupRoster;
  readonly now?: () => number;
}

function submissionKey(groupId: string, questionId: string): string {
  return JSON.stringify([groupId, questionId]);
}

/** Server-owned, in-memory answers for the current activity. */
export class BuzzerResultsService {
  readonly #activity: ActivityState;
  readonly #roster: GroupRoster;
  readonly #now: () => number;
  readonly #submissions = new Map<string, GroupSubmission>();
  readonly #winners = new Map<string, GroupSubmission>();
  #nextReceivedOrder = 1;

  constructor(options: BuzzerResultsServiceOptions) {
    this.#activity = options.activity;
    this.#roster = options.roster;
    this.#now = options.now ?? Date.now;
  }

  /**
   * The validation, unique-key check, insert, and winner assignment are kept
   * synchronous. The insert is the linearization point for concurrent sockets.
   */
  submitAnswer(groupId: string, questionId: string, answerText: string): SubmitAnswerResult {
    if (this.#activity.stage !== 'BUZZING') return { accepted: false, code: 'STAGE_CONFLICT' };
    if (!this.#roster.has(groupId)) return { accepted: false, code: 'GROUP_INVALID' };
    if (!this.#activity.questions.some((question) => question.questionId === questionId)) {
      return { accepted: false, code: 'QUESTION_INVALID' };
    }
    if (answerText.trim().length === 0) return { accepted: false, code: 'ANSWER_EMPTY' };

    const key = submissionKey(groupId, questionId);
    if (this.#submissions.has(key)) return { accepted: false, code: 'ANSWER_LOCKED' };

    const submission: GroupSubmission = Object.freeze({
      groupId,
      questionId,
      answerText,
      receivedOrder: this.#nextReceivedOrder,
      acceptedAt: this.#now(),
      locked: true,
    });
    this.#nextReceivedOrder += 1;
    this.#submissions.set(key, submission);
    if (!this.#winners.has(questionId)) this.#winners.set(questionId, submission);
    return { accepted: true, submission };
  }

  getSubmission(groupId: string, questionId: string): GroupSubmission | null {
    return this.#submissions.get(submissionKey(groupId, questionId)) ?? null;
  }

  getWinner(questionId: string): GroupSubmission | null {
    return this.#winners.get(questionId) ?? null;
  }

  getTeacherProgress(): TeacherProgress {
    return {
      questions: this.#activity.questions.map((question) => {
        const winner = this.#winners.get(question.questionId) ?? null;
        return {
          questionId: question.questionId,
          groups: this.#roster.ids.map((groupId) => {
            const submission = this.#submissions.get(submissionKey(groupId, question.questionId)) ?? null;
            return {
              groupId,
              submitted: submission !== null,
              answerText: submission?.answerText ?? null,
            };
          }),
          winningGroupId: winner?.groupId ?? null,
          winningAnswer: winner?.answerText ?? null,
        };
      }),
    };
  }

  getOwnProgress(groupId: string): StudentOwnProgress {
    if (!this.#roster.has(groupId)) throw new BuzzerResultsQueryError('GROUP_INVALID');
    return {
      questions: this.#activity.questions.map((question) => {
        const submission = this.#submissions.get(submissionKey(groupId, question.questionId)) ?? null;
        return {
          questionId: question.questionId,
          submitted: submission !== null,
          answerText: submission?.answerText ?? null,
          locked: submission?.locked ?? false,
        };
      }),
    };
  }

  getStudentResults(groupId: string): StudentResults {
    if (this.#activity.stage !== 'ENDED') throw new BuzzerResultsQueryError('STAGE_CONFLICT');
    if (!this.#roster.has(groupId)) throw new BuzzerResultsQueryError('GROUP_INVALID');
    return {
      questions: this.#activity.questions.map((question) => {
        const winner = this.#winners.get(question.questionId) ?? null;
        const ownSubmission = this.#submissions.get(submissionKey(groupId, question.questionId)) ?? null;
        return {
          questionId: question.questionId,
          winningGroupId: winner?.groupId ?? null,
          winningAnswer: winner?.answerText ?? null,
          ownAnswer: ownSubmission?.answerText ?? null,
          ownStatus: ownSubmission ? 'SUBMITTED' : 'NOT_SUBMITTED',
          ownGroupWon: winner?.groupId === groupId,
        };
      }),
    };
  }
}
