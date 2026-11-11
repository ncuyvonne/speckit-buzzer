import type { ActivityStage, ErrorCode, GuidedNotesErrorCode } from '../realtime/messages';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
export type ConnectionRole = 'TEACHER' | 'STUDENT' | 'UNAUTHENTICATED';

export interface ActivityViewState {
  readonly connection: ConnectionStatus;
  readonly role: ConnectionRole;
  readonly stage: ActivityStage | null;
  readonly groups: readonly string[];
  readonly selectedGroupId: string | null;
  readonly serverError: { readonly code: ErrorCode; readonly message: string } | null;
  readonly worksheetTitle: string | null;
  readonly questionIds: readonly string[];
  readonly questionCount: number;
  readonly guidedNotesBusy: boolean;
  readonly guidedNotesError: { readonly code: GuidedNotesErrorCode; readonly message: string } | null;
  readonly guidedNotesExportResult: { readonly writtenCellCount: number; readonly clearedCellCount: number } | null;
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
  worksheetTitle: null,
  questionIds: Object.freeze([]),
  questionCount: 0,
  guidedNotesBusy: false,
  guidedNotesError: null,
  guidedNotesExportResult: null,
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

  applyGuidedNotesSnapshot(worksheetTitle: string | null, questionIds: readonly string[]): void {
    const ids = Object.freeze([...questionIds]);
    this.update({
      worksheetTitle,
      questionIds: ids,
      questionCount: ids.length,
      guidedNotesBusy: false,
      guidedNotesError: null,
      guidedNotesExportResult: null,
    });
  }

  applyGuidedNotesImport(worksheetTitle: string, questionIds: readonly string[]): void {
    this.applyGuidedNotesSnapshot(worksheetTitle, questionIds);
  }

  applyGuidedNotesExport(writtenCellCount: number, clearedCellCount: number): void {
    this.update({
      guidedNotesBusy: false,
      guidedNotesError: null,
      guidedNotesExportResult: { writtenCellCount, clearedCellCount },
    });
  }

  resetConnectionRole(): void {
    this.update({ role: 'UNAUTHENTICATED', selectedGroupId: null, serverError: null });
  }
}
