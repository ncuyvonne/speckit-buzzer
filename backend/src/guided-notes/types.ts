/** A spreadsheet and worksheet tab selected by the teacher and resolved by the server. */
export interface WorksheetReference {
  readonly spreadsheetId: string;
  readonly sheetId: number;
  readonly worksheetTitle: string;
}

/** A question number as displayed in the source worksheet. */
export interface Question {
  readonly questionId: string;
  readonly displayOrder: number;
  /** Source row is retained for traceability only; export must rediscover the current row. */
  readonly sourceRowAtImport: number;
}

/** A worksheet layout discovered from the latest values read. Row and column numbers are 1-based. */
export interface WorksheetLayout {
  readonly headerRowNumber: number;
  readonly questionColumnNumber: number;
  readonly answerColumnNumber: number;
  readonly questionRows: ReadonlyMap<string, number>;
}

/** A winning answer supplied by the server-side buzzer results provider. */
export interface WinningAnswer {
  readonly questionId: string;
  readonly groupId: string;
  readonly answerText: string;
}

export type WinningResultsSnapshot =
  | { readonly status: 'READY'; readonly answers: readonly WinningAnswer[] }
  | { readonly status: 'UNAVAILABLE'; readonly reason?: 'NOT_READY' };

export type GuidedNotesOperationType = 'IMPORT' | 'EXPORT';
export type GuidedNotesOperationStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNCONFIRMED';

/** Transient server-owned operation metadata; never includes credentials or raw Google responses. */
export interface GuidedNotesOperation {
  readonly requestId: string;
  readonly operationType: GuidedNotesOperationType;
  readonly status: GuidedNotesOperationStatus;
  readonly writtenCellCount?: number;
  readonly clearedCellCount?: number;
}
