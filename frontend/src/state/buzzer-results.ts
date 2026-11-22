import type { ErrorCode, FairRankingSettings, ScoreboardEntry, StudentResults, SubmitAnswerPayload, SubAnswer, TeacherProgress } from '../realtime/messages';

export function validateFairRankingDelay(value: string): string | null {
  if (value.trim().length === 0) return '請輸入 1 到 30 秒之間的有效延遲。';
  const delaySeconds = Number(value);
  return Number.isFinite(delaySeconds) && delaySeconds >= 1 && delaySeconds <= 30
    ? null
    : '請輸入 1 到 30 秒之間的有效延遲。';
}
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
  readonly fairRankingSettings: FairRankingSettings;
  readonly csvExport: {
    readonly status: 'idle' | 'pending' | 'downloaded' | 'error';
    readonly fileName: string | null;
    readonly message: string | null;
  };
  readonly scoreboard: readonly ScoreboardEntry[] | null;
  readonly submittedCount: number;
  readonly totalQuestionCount: number;
}

const INITIAL_STATE: BuzzerResultsViewState = Object.freeze({
  questionIds: Object.freeze([]),
  ownProgress: Object.freeze([]),
  acceptedSubmission: null,
  error: null,
  teacherProgress: null,
  studentResults: null,
  fairRankingSettings: Object.freeze({ enabled: false, delaySeconds: null }),
  csvExport: Object.freeze({ status: 'idle', fileName: null, message: null }),
  scoreboard: null,
  submittedCount: 0,
  totalQuestionCount: 0,
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
      totalQuestionCount: ids.length,
      ownProgress: Object.freeze(this.#state.ownProgress.filter((entry) => validIds.has(entry.questionId))),
      error: null,
    });
  }

  applyOwnProgress(questions: readonly OwnQuestionProgress[], submittedCount: number, totalQuestionCount: number): void {
    this.#update({
      ownProgress: Object.freeze(questions.map((item) => Object.freeze({ ...item }))),
      submittedCount,
      totalQuestionCount,
    });
  }

  applyAccepted(questionId: string, answer: string | readonly SubAnswer[]): void {
    const isNewSubmission = !this.#state.ownProgress.some((item) => item.questionId === questionId && item.submitted);
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
    this.#update({
      acceptedSubmission: Object.freeze(acceptedSubmission), error: null,
      ...(isNewSubmission ? { submittedCount: Math.min(this.#state.totalQuestionCount, this.#state.submittedCount + 1) } : {}),
    });
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

  applyFairRankingSettings(settings: FairRankingSettings): void {
    this.#update({ fairRankingSettings: Object.freeze({ ...settings }) });
  }

  beginCsvExport(): void {
    this.#update({ csvExport: Object.freeze({ status: 'pending', fileName: null, message: null }) });
  }

  completeCsvExport(fileName: string): void {
    this.#update({ csvExport: Object.freeze({ status: 'downloaded', fileName, message: null }) });
  }

  failCsvExport(message: string): void {
    this.#update({ csvExport: Object.freeze({ status: 'error', fileName: null, message }) });
  }

  applyScoreboard(entries: readonly ScoreboardEntry[]): void {
    this.#update({ scoreboard: Object.freeze(entries.map((entry) => Object.freeze({ ...entry }))) });
  }

  clearSession(): void {
    this.#update({
      ownProgress: Object.freeze([]),
      acceptedSubmission: null,
      error: null,
      teacherProgress: null,
      studentResults: null,
      scoreboard: null,
      csvExport: Object.freeze({ status: 'idle', fileName: null, message: null }),
      submittedCount: 0,
    });
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
