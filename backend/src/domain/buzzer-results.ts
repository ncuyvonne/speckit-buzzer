import type { ActivityState, FairRankingSettings } from './activity-state.js';
import type { GroupRoster } from './group-roster.js';
import type { SubAnswer } from '../guided-notes/types.js';
import { rankAcceptedAnswers } from './fair-ranking.js';

export interface AcceptedSubmissionFields {
  readonly groupId: string;
  readonly questionId: string;
  readonly acceptedOrder: number;
  readonly receivedAtMs: number;
  readonly priorWinCountSnapshot: number;
  readonly effectiveAtMs: number;
  /** Compatibility aliases retained for existing internal consumers. */
  readonly receivedOrder: number;
  readonly acceptedAt: number;
  readonly locked: boolean;
}

export interface SingleAnswerSubmission extends AcceptedSubmissionFields {
  readonly kind?: 'SINGLE';
  readonly answerText: string;
}

export interface GroupAnswerSubmission extends AcceptedSubmissionFields {
  readonly kind: 'GROUP';
  readonly answers: readonly SubAnswer[];
  readonly answerText?: never;
}

export type AcceptedAnswerSubmission = SingleAnswerSubmission | GroupAnswerSubmission;

/** Legacy name retained for existing single-answer service callers. */
export type GroupSubmission = AcceptedAnswerSubmission;

export type BuzzerResultsErrorCode =
  | 'STAGE_CONFLICT'
  | 'GROUP_INVALID'
  | 'FAIR_RANKING_INVALID'
  | 'RESULTS_NOT_READY'
  | 'QUESTION_INVALID'
  | 'ANSWER_EMPTY'
  | 'ANSWER_LOCKED'
  | 'GROUP_ANSWER_INCOMPLETE'
  | 'GROUP_ANSWER_INVALID';

export type SubmitAnswerResult =
  | { readonly accepted: true; readonly submission: AcceptedAnswerSubmission }
  | { readonly accepted: false; readonly code: BuzzerResultsErrorCode; readonly message?: string };

export interface TeacherQuestionProgress {
  readonly questionId: string;
  readonly groups: readonly {
    readonly groupId: string;
    readonly submitted: boolean;
    readonly rank: number | null;
    readonly answerText: string | null;
    readonly answers?: readonly SubAnswer[] | null;
  }[];
  readonly winningGroupId: string | null;
  readonly winningAnswer: string | null;
  readonly winningAnswers?: readonly SubAnswer[] | null;
}

export interface TeacherProgress {
  readonly questions: readonly TeacherQuestionProgress[];
}

export interface StudentQuestionResult {
  readonly questionId: string;
  readonly winningGroupId: string | null;
  readonly winningAnswer: string | null;
  readonly ownAnswer: string | null;
  readonly ownAnswers?: readonly SubAnswer[] | null;
  readonly winningAnswers?: readonly SubAnswer[] | null;
  readonly ownStatus: 'SUBMITTED' | 'NOT_SUBMITTED';
  readonly ownGroupWon: boolean;
  readonly groups: readonly {
    readonly groupId: string;
    readonly submitted: boolean;
    readonly rank: number | null;
  }[];
}

export interface StudentResults {
  readonly questions: readonly StudentQuestionResult[];
}

