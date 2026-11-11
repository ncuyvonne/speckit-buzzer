import { ActivityStore } from '../state/activity';
import { BuzzerResultsStore, type OwnQuestionProgress } from '../state/buzzer-results';
import { StudentSelection } from '../state/student-selection';
import type {
  ActivityStage, ClientMessage, ErrorCode, GuidedNotesErrorCode, StudentResults, TeacherProgress,
} from './messages';

const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;

interface LocationLike {
  readonly protocol: string;
  readonly host: string;
}

export interface RealtimeClientOptions {
  readonly store?: ActivityStore;
  readonly buzzerResultsStore?: BuzzerResultsStore;
  readonly studentSelection?: StudentSelection;
  readonly location?: LocationLike;
  readonly createSocket?: (url: string) => WebSocket;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function isActivityStage(value: unknown): value is ActivityStage {
  return value === 'PREPARING' || value === 'BUZZING' || value === 'ENDED';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isTeacherProgress(value: unknown): value is TeacherProgress {
  if (!isRecord(value) || !Array.isArray(value.questions)) return false;
  return value.questions.every((question) => isRecord(question)
    && typeof question.questionId === 'string'
    && Array.isArray(question.groups)
    && question.groups.every((group) => isRecord(group)
      && typeof group.groupId === 'string'
      && typeof group.submitted === 'boolean'
      && (typeof group.answerText === 'string' || group.answerText === null))
    && (typeof question.winningGroupId === 'string' || question.winningGroupId === null)
    && (typeof question.winningAnswer === 'string' || question.winningAnswer === null));
}

function isStudentResults(value: unknown): value is StudentResults {
  if (!isRecord(value) || !Array.isArray(value.questions)) return false;
  return value.questions.every((question) => isRecord(question)
    && typeof question.questionId === 'string'
    && (typeof question.winningGroupId === 'string' || question.winningGroupId === null)
    && (typeof question.winningAnswer === 'string' || question.winningAnswer === null)
    && (typeof question.ownAnswer === 'string' || question.ownAnswer === null)
    && (question.ownStatus === 'SUBMITTED' || question.ownStatus === 'NOT_SUBMITTED')
    && typeof question.ownGroupWon === 'boolean');
}

const GUIDED_NOTES_ERROR_CODES = new Set<string>([
  'GUIDED_NOTES_BUSY',
  'SHEETS_NOT_CONFIGURED',
  'SHEET_REFERENCE_INVALID',
  'SHEET_ACCESS_DENIED',
  'SHEET_NOT_FOUND',
  'SHEET_LAYOUT_INVALID',
  'QUESTION_IDS_INVALID',
  'SHEET_READ_FAILED',
  'WORKSHEET_NOT_IMPORTED',
  'WINNING_RESULTS_UNAVAILABLE',
  'QUESTION_TARGET_INVALID',
  'SHEET_WRITE_FAILED',
  'SHEET_WRITE_UNCONFIRMED',
]);

export class RealtimeClient {
  readonly store: ActivityStore;
  readonly buzzerResults: BuzzerResultsStore;
  readonly #location: LocationLike;
  readonly #createSocket: (url: string) => WebSocket;
  readonly #studentSelection: StudentSelection;
  #socket: WebSocket | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempt = 0;
  #stopped = true;
  #awaitingInitialSnapshot = false;
  readonly #pendingBuzzerRequests = new Map<string, { questionId: string; answerText: string }>();

  constructor(options: RealtimeClientOptions = {}) {
    this.store = options.store ?? new ActivityStore();
    this.buzzerResults = options.buzzerResultsStore ?? new BuzzerResultsStore();
    this.#studentSelection = options.studentSelection ?? new StudentSelection();
    this.#location = options.location ?? window.location;
    this.#createSocket = options.createSocket ?? ((url) => new WebSocket(url));
  }

  connect(): void {
    if (this.#socket && (this.#socket.readyState === WebSocket.CONNECTING || this.#socket.readyState === WebSocket.OPEN)) {
      return;
    }
    this.#stopped = false;
    this.#reconnectAttempt = 0;
    this.#openSocket(false);
  }

  reconnect(): void {
    this.#stopped = true;
    this.#clearReconnectTimer();
    const previous = this.#socket;
    this.#socket = null;
    if (previous && previous.readyState < WebSocket.CLOSING) previous.close();
    this.#stopped = false;
    this.#reconnectAttempt = 0;
    this.#openSocket(false);
  }

  disconnect(): void {
    this.#stopped = true;
    this.#clearReconnectTimer();
    const previous = this.#socket;
    this.#socket = null;
    if (previous && previous.readyState < WebSocket.CLOSING) previous.close();
    this.store.update({ connection: 'disconnected', canReconnect: false });
    this.store.resetConnectionRole();
  }

  authenticate(password: string): boolean {
    return this.#send({ type: 'teacher.authenticate', requestId: createRequestId(), payload: { password } });
  }

  join(groupId: string): boolean {
    return this.#send({ type: 'student.join', requestId: createRequestId(), payload: { groupId } });
  }

  submitAnswer(questionId: string, answerText: string): boolean {
    const requestId = createRequestId();
    const sent = this.#send({
      type: 'buzzerResults.submitAnswer',
      requestId,
      payload: { questionId, answerText },
    });
    if (sent) {
      this.#pendingBuzzerRequests.set(requestId, { questionId, answerText });
      this.buzzerResults.clearError();
    }
    return sent;
  }

