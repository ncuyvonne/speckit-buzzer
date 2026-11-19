import type { ErrorCode, StudentResults, SubmitAnswerPayload, SubAnswer, TeacherProgress } from '../realtime/messages';

export interface OwnQuestionProgress {
  readonly questionId: string;
  readonly submitted: boolean;
  readonly answerText: string | null;
  readonly answers?: readonly SubAnswer[] | null;
  readonly locked: boolean;
}

export interface BuzzerResultsViewState {
  readonly questionIds: readonly string[];
  readonly ownProgress: readonly OwnQuestionProgress[];
  readonly acceptedSubmission: SubmitAnswerPayload | null;
  readonly error: { readonly code: ErrorCode; readonly message: string; readonly questionId: string | null } | null;
  readonly teacherProgress: TeacherProgress | null;
  readonly studentResults: StudentResults | null;
}

const INITIAL_STATE: BuzzerResultsViewState = Object.freeze({
  questionIds: Object.freeze([]),
  ownProgress: Object.freeze([]),
  acceptedSubmission: null,
  error: null,
  teacherProgress: null,
  studentResults: null,
});

export class BuzzerResultsStore {
  #state: BuzzerResultsViewState = INITIAL_STATE;
  readonly #listeners = new Set<() => void>();

  getSnapshot = (): BuzzerResultsViewState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  applyQuestionList(questionIds: readonly string[]): void {
    const ids = Object.freeze([...questionIds]);
    const validIds = new Set(ids);
    this.#update({
      questionIds: ids,
      ownProgress: Object.freeze(this.#state.ownProgress.filter((entry) => validIds.has(entry.questionId))),
      error: null,
    });
  }

  applyOwnProgress(questions: readonly OwnQuestionProgress[]): void {
    this.#update({ ownProgress: Object.freeze(questions.map((item) => Object.freeze({ ...item }))) });
  }

  applyAccepted(questionId: string, answer: string | readonly SubAnswer[]): void {
    const acceptedSubmission: SubmitAnswerPayload = typeof answer === 'string'
      ? { questionId, answerText: answer }
      : { questionId, subAnswers: Object.freeze(answer.map((item) => Object.freeze({ ...item }))) };
    this.#setProgress(questionId, {
      questionId,
      submitted: true,
      answerText: typeof answer === 'string' ? answer : null,
      ...(typeof answer === 'string' ? {} : { answers: acceptedSubmission.subAnswers }),
      locked: true,
    });
    this.#update({ acceptedSubmission: Object.freeze(acceptedSubmission), error: null });
  }

  applyError(code: ErrorCode, message: string, questionId: string | null): void {
    if (code === 'ANSWER_LOCKED' && questionId !== null) {
      this.#setProgress(questionId, { questionId, submitted: true, answerText: null, locked: true });
    }
    this.#update({ error: Object.freeze({ code, message, questionId }) });
  }

  clearError(): void {
    if (this.#state.error !== null) this.#update({ error: null });
  }

  applyTeacherProgress(progress: TeacherProgress): void {
    this.#update({ teacherProgress: Object.freeze(progress) });
  }

  applyStudentResults(results: StudentResults): void {
    this.#update({ studentResults: Object.freeze(results) });
  }

  #setProgress(questionId: string, item: OwnQuestionProgress): void {
    const next = this.#state.ownProgress.filter((entry) => entry.questionId !== questionId);
    next.push(Object.freeze(item));
    const questionOrder = new Map(this.#state.questionIds.map((id, index) => [id, index]));
    next.sort((a, b) => (questionOrder.get(a.questionId) ?? Number.MAX_SAFE_INTEGER) - (questionOrder.get(b.questionId) ?? Number.MAX_SAFE_INTEGER));
    this.#update({ ownProgress: Object.freeze(next) });
  }

  #update(patch: Partial<BuzzerResultsViewState>): void {
    this.#state = Object.freeze({ ...this.#state, ...patch });
    for (const listener of this.#listeners) listener();
  }
}
