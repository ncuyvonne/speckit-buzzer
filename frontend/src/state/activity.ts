import type { ActivityStage, ErrorCode } from '../realtime/messages';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
export type ConnectionRole = 'TEACHER' | 'STUDENT' | 'UNAUTHENTICATED';

export interface ActivityViewState {
  readonly connection: ConnectionStatus;
  readonly role: ConnectionRole;
  readonly stage: ActivityStage | null;
  readonly groups: readonly string[];
  readonly selectedGroupId: string | null;
  readonly serverError: { readonly code: ErrorCode; readonly message: string } | null;
  readonly connectionMessage: string | null;
  readonly canReconnect: boolean;
}

const INITIAL_STATE: ActivityViewState = Object.freeze({
  connection: 'disconnected',
  role: 'UNAUTHENTICATED',
  stage: null,
  groups: Object.freeze([]),
  selectedGroupId: null,
  serverError: null,
  connectionMessage: null,
  canReconnect: false,
});

export class ActivityStore {
  #state: ActivityViewState = INITIAL_STATE;
  readonly #listeners = new Set<() => void>();

  getSnapshot = (): ActivityViewState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  update(patch: Partial<ActivityViewState>): void {
    this.#state = Object.freeze({ ...this.#state, ...patch });
    for (const listener of this.#listeners) listener();
  }

  applySnapshot(stage: ActivityStage, groups: readonly string[]): void {
    this.update({ stage, groups: Object.freeze([...groups]), serverError: null });
  }

  resetConnectionRole(): void {
    this.update({ role: 'UNAUTHENTICATED', selectedGroupId: null, serverError: null });
  }
}