export interface StudentOwnProgress {
  readonly questions: readonly {
    readonly questionId: string;
    readonly submitted: boolean;
    readonly answerText: string | null;
    readonly answers?: readonly SubAnswer[] | null;
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

export type FairRankingSettingsResult =
  | { readonly accepted: true; readonly settings: FairRankingSettings }
  | { readonly accepted: false; readonly code: 'STAGE_CONFLICT' | 'FAIR_RANKING_INVALID' };

function submissionKey(groupId: string, questionId: string): string {
  return JSON.stringify([groupId, questionId]);
}

/** Server-owned, in-memory answers for the current activity. */
export class BuzzerResultsService {
  readonly #activity: ActivityState;
  readonly #roster: GroupRoster;
  readonly #now: () => number;
  readonly #submissions = new Map<string, AcceptedAnswerSubmission>();
  #nextReceivedOrder = 1;

  constructor(options: BuzzerResultsServiceOptions) {
    this.#activity = options.activity;
    this.#roster = options.roster;
    this.#now = options.now ?? Date.now;
  }

  getFairRankingSettings(): FairRankingSettings {
    return this.#activity.fairRankingSettings;
  }

  setFairRankingSettings(settings: FairRankingSettings): FairRankingSettingsResult {
    if (this.#activity.stage !== 'PREPARING') return { accepted: false, code: 'STAGE_CONFLICT' };
    if (settings.enabled && (typeof settings.delaySeconds !== 'number'
      || !Number.isFinite(settings.delaySeconds)
      || settings.delaySeconds <= 0)) {
      return { accepted: false, code: 'FAIR_RANKING_INVALID' };
    }
    if (!settings.enabled && settings.delaySeconds !== null
      && (typeof settings.delaySeconds !== 'number'
        || !Number.isFinite(settings.delaySeconds)
        || settings.delaySeconds <= 0)) {
      return { accepted: false, code: 'FAIR_RANKING_INVALID' };
    }
    if (!this.#activity.setFairRankingSettings(settings)) return { accepted: false, code: 'FAIR_RANKING_INVALID' };
    return { accepted: true, settings: this.#activity.fairRankingSettings };
  }

  /**
   * The validation, unique-key check, insert, and winner assignment are kept
   * synchronous. The insert is the linearization point for concurrent sockets.
   */
  submitAnswer(groupId: string, questionId: string, answer: string | readonly SubAnswer[]): SubmitAnswerResult {
    if (this.#activity.stage !== 'BUZZING') return { accepted: false, code: 'STAGE_CONFLICT' };
    if (!this.#roster.has(groupId)) return { accepted: false, code: 'GROUP_INVALID' };
    const question = this.#activity.questions.find((item) => item.questionId === questionId);
    if (!question) {
      return { accepted: false, code: 'QUESTION_INVALID' };
    }

    let submissionFields: Pick<AcceptedAnswerSubmission, 'kind'> & Partial<AcceptedAnswerSubmission>;
    if (question.kind === 'GROUP') {
      if (typeof answer === 'string') {
        return { accepted: false, code: 'GROUP_ANSWER_INVALID', message: '此題需要完整的子題答案清單，請重新填寫。' };
      }
      const expectedCount = question.answerSlots.length;
      if (answer.length < expectedCount) {
        const present = new Set(answer.map((item) => item.placeholderNumber));
        const missing = question.answerSlots
          .filter((slot) => !present.has(slot.placeholderNumber))
          .map((slot) => slot.placeholderNumber);
        return {
          accepted: false,
          code: 'GROUP_ANSWER_INCOMPLETE',
          message: `題組「${questionId}」尚未填完${missing.length > 0 ? `，請補上第 ${missing.join('、')} 格答案` : ''}後再送出。`,
        };
      }
      const seen = new Set<number>();
      for (const item of answer) {
        if (!Number.isSafeInteger(item.placeholderNumber)
          || item.placeholderNumber < 1
          || item.placeholderNumber > expectedCount
          || seen.has(item.placeholderNumber)) {
          return {
            accepted: false,
            code: 'GROUP_ANSWER_INVALID',
            message: `題組「${questionId}」的子題編號必須各出現一次並依 1 到 ${expectedCount} 排列。`,
          };
        }
        seen.add(item.placeholderNumber);
        // ECMAScript trim() omits some Unicode White_Space characters (notably U+0085 NEL).
        if (!/\P{White_Space}/u.test(item.answerText)) {
          return {
            accepted: false,
            code: 'GROUP_ANSWER_INCOMPLETE',
            message: `題組「${questionId}」第 ${item.placeholderNumber} 格尚未填寫，請補上答案後再送出。`,
          };
        }
      }
      if (answer.length > expectedCount || answer.some((item, index) => item.placeholderNumber !== index + 1)) {
        return {
          accepted: false,
          code: 'GROUP_ANSWER_INVALID',
          message: `題組「${questionId}」的子題編號必須依 1 到 ${expectedCount} 排列，請檢查各格答案。`,
        };
      }
      submissionFields = {
        kind: 'GROUP',
        answers: Object.freeze(answer.map((item) => Object.freeze({ ...item }))),
      } as Pick<AcceptedAnswerSubmission, 'kind'> & Partial<AcceptedAnswerSubmission>;
    } else {
      if (typeof answer !== 'string') {
        return { accepted: false, code: 'GROUP_ANSWER_INVALID', message: '此題只接受一格答案，請重新送出。' };
      }
      // ECMAScript trim() omits some Unicode White_Space characters (notably U+0085 NEL).
      if (!/\P{White_Space}/u.test(answer)) return { accepted: false, code: 'ANSWER_EMPTY' };
      submissionFields = { kind: 'SINGLE', answerText: answer } as Pick<AcceptedAnswerSubmission, 'kind'> & Partial<AcceptedAnswerSubmission>;
    }

    const key = submissionKey(groupId, questionId);
    if (this.#submissions.has(key)) return { accepted: false, code: 'ANSWER_LOCKED' };

    const receivedAtMs = this.#now();
    const acceptedOrder = this.#nextReceivedOrder;
    const priorWinCountSnapshot = this.#countCurrentWins(groupId, questionId);
    const settings = this.#activity.fairRankingSettings;
    const delayMs = settings.enabled ? (settings.delaySeconds ?? 0) * 1_000 : 0;
    const effectiveAtMs = receivedAtMs + priorWinCountSnapshot * delayMs;
    const base = {
      groupId,
      questionId,
      acceptedOrder,
      receivedAtMs,
      priorWinCountSnapshot,
      effectiveAtMs,
      receivedOrder: acceptedOrder,
      acceptedAt: receivedAtMs,
      locked: true,
    };
    const submission = Object.freeze({ ...base, ...submissionFields }) as AcceptedAnswerSubmission;
    this.#nextReceivedOrder += 1;
    this.#submissions.set(key, submission);
    return { accepted: true, submission };
  }

  getSubmission(groupId: string, questionId: string): AcceptedAnswerSubmission | null {
    return this.#submissions.get(submissionKey(groupId, questionId)) ?? null;
  }

  getWinner(questionId: string): AcceptedAnswerSubmission | null {
    return this.#rankedSubmissions(questionId)[0]?.value ?? null;
  }

  #rankedSubmissions(questionId: string) {
    return rankAcceptedAnswers([...this.#submissions.values()].filter((submission) => submission.questionId === questionId));
  }

  #countCurrentWins(groupId: string, exceptQuestionId: string): number {
    let count = 0;
    for (const question of this.#activity.questions) {
      if (question.questionId !== exceptQuestionId && this.getWinner(question.questionId)?.groupId === groupId) count += 1;
    }
    return count;
  }

  getTeacherProgress(): TeacherProgress {
    return {
      questions: this.#activity.questions.map((question) => {
        const ranked = this.#rankedSubmissions(question.questionId);
        const ranks = new Map(ranked.map(({ value, rank }) => [value.groupId, rank]));
        const winner = ranked[0]?.value ?? null;
        return {
          questionId: question.questionId,
          groups: this.#roster.ids.map((groupId) => {
            const submission = this.#submissions.get(submissionKey(groupId, question.questionId)) ?? null;
            return {
              groupId,
              submitted: submission !== null,
              rank: ranks.get(groupId) ?? null,
              answerText: question.kind !== 'GROUP' && submission?.kind !== 'GROUP' ? submission?.answerText ?? null : null,
              ...(question.kind === 'GROUP'
                ? { answers: submission?.kind === 'GROUP' ? submission.answers : null }
                : {}),
            };
          }),
          winningGroupId: winner?.groupId ?? null,
          winningAnswer: winner && winner.kind !== 'GROUP' ? winner.answerText : null,
          ...(question.kind === 'GROUP' ? { winningAnswers: winner?.kind === 'GROUP' ? winner.answers : null } : {}),
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
          answerText: question.kind !== 'GROUP' && submission?.kind !== 'GROUP' ? submission?.answerText ?? null : null,
          ...(question.kind === 'GROUP'
            ? { answers: submission?.kind === 'GROUP' ? submission.answers : null }
            : {}),
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
        const ranked = this.#rankedSubmissions(question.questionId);
        const ranks = new Map(ranked.map(({ value, rank }) => [value.groupId, rank]));
        const winner = ranked[0]?.value ?? null;
        const ownSubmission = this.#submissions.get(submissionKey(groupId, question.questionId)) ?? null;
        return {
          questionId: question.questionId,
          groups: this.#roster.ids.map((configuredGroupId) => {
            const groupSubmission = this.#submissions.get(submissionKey(configuredGroupId, question.questionId)) ?? null;
            return { groupId: configuredGroupId, submitted: groupSubmission !== null, rank: ranks.get(configuredGroupId) ?? null };
          }),
          winningGroupId: winner?.groupId ?? null,
          winningAnswer: winner && winner.kind !== 'GROUP' ? winner.answerText : null,
          ...(question.kind === 'GROUP'
            ? { winningAnswers: winner?.kind === 'GROUP' ? winner.answers : null }
            : {}),
          ownAnswer: question.kind !== 'GROUP' && ownSubmission?.kind !== 'GROUP'
            ? ownSubmission?.answerText ?? null
            : null,
          ...(question.kind === 'GROUP'
            ? { ownAnswers: ownSubmission?.kind === 'GROUP' ? ownSubmission.answers : null }
            : {}),
          ownStatus: ownSubmission ? 'SUBMITTED' : 'NOT_SUBMITTED',
          ownGroupWon: winner?.groupId === groupId,
        };
      }),
    };
  }
}
