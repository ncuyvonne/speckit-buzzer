import type { ExportDimensionAnchor, WorksheetReference } from '../../guided-notes/types.js';

/** Selected worksheet plus its latest server-reported dimensions. */
export interface ResolvedWorksheet {
  readonly worksheet: WorksheetReference;
  readonly rowCount: number;
  readonly columnCount: number;
}

/** FORMATTED_VALUE grid returned by a fresh worksheet scan. Coordinates remain 1-based externally. */
export interface WorksheetGrid extends ResolvedWorksheet {
  readonly values: readonly (readonly string[])[];
  /** Canonical JSON keys of the exact userEnteredValue, null for an empty cell. */
  readonly rawValues: readonly (readonly (string | null)[])[];
}

/** One target answer cell; coordinates are 1-based and the value is literal text or an empty string. */
export interface AnswerCellWrite {
  readonly questionId: string;
  readonly rowNumber: number;
  readonly answerColumnNumber: number;
  readonly value: string;
}

/** Minimal searchable metadata needed to recognize a previously exported worksheet. */
export interface DeveloperMetadataRecord {
  readonly metadataId?: number;
  readonly metadataKey: string;
  readonly metadataValue?: string;
  readonly visibility: string;
  readonly locationType: string;
  readonly sheetId?: number;
  readonly dimension?: 'ROW' | 'COLUMN';
  readonly coordinate?: number;
  readonly endCoordinate?: number;
}

/** Injectable boundary for the Google Sheets API implementation and deterministic test fakes. */
export interface GoogleSheetsAdapter {
  resolveWorksheet(spreadsheetId: string, worksheetTitle: string): Promise<ResolvedWorksheet>;
  searchDeveloperMetadata(
    spreadsheetId: string,
    metadataKey: string,
    visibility: 'PROJECT',
  ): Promise<readonly DeveloperMetadataRecord[]>;
  readWorksheet(worksheet: ResolvedWorksheet): Promise<WorksheetGrid>;
  batchWriteValues(worksheet: ResolvedWorksheet, writes: readonly AnswerCellWrite[]): Promise<void>;
  batchExport(
    worksheet: ResolvedWorksheet,
    writes: readonly AnswerCellWrite[],
    anchors: readonly ExportDimensionAnchor[],
  ): Promise<void>;
}