  getTeacherProgress(): boolean {
    return this.#send({ type: 'buzzerResults.getTeacherProgress', requestId: createRequestId(), payload: {} });
  }

  getStudentResults(): boolean {
    return this.#send({ type: 'buzzerResults.getStudentResults', requestId: createRequestId(), payload: {} });
  }

  advance(from: ActivityStage, to: ActivityStage): boolean {
    return this.#send({ type: 'activity.advance', requestId: createRequestId(), payload: { from, to } });
  }

  importWorksheet(spreadsheetUrl: string, worksheetTitle: string): boolean {
    const sent = this.#send({
      type: 'guidedNotes.import',
      requestId: createRequestId(),
      payload: { spreadsheetUrl, worksheetTitle },
    });
    if (sent) this.store.update({ guidedNotesBusy: true, guidedNotesError: null });
    return sent;
  }

  exportAnswers(): boolean {
    const sent = this.#send({
      type: 'guidedNotes.export',
      requestId: createRequestId(),
      payload: {},
    });
    if (sent) {
      this.store.update({
        guidedNotesBusy: true,
        guidedNotesError: null,
        guidedNotesExportResult: null,
      });
    }
    return sent;
  }

  #url(): string {
    const scheme = this.#location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${this.#location.host}/ws`;
  }

  #send(message: ClientMessage): boolean {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) return false;
    this.#socket.send(JSON.stringify(message));
    return true;
  }

  #openSocket(isRetry: boolean): void {
    this.#awaitingInitialSnapshot = true;
    this.store.update({
      connection: isRetry ? 'reconnecting' : 'connecting',
      connectionMessage: null,
      canReconnect: false,
    });
    this.store.resetConnectionRole();

    const socket = this.#createSocket(this.#url());
    this.#socket = socket;
    socket.addEventListener('open', () => {
      if (this.#socket !== socket) return;
      this.#reconnectAttempt = 0;
      this.store.update({ connection: 'connected', connectionMessage: null, canReconnect: false });
      this.store.resetConnectionRole();
    });
    socket.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (this.#socket === socket) this.#handleMessage(event.data);
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#pendingBuzzerRequests.clear();
      this.store.resetConnectionRole();
      if (this.#stopped) {
        this.store.update({ connection: 'disconnected' });
        return;
      }
      if (event.code === 1009) {
        this.store.update({
          connection: 'disconnected',
          connectionMessage: '連線訊息超過 16 KiB 上限。請確認操作資料後，按「重新連線」再試一次。',
          canReconnect: true,
        });
        return;
      }
      this.#scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      // The close event drives bounded reconnect; no raw network details are shown.
    });
  }

  #handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let message: unknown;
    try {
      message = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
    if (!isRecord(message) || typeof message.type !== 'string' || !isRecord(message.payload)) return;
    const payload = message.payload;

    if (message.type === 'buzzerResults.questionList'
      && this.store.getSnapshot().role === 'STUDENT'
      && isStringArray(payload.questionIds)) {
      this.buzzerResults.applyQuestionList(payload.questionIds);
      return;
    }
    if (message.type === 'buzzerResults.teacherProgress') {
      if (this.store.getSnapshot().role === 'TEACHER' && isTeacherProgress(payload)) {
        this.buzzerResults.applyTeacherProgress(payload);
      }
      return;
    }
    if (message.type === 'buzzerResults.ownProgress'
      && this.store.getSnapshot().role === 'STUDENT'
      && Array.isArray(payload.questions)) {
      const questions = payload.questions.filter((item): item is Record<string, unknown> => isRecord(item));
      if (questions.every((item) => typeof item.questionId === 'string'
        && typeof item.submitted === 'boolean'
        && (typeof item.answerText === 'string' || item.answerText === null)
        && typeof item.locked === 'boolean')) {
        this.buzzerResults.applyOwnProgress(questions as unknown as OwnQuestionProgress[]);
      }
      return;
    }
    if (message.type === 'buzzerResults.studentResults') {
      if (this.store.getSnapshot().role === 'STUDENT' && isStudentResults(payload)) {
        this.buzzerResults.applyStudentResults(payload);
      }
      return;
    }
    if (message.type === 'buzzerResults.submitted'
      && typeof message.requestId === 'string'
      && typeof payload.questionId === 'string'
      && payload.accepted === true
      && payload.locked === true) {
      const pending = this.#pendingBuzzerRequests.get(message.requestId);
      if (pending && pending.questionId === payload.questionId) {
        this.buzzerResults.applyAccepted(pending.questionId, pending.answerText);
        this.#pendingBuzzerRequests.delete(message.requestId);
      }
      return;
    }

    if (message.type === 'activity.snapshot' && isActivityStage(payload.stage) && Array.isArray(payload.groups) &&
      payload.groups.every((group) => typeof group === 'string')) {
      this.store.applySnapshot(payload.stage, payload.groups);
      if (this.#awaitingInitialSnapshot) {
        this.#awaitingInitialSnapshot = false;
        const savedGroupId = this.#studentSelection.read();
        if (savedGroupId !== null && this.store.getSnapshot().role !== 'TEACHER') {
          this.#send({ type: 'student.join', requestId: createRequestId(), payload: { groupId: savedGroupId } });
        }
      }
      if (payload.stage === 'ENDED' && this.store.getSnapshot().role === 'STUDENT') this.getStudentResults();
      return;
    }
    if (message.type === 'activity.phaseChanged' && isActivityStage(payload.stage)) {
      this.store.update({
        stage: payload.stage,
        ...(this.store.getSnapshot().serverError?.code === 'STAGE_CONFLICT' ? { serverError: null } : {}),
      });
      if (payload.stage === 'ENDED' && this.store.getSnapshot().role === 'STUDENT') this.getStudentResults();
      return;
    }
    if (
      message.type === 'guidedNotes.snapshot'
      && (payload.worksheetTitle === null || typeof payload.worksheetTitle === 'string')
      && isStringArray(payload.questionIds)
      && typeof payload.questionCount === 'number'
      && payload.questionCount === payload.questionIds.length
    ) {
      this.store.applyGuidedNotesSnapshot(payload.worksheetTitle, payload.questionIds);
      return;
    }
    if (
      message.type === 'guidedNotes.imported'
      && typeof payload.worksheetTitle === 'string'
      && isStringArray(payload.questionIds)
      && typeof payload.questionCount === 'number'
      && payload.questionCount === payload.questionIds.length
    ) {
      this.store.applyGuidedNotesImport(payload.worksheetTitle, payload.questionIds);
      return;
    }
    if (
      message.type === 'guidedNotes.exported'
      && Number.isSafeInteger(payload.writtenCellCount)
      && Number(payload.writtenCellCount) >= 0
      && Number.isSafeInteger(payload.clearedCellCount)
      && Number(payload.clearedCellCount) >= 0
    ) {
      this.store.applyGuidedNotesExport(Number(payload.writtenCellCount), Number(payload.clearedCellCount));
      return;
    }
    if (message.type === 'teacher.authenticated' && payload.ok === true) {
      this.store.update({ role: 'TEACHER', serverError: null });
      return;
    }
    if (message.type === 'student.joined' && payload.ok === true && typeof payload.groupId === 'string') {
      this.#studentSelection.save(payload.groupId);
      this.store.update({ role: 'STUDENT', selectedGroupId: payload.groupId, serverError: null });
      return;
    }
    if (message.type === 'error' && typeof payload.code === 'string' && typeof payload.message === 'string') {
      const requestId = typeof message.requestId === 'string' ? message.requestId : null;
      const pending = requestId === null ? undefined : this.#pendingBuzzerRequests.get(requestId);
      if (requestId !== null && pending) {
        this.buzzerResults.applyError(payload.code as ErrorCode, payload.message, pending.questionId);
        this.#pendingBuzzerRequests.delete(requestId);
      }
      if (payload.code === 'GROUP_INVALID' && this.store.getSnapshot().role !== 'STUDENT') {
        this.#studentSelection.clear();
        this.store.update({ role: 'UNAUTHENTICATED', selectedGroupId: null });
      }
      if (payload.code === 'AUTH_REQUIRED' && this.store.getSnapshot().role === 'TEACHER') {
        this.store.update({ role: 'UNAUTHENTICATED', selectedGroupId: null });
      }
      this.store.update({
        serverError: { code: payload.code as ErrorCode, message: payload.message },
        ...(GUIDED_NOTES_ERROR_CODES.has(payload.code)
          ? {
              guidedNotesBusy: false,
              guidedNotesError: { code: payload.code as GuidedNotesErrorCode, message: payload.message },
              guidedNotesExportResult: null,
            }
          : {}),
      });
    }
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#reconnectTimer) return;
    const delay = RECONNECT_BACKOFF_MS[Math.min(this.#reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
    this.#reconnectAttempt += 1;
    this.store.update({ connection: 'reconnecting' });
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (!this.#stopped && !this.#socket) this.#openSocket(true);
    }, delay);
  }

  #clearReconnectTimer(): void {
    if (!this.#reconnectTimer) return;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
  }
}
