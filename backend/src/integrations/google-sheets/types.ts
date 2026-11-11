import type { WorksheetReference } from '../../guided-notes/types.js';

/** Selected worksheet plus its latest server-reported dimensions. */
export interface ResolvedWorksheet {
  readonly worksheet: WorksheetReference;
  readonly rowCount: number;
  readonly columnCount: number;
}

/** FORMATTED_VALUE grid returned by a fresh worksheet scan. Coordinates remain 1-based externally. */
export interface WorksheetGrid extends ResolvedWorksheet {
  readonly values: readonly (readonly string[])[];
}

/** One target answer cell; coordinates are 1-based and the value is literal text or an empty string. */
export interface AnswerCellWrite {
  readonly questionId: string;
  readonly rowNumber: number;
  readonly answerColumnNumber: number;
  readonly value: string;
}

/** Injectable boundary for the Google Sheets API implementation and deterministic test fakes. */
export interface GoogleSheetsAdapter {
  resolveWorksheet(spreadsheetId: string, worksheetTitle: string): Promise<ResolvedWorksheet>;
  readWorksheet(worksheet: ResolvedWorksheet): Promise<WorksheetGrid>;
  batchWriteValues(worksheet: ResolvedWorksheet, writes: readonly AnswerCellWrite[]): Promise<void>;
}
