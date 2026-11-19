/** A spreadsheet and worksheet tab selected by the teacher and resolved by the server. */
export interface WorksheetReference {
  readonly spreadsheetId: string;
  readonly sheetId: number;
  readonly worksheetTitle: string;
}

export type QuestionKind = 'SINGLE' | 'GROUP';

/** One answer position within an imported top-level question. */
export interface AnswerSlot {
  readonly placeholderNumber: number;
  readonly sourceRowAtImport: number;
}

export interface QuestionLayoutSummary {
  readonly questionId: string;
  readonly kind: QuestionKind;
  readonly answerCount: number;
}

interface QuestionBase {
  /** Exact displayed question-number value. */
  readonly questionId: string;
  readonly displayOrder: number;
  /** Source row is retained for traceability only; export must rediscover the current row. */
  readonly sourceRowAtImport: number;
}

/** Existing single questions remain readable while imported layouts gain explicit slot metadata. */
export interface LegacySingleQuestion extends QuestionBase {
  readonly kind?: undefined;
  readonly answerSlots?: undefined;
}

export interface SingleQuestion extends QuestionBase {
  readonly kind: 'SINGLE';
  readonly answerSlots: readonly [AnswerSlot];
}

export interface GroupQuestion extends QuestionBase {
  readonly kind: 'GROUP';
  readonly answerSlots: readonly AnswerSlot[];
}

export type Question = LegacySingleQuestion | SingleQuestion | GroupQuestion;

export interface SubAnswer {
  readonly placeholderNumber: number;
  readonly answerText: string;
}

export type SubmitAnswerPayload =
  | { readonly questionId: string; readonly answerText: string; readonly subAnswers?: never }
  | { readonly questionId: string; readonly subAnswers: readonly SubAnswer[]; readonly answerText?: never };

/** A worksheet layout discovered from the latest values read. Row and column numbers are 1-based. */
export interface WorksheetLayout {
  readonly headerRowNumber: number;
  readonly questionColumnNumber: number;
  readonly answerColumnNumber: number;
  readonly questionRows: ReadonlyMap<string, number>;
  /** Each top-level question maps to its answer-cell rows in slot order. */
  readonly slotRows?: ReadonlyMap<string, readonly number[]>;
}

/** A winning answer supplied by the server-side buzzer results provider. */
export interface WinningAnswer {
  readonly questionId: string;
  readonly groupId: string;
  readonly answerText?: string;
  readonly answers?: readonly SubAnswer[];
}

export type WinningResultsSnapshot =
  | { readonly status: 'READY'; readonly answers: readonly WinningAnswer[] }
  | { readonly status: 'UNAVAILABLE'; readonly reason?: 'NOT_READY' };

export interface ExportHeaderCoordinates {
  readonly rowNumber: number;
  readonly questionColumnNumber: number;
  readonly answerColumnNumber: number;
}

export interface ExportTarget {
  readonly questionId: string;
  readonly placeholderNumber: number;
  readonly rowNumber: number;
  readonly answerColumnNumber: number;
  readonly prewriteValue: string | null;
  readonly intendedValue: string | null;
}

export interface ExportDimensionAnchor {
  readonly metadataId: number;
  readonly metadataKey: 'sb004';
  readonly attemptToken: string;
  readonly dimension: 'ROW' | 'COLUMN';
  readonly sheetId: number;
  readonly coordinate: number;
}

export interface ExportManifest {
  readonly worksheet: WorksheetReference;
  readonly header: ExportHeaderCoordinates;
  readonly targets: readonly ExportTarget[];
  readonly anchors: readonly ExportDimensionAnchor[];
}

export interface ExportMapping {
  readonly header: ExportHeaderCoordinates;
  readonly targets: readonly ExportTarget[];
}

export type ExportAnchorState =
  | { readonly status: 'NONE' }
  | { readonly status: 'PREPARED'; readonly manifest: ExportManifest }
  | { readonly status: 'CONFIRMED'; readonly manifest: ExportManifest };

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
