import { ActivityStore } from '../state/activity';
import { BuzzerResultsStore, type OwnQuestionProgress } from '../state/buzzer-results';
import { StudentSelection } from '../state/student-selection';
import type {
  ActivityStage,
  ClientMessage,
  ErrorCode,
  FairRankingSettings,
  GuidedNotesErrorCode,
  QuestionLayoutSummary,
  SubmitAnswerPayload,
  SubAnswer,
  StudentResults,
  TeacherProgress,
} from './messages';

const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;
const MAX_MESSAGE_BYTES = 16_384;

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
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isActivityStage(value: unknown): value is ActivityStage {
  return value === 'PREPARING' || value === 'BUZZING' || value === 'ENDED';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isSubAnswerArray(value: unknown): value is readonly SubAnswer[] {
  return Array.isArray(value) && value.every((answer) => isRecord(answer)
    && Number.isSafeInteger(answer.placeholderNumber)
    && typeof answer.answerText === 'string'
    && Object.keys(answer).every((key) => key === 'placeholderNumber' || key === 'answerText'));
}

function hasValidOptionalSubAnswers(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || value[key] === null || isSubAnswerArray(value[key]);
}

function isValidNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isFairRankingSettings(value: unknown): value is FairRankingSettings {
  return isRecord(value)
    && typeof value.enabled === 'boolean'
    && (value.delaySeconds === null || (typeof value.delaySeconds === 'number' && Number.isFinite(value.delaySeconds)));
}

function isRankedGroups(value: unknown): value is Array<Record<string, unknown> & {
  groupId: string; submitted: boolean; rank: number | null;
}> {
  if (!Array.isArray(value) || !value.every((group) => isRecord(group)
    && typeof group.groupId === 'string'
    && typeof group.submitted === 'boolean'
    && (group.rank === null || (Number.isSafeInteger(group.rank) && Number(group.rank) > 0))
    && (group.submitted ? group.rank !== null : group.rank === null))) return false;
  const ranks = value.map((group) => (group as Record<string, unknown>).rank)
    .filter((rank): rank is number => typeof rank === 'number')
    .sort((left, right) => left - right);
  return ranks.every((rank, index) => rank === index + 1);
}

function questionLayoutsFor(
  questionIds: readonly string[],
  value: unknown,
): readonly QuestionLayoutSummary[] | null {
  if (value === undefined) {
    return questionIds.map((questionId) => ({ questionId, kind: 'SINGLE', answerCount: 1 }));
  }
  if (!Array.isArray(value) || value.length !== questionIds.length) return null;
  const layouts: QuestionLayoutSummary[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const layout = value[index];
    if (!isRecord(layout)
      || typeof layout.questionId !== 'string'
      || layout.questionId !== questionIds[index]
      || (layout.kind !== 'SINGLE' && layout.kind !== 'GROUP')
      || typeof layout.answerCount !== 'number'
      || !Number.isSafeInteger(layout.answerCount)) return null;
    if ((layout.kind === 'SINGLE' && layout.answerCount !== 1)
      || (layout.kind === 'GROUP' && (layout.answerCount < 2 || layout.answerCount > 20))) return null;
    layouts.push({
      questionId: layout.questionId,
      kind: layout.kind,
      answerCount: layout.answerCount as number,
    });
  }
  return layouts;
}

function isTeacherProgress(value: unknown): value is TeacherProgress {
  if (!isRecord(value) || !Array.isArray(value.questions)) return false;
  return value.questions.every((question) => isRecord(question)
    && typeof question.questionId === 'string'
    && Array.isArray(question.groups)
    && isRankedGroups(question.groups)
    && question.groups.every((group) => isRecord(group)
      && isValidNullableString(group.answerText)
      && hasValidOptionalSubAnswers(group, 'answers'))
    && (typeof question.winningGroupId === 'string' || question.winningGroupId === null)
    && (question.groups.find((group) => group.rank === 1)?.groupId ?? null) === question.winningGroupId
    && isValidNullableString(question.winningAnswer)
    && hasValidOptionalSubAnswers(question, 'winningAnswers'));
}

function isStudentResults(value: unknown): value is StudentResults {
  if (!isRecord(value) || !Array.isArray(value.questions)) return false;
  return value.questions.every((question) => isRecord(question)
    && typeof question.questionId === 'string'
    && isRankedGroups(question.groups)
    && (typeof question.winningGroupId === 'string' || question.winningGroupId === null)
    && isValidNullableString(question.winningAnswer)
    && hasValidOptionalSubAnswers(question, 'winningAnswers')
    && isValidNullableString(question.ownAnswer)
    && hasValidOptionalSubAnswers(question, 'ownAnswers')
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
  'WORKSHEET_ALREADY_EXPORTED',
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
  readonly #pendingBuzzerRequests = new Map<string, { questionId: string; payload: SubmitAnswerPayload }>();
  readonly #pendingCsvExportRequests = new Set<string>();

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

  submitAnswer(questionId: string, answer: string | readonly SubAnswer[]): boolean {
    const requestId = createRequestId();
    const payload: SubmitAnswerPayload = typeof answer === 'string'
      ? { questionId, answerText: answer }
      : { questionId, subAnswers: answer.map((item) => ({ ...item })) };
    const message: ClientMessage = {
      type: 'buzzerResults.submitAnswer',
      requestId,
      payload,
    };
    const serialized = JSON.stringify(message);
    if (new TextEncoder().encode(serialized).byteLength > MAX_MESSAGE_BYTES) {
      this.buzzerResults.applyError(
        'INVALID_MESSAGE',
        '本題答案超過 16 KiB 傳輸上限。請縮短答案後再送出；草稿仍保留。',
        questionId,
      );
      return false;
    }
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) return false;
    this.#socket.send(serialized);
    this.#pendingBuzzerRequests.set(requestId, { questionId, payload });
    this.buzzerResults.clearError();
    return true;
  }

  getTeacherProgress(): boolean {
    return this.#send({ type: 'buzzerResults.getTeacherProgress', requestId: createRequestId(), payload: {} });
  }

  getStudentResults(): boolean {
    return this.#send({ type: 'buzzerResults.getStudentResults', requestId: createRequestId(), payload: {} });
  }

  setFairRanking(settings: FairRankingSettings): boolean {
    return this.#send({ type: 'buzzerResults.setFairRanking', requestId: createRequestId(), payload: settings });
  }

  exportCsv(): boolean {
    const requestId = createRequestId();
    const sent = this.#send({ type: 'buzzerResults.exportCsv', requestId, payload: {} });
    if (!sent) return false;
    this.#pendingCsvExportRequests.add(requestId);
    this.buzzerResults.beginCsvExport();
    return true;
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
      this.#pendingCsvExportRequests.clear();
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
      const layouts = questionLayoutsFor(payload.questionIds, payload.questionLayouts);
      if (layouts === null) return;
      this.buzzerResults.applyQuestionList(payload.questionIds);
      this.store.applyQuestionList(payload.questionIds, layouts);
      return;
    }
    if (message.type === 'buzzerResults.teacherProgress') {
      if (this.store.getSnapshot().role === 'TEACHER' && isTeacherProgress(payload)) {
        this.buzzerResults.applyTeacherProgress(payload);
      }
      return;
    }
    if (message.type === 'buzzerResults.fairRankingConfigured') {
      if (this.store.getSnapshot().role === 'TEACHER' && isFairRankingSettings(payload)) {
        this.buzzerResults.applyFairRankingSettings(payload);
      }
      return;
    }
    if (message.type === 'buzzerResults.ownProgress'
      && this.store.getSnapshot().role === 'STUDENT'
      && Array.isArray(payload.questions)) {
      const questions = payload.questions.filter((item): item is Record<string, unknown> => isRecord(item));
      if (questions.every((item) => typeof item.questionId === 'string'
        && typeof item.submitted === 'boolean'
        && isValidNullableString(item.answerText)
        && hasValidOptionalSubAnswers(item, 'answers')
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
    if (message.type === 'buzzerResults.csvReady') {
      if (this.store.getSnapshot().role === 'TEACHER'
        && typeof message.requestId === 'string'
        && this.#pendingCsvExportRequests.delete(message.requestId)
        && typeof payload.fileName === 'string'
        && typeof payload.csvText === 'string') {
        downloadCsv(payload.fileName, payload.csvText);
        this.buzzerResults.completeCsvExport(payload.fileName);
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
        this.buzzerResults.applyAccepted(
          pending.questionId,
          typeof pending.payload.answerText === 'string'
            ? pending.payload.answerText
            : pending.payload.subAnswers ?? [],
        );
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
      const layouts = questionLayoutsFor(payload.questionIds, payload.questionLayouts);
      if (layouts === null) return;
      this.store.applyGuidedNotesSnapshot(payload.worksheetTitle, payload.questionIds, layouts);
      return;
    }
    if (
      message.type === 'guidedNotes.imported'
      && typeof payload.worksheetTitle === 'string'
      && isStringArray(payload.questionIds)
      && typeof payload.questionCount === 'number'
      && payload.questionCount === payload.questionIds.length
    ) {
      const layouts = questionLayoutsFor(payload.questionIds, payload.questionLayouts);
      if (layouts === null) return;
      this.store.applyGuidedNotesImport(payload.worksheetTitle, payload.questionIds, layouts);
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
      if (requestId !== null && this.#pendingCsvExportRequests.delete(requestId)) {
        this.buzzerResults.failCsvExport(payload.message);
      }
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

function downloadCsv(fileName: string, csvText: string): void {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
