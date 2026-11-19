import { google, type sheets_v4 } from 'googleapis';
import type { GoogleServiceAccountCredentials } from '../../config.js';
import type { ExportDimensionAnchor, WorksheetReference } from '../../guided-notes/types.js';
import {
  GoogleSheetsIntegrationError,
  normalizeGoogleSheetsError,
} from './errors.js';
import type {
  AnswerCellWrite,
  DeveloperMetadataRecord,
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

function rawEnteredValueKey(value: sheets_v4.Schema$ExtendedValue | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const raw: Record<string, string | number | boolean> = {};
  if (value.stringValue !== null && value.stringValue !== undefined) raw.stringValue = value.stringValue;
  if (value.numberValue !== null && value.numberValue !== undefined) raw.numberValue = value.numberValue;
  if (value.boolValue !== null && value.boolValue !== undefined) raw.boolValue = value.boolValue;
  if (value.formulaValue !== null && value.formulaValue !== undefined) raw.formulaValue = value.formulaValue;
  return Object.keys(raw).length === 0 ? null : JSON.stringify(raw);
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

  async searchDeveloperMetadata(
    spreadsheetId: string,
    metadataKey: string,
    visibility: 'PROJECT',
  ): Promise<readonly DeveloperMetadataRecord[]> {
    const sheets = this.#requireSheets();
    try {
      const response = await sheets.spreadsheets.developerMetadata.search({
        spreadsheetId,
        requestBody: {
          dataFilters: [{ developerMetadataLookup: { metadataKey, visibility } }],
        },
      });
      return (response.data.matchedDeveloperMetadata ?? []).flatMap(({ developerMetadata }) => {
        const metadata = developerMetadata;
        const location = metadata?.location;
        if (!metadata?.metadataKey || !metadata.visibility || !location?.locationType) return [];
        const dimensionRange = location.dimensionRange;
        const sheetId = dimensionRange?.sheetId ?? location.sheetId ?? undefined;
        const rangeDimension = dimensionRange?.dimension === 'ROWS'
          ? 'ROW'
          : dimensionRange?.dimension === 'COLUMNS'
            ? 'COLUMN'
            : undefined;
        const dimension = rangeDimension
          ?? (location.locationType === 'ROW' || location.locationType === 'COLUMN' ? location.locationType : undefined);
        const coordinate = dimensionRange?.startIndex === undefined || dimensionRange.startIndex === null
          ? undefined
          : dimensionRange.startIndex + 1;
        const endCoordinate = dimensionRange?.endIndex === undefined || dimensionRange.endIndex === null
          ? undefined
          : dimensionRange.endIndex + 1;
        return [{
          ...(metadata.metadataId === null || metadata.metadataId === undefined ? {} : { metadataId: metadata.metadataId }),
          metadataKey: metadata.metadataKey,
          ...(metadata.metadataValue === null || metadata.metadataValue === undefined
            ? {}
            : { metadataValue: metadata.metadataValue }),
          visibility: metadata.visibility,
          locationType: location.locationType,
          ...(sheetId === null || sheetId === undefined ? {} : { sheetId }),
          ...(dimension === undefined ? {} : { dimension }),
          ...(coordinate === undefined ? {} : { coordinate }),
          ...(endCoordinate === undefined ? {} : { endCoordinate }),
        }];
      });
    } catch (error) {
      throw normalizeGoogleSheetsError(error, 'READ');
    }
  }

  async readWorksheet(resolved: ResolvedWorksheet): Promise<WorksheetGrid> {
    const sheets = this.#requireSheets();
    try {
      const range = `${quoteSheetTitle(resolved.worksheet.worksheetTitle)}!A1:${columnToLetters(resolved.columnCount)}${resolved.rowCount}`;
      const response = await sheets.spreadsheets.get({
        spreadsheetId: resolved.worksheet.spreadsheetId,
        ranges: [range],
        includeGridData: true,
        fields: 'sheets(properties(sheetId),data(rowData(values(formattedValue,userEnteredValue))))',
      });
      const sheet = response.data.sheets?.find((item) => item.properties?.sheetId === resolved.worksheet.sheetId);
      const rows = sheet?.data?.[0]?.rowData ?? [];
      if (sheet === undefined) throw new GoogleSheetsIntegrationError('SHEET_NOT_FOUND');
      return {
        ...resolved,
        values: Array.from({ length: resolved.rowCount }, (_, rowIndex) => Array.from(
          { length: resolved.columnCount },
          (_unused, columnIndex) => rows[rowIndex]?.values?.[columnIndex]?.formattedValue ?? '',
        )),
        rawValues: Array.from({ length: resolved.rowCount }, (_, rowIndex) => Array.from(
          { length: resolved.columnCount },
          (_unused, columnIndex) => rawEnteredValueKey(rows[rowIndex]?.values?.[columnIndex]?.userEnteredValue),
        )),
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

  async batchExport(
    resolved: ResolvedWorksheet,
    writes: readonly AnswerCellWrite[],
    anchors: readonly ExportDimensionAnchor[],
  ): Promise<void> {
    const sheets = this.#requireSheets();
    const seenCells = new Set<string>();
    const seenMetadataIds = new Set<number>();
    const requests: sheets_v4.Schema$Request[] = [];
    for (const write of writes) {
      if (!Number.isInteger(write.rowNumber)
        || write.rowNumber < 1
        || write.rowNumber > resolved.rowCount
        || !Number.isInteger(write.answerColumnNumber)
        || write.answerColumnNumber < 1
        || write.answerColumnNumber > resolved.columnCount
        || typeof write.value !== 'string') {
        throw new GoogleSheetsIntegrationError('SHEET_WRITE_FAILED', { writeOutcome: 'DEFINITELY_NOT_APPLIED' });
      }
      const key = `${write.rowNumber}:${write.answerColumnNumber}`;
      if (seenCells.has(key)) {
        throw new GoogleSheetsIntegrationError('SHEET_WRITE_FAILED', { writeOutcome: 'DEFINITELY_NOT_APPLIED' });
      }
      seenCells.add(key);
      requests.push({
        updateCells: {
          range: {
            sheetId: resolved.worksheet.sheetId,
            startRowIndex: write.rowNumber - 1,
            endRowIndex: write.rowNumber,
            startColumnIndex: write.answerColumnNumber - 1,
            endColumnIndex: write.answerColumnNumber,
          },
          rows: [{ values: [write.value === '' ? {} : { userEnteredValue: { stringValue: write.value } }] }],
          fields: 'userEnteredValue',
        },
      });
    }
    for (const anchor of anchors) {
      const maxCoordinate = anchor.dimension === 'ROW' ? resolved.rowCount : resolved.columnCount;
      if (anchor.sheetId !== resolved.worksheet.sheetId
        || !Number.isSafeInteger(anchor.metadataId)
        || anchor.metadataId <= 0
        || seenMetadataIds.has(anchor.metadataId)
        || !/^[A-Za-z0-9_-]+$/.test(anchor.attemptToken)
        || !Number.isInteger(anchor.coordinate)
        || anchor.coordinate < 1
        || anchor.coordinate > maxCoordinate) {
        throw new GoogleSheetsIntegrationError('SHEET_WRITE_FAILED', { writeOutcome: 'DEFINITELY_NOT_APPLIED' });
      }
      seenMetadataIds.add(anchor.metadataId);
      requests.push({
        createDeveloperMetadata: {
          developerMetadata: {
            metadataId: anchor.metadataId,
            metadataKey: 'sb004',
            metadataValue: `v1:${anchor.attemptToken}:${anchor.dimension}:${anchor.sheetId}:${anchor.coordinate}`,
            visibility: 'PROJECT',
            location: {
              dimensionRange: {
                sheetId: anchor.sheetId,
                dimension: anchor.dimension === 'ROW' ? 'ROWS' : 'COLUMNS',
                startIndex: anchor.coordinate - 1,
                endIndex: anchor.coordinate,
              },
            },
          },
        },
      });
    }
    if (requests.length === 0) return;
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: resolved.worksheet.spreadsheetId,
        requestBody: { requests },
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
