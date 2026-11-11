import { ActivityStore } from '../state/activity';
import { StudentSelection } from '../state/student-selection';
import type { ActivityStage, ClientMessage, ErrorCode } from './messages';

const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;

interface LocationLike {
  readonly protocol: string;
  readonly host: string;
}

export interface RealtimeClientOptions {
  readonly store?: ActivityStore;
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

export class RealtimeClient {
  readonly store: ActivityStore;
  readonly #location: LocationLike;
  readonly #createSocket: (url: string) => WebSocket;
  readonly #studentSelection: StudentSelection;
  #socket: WebSocket | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempt = 0;
  #stopped = true;
  #awaitingInitialSnapshot = false;

  constructor(options: RealtimeClientOptions = {}) {
    this.store = options.store ?? new ActivityStore();
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

  advance(from: ActivityStage, to: ActivityStage): boolean {
    return this.#send({ type: 'activity.advance', requestId: createRequestId(), payload: { from, to } });
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
      return;
    }
    if (message.type === 'activity.phaseChanged' && isActivityStage(payload.stage)) {
      this.store.update({
        stage: payload.stage,
        ...(this.store.getSnapshot().serverError?.code === 'STAGE_CONFLICT' ? { serverError: null } : {}),
      });
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
      if (payload.code === 'GROUP_INVALID') {
        this.#studentSelection.clear();
        this.store.update({ role: 'UNAUTHENTICATED', selectedGroupId: null });
      }
      if (payload.code === 'AUTH_REQUIRED' && this.store.getSnapshot().role === 'TEACHER') {
        this.store.update({ role: 'UNAUTHENTICATED', selectedGroupId: null });
      }
      this.store.update({
        serverError: { code: payload.code as ErrorCode, message: payload.message },
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
