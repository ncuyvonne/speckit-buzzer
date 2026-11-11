import { google, type sheets_v4 } from 'googleapis';
import type { GoogleServiceAccountCredentials } from '../../config.js';
import type { WorksheetReference } from '../../guided-notes/types.js';
import {
  GoogleSheetsIntegrationError,
  normalizeGoogleSheetsError,
} from './errors.js';
import type {
  AnswerCellWrite,
  GoogleSheetsAdapter,
  ResolvedWorksheet,
  WorksheetGrid,
} from './types.js';

const SPREADSHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
type GoogleAuthOptions = NonNullable<ConstructorParameters<typeof google.auth.GoogleAuth>[0]>;

function columnToLetters(column: number): string {
  let value = column;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function asDisplayedRows(values: unknown[][] | null | undefined): string[][] {
  return (values ?? []).map((row) => (row ?? []).map((cell) => (
    cell === null || cell === undefined ? '' : String(cell)
  )));
}

class GoogleSheetsApiAdapter implements GoogleSheetsAdapter {
  readonly #sheets: sheets_v4.Sheets | null;

  constructor(credentials: GoogleServiceAccountCredentials | null, sheetsClient?: sheets_v4.Sheets) {
    if (sheetsClient) {
      this.#sheets = sheetsClient;
      return;
    }
    if (credentials === null) {
      this.#sheets = null;
      return;
    }

    const auth = new google.auth.GoogleAuth({
      credentials: credentials as NonNullable<GoogleAuthOptions['credentials']>,
      scopes: [SPREADSHEETS_SCOPE],
    });
    this.#sheets = google.sheets({ version: 'v4', auth });
  }

  async resolveWorksheet(spreadsheetId: string, worksheetTitle: string): Promise<ResolvedWorksheet> {
    const sheets = this.#requireSheets();
    try {
      const response = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))',
      });
      const properties = response.data.sheets
        ?.find((sheet) => sheet.properties?.title === worksheetTitle)
        ?.properties;
      const sheetId = properties?.sheetId;
      const rowCount = properties?.gridProperties?.rowCount;
      const columnCount = properties?.gridProperties?.columnCount;
      if (
        sheetId === undefined || sheetId === null
        || rowCount === undefined || rowCount === null
        || columnCount === undefined || columnCount === null
        || !Number.isInteger(sheetId)
        || !Number.isInteger(rowCount)
        || !Number.isInteger(columnCount)
      ) {
        throw new GoogleSheetsIntegrationError('SHEET_NOT_FOUND');
      }

      const worksheet: WorksheetReference = { spreadsheetId, sheetId, worksheetTitle };
      return { worksheet, rowCount, columnCount };
    } catch (error) {
      throw normalizeGoogleSheetsError(error, 'READ');
    }
  }

  async readWorksheet(resolved: ResolvedWorksheet): Promise<WorksheetGrid> {
    const sheets = this.#requireSheets();
    try {
      const range = `${quoteSheetTitle(resolved.worksheet.worksheetTitle)}!A1:${columnToLetters(resolved.columnCount)}${resolved.rowCount}`;
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: resolved.worksheet.spreadsheetId,
        range,
        majorDimension: 'ROWS',
        valueRenderOption: 'FORMATTED_VALUE',
      });
      return {
        ...resolved,
        values: asDisplayedRows(response.data.values),
      };
    } catch (error) {
      throw normalizeGoogleSheetsError(error, 'READ');
    }
  }

  async batchWriteValues(resolved: ResolvedWorksheet, writes: readonly AnswerCellWrite[]): Promise<void> {
    if (writes.length === 0) return;
    const sheets = this.#requireSheets();
    const seenRanges = new Set<string>();
    const data = writes.map((write) => {
      if (
        !Number.isInteger(write.rowNumber)
        || write.rowNumber < 1
        || write.rowNumber > resolved.rowCount
        || !Number.isInteger(write.answerColumnNumber)
        || write.answerColumnNumber < 1
        || write.answerColumnNumber > resolved.columnCount
        || typeof write.value !== 'string'
      ) {
        throw new GoogleSheetsIntegrationError('SHEET_WRITE_FAILED', { writeOutcome: 'DEFINITELY_NOT_APPLIED' });
      }
      const range = `${quoteSheetTitle(resolved.worksheet.worksheetTitle)}!${columnToLetters(write.answerColumnNumber)}${write.rowNumber}`;
      if (seenRanges.has(range)) {
        throw new GoogleSheetsIntegrationError('SHEET_WRITE_FAILED', { writeOutcome: 'DEFINITELY_NOT_APPLIED' });
      }
      seenRanges.add(range);
      return { range, majorDimension: 'ROWS' as const, values: [[write.value]] };
    });

    try {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: resolved.worksheet.spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data },
      });
    } catch (error) {
      throw normalizeGoogleSheetsError(error, 'WRITE');
    }
  }

  #requireSheets(): sheets_v4.Sheets {
    if (!this.#sheets) throw new GoogleSheetsIntegrationError('SHEETS_NOT_CONFIGURED');
    return this.#sheets;
  }
}

export function createGoogleSheetsAdapter(
  credentials: GoogleServiceAccountCredentials | null,
  sheetsClient?: sheets_v4.Sheets,
): GoogleSheetsAdapter {
  return new GoogleSheetsApiAdapter(credentials, sheetsClient);
}
