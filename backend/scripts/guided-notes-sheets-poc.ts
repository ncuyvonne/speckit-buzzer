import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { google, type sheets_v4 } from "googleapis";

type CellCoordinate = { rowIndex: number; columnIndex: number };
type CellState = {
  userEnteredValue: sheets_v4.Schema$ExtendedValue | null;
  effectiveValue: sheets_v4.Schema$ExtendedValue | null;
  formattedValue: string | null;
  note: string | null;
  userEnteredFormat: sheets_v4.Schema$CellFormat | null;
};
type A1Bounds = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};
type PocResult = {
  questionCount: number;
  rowCount: number;
  columnCount: number;
  neighborCount: number;
  readMs: number;
  writeMs: number;
  invalidBatchMs: number;
};

class PocFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PocFailure";
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new PocFailure(`CONFIG_MISSING_${name}`);
  return value;
}

function parseSpreadsheetId(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PocFailure("SHEET_URL_INVALID");
  }

  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") {
    throw new PocFailure("SHEET_URL_INVALID");
  }

  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname);
  if (!match) throw new PocFailure("SHEET_URL_INVALID");
  return match[1];
}

function columnToNumber(letters: string): number {
  let value = 0;
  for (const letter of letters.toUpperCase()) {
    value = value * 26 + letter.charCodeAt(0) - 64;
  }
  return value;
}

function columnToLetters(column: number): string {
  let value = column;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function parseScratchRange(value: string): A1Bounds {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)(?::\$?([A-Z]{1,3})\$?([1-9]\d*))?$/i.exec(value.trim());
  if (!match) throw new PocFailure("SCRATCH_RANGE_INVALID");

  const startColumn = columnToNumber(match[1]);
  const startRow = Number(match[2]);
  const endColumn = match[3] ? columnToNumber(match[3]) : startColumn;
  const endRow = match[4] ? Number(match[4]) : startRow;
  if (endRow < startRow || endColumn < startColumn) {
    throw new PocFailure("SCRATCH_RANGE_INVALID");
  }

  return { startRow, endRow, startColumn, endColumn };
}

function formatCell(coordinate: CellCoordinate): string {
  return `${columnToLetters(coordinate.columnIndex + 1)}${coordinate.rowIndex + 1}`;
}

function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function cloneJson<T>(value: T | null | undefined): T | null {
  return value === null || value === undefined
    ? null
    : (JSON.parse(JSON.stringify(value)) as T);
}

function cellState(cell?: sheets_v4.Schema$CellData): CellState {
  return {
    userEnteredValue: cloneJson(cell?.userEnteredValue),
    effectiveValue: cloneJson(cell?.effectiveValue),
    formattedValue: cell?.formattedValue ?? null,
    note: cell?.note ?? null,
    userEnteredFormat: cloneJson(cell?.userEnteredFormat),
  };
}

function getGridCell(
  response: sheets_v4.Schema$Spreadsheet,
  sheetId: number,
  rowIndex: number,
  columnIndex: number,
): sheets_v4.Schema$CellData | undefined {
  const sheet = response.sheets?.find((candidate) => candidate.properties?.sheetId === sheetId);
  const data = sheet?.data?.[0];
  if (!data) return undefined;

  const rowDataIndex = rowIndex - (data.startRow ?? 0);
  const columnDataIndex = columnIndex - (data.startColumn ?? 0);
  if (rowDataIndex < 0 || columnDataIndex < 0) return undefined;
  return data.rowData?.[rowDataIndex]?.values?.[columnDataIndex];
}

function readScratchStates(
  response: sheets_v4.Schema$Spreadsheet,
  sheetId: number,
  bounds: A1Bounds,
): Map<string, CellState> {
  const states = new Map<string, CellState>();
  for (let rowIndex = bounds.startRow - 1; rowIndex < bounds.endRow; rowIndex += 1) {
    for (let columnIndex = bounds.startColumn - 1; columnIndex < bounds.endColumn; columnIndex += 1) {
      const coordinate = { rowIndex, columnIndex };
      states.set(formatCell(coordinate), cellState(getGridCell(response, sheetId, rowIndex, columnIndex)));
    }
  }
  return states;
}

function formattedText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as { response?: { status?: unknown }; code?: unknown };
  const candidate = record.response?.status ?? record.code;
  return typeof candidate === "number" && Number.isInteger(candidate) ? candidate : undefined;
}

function safeFailureCode(error: unknown): string {
  if (error instanceof PocFailure) return error.code;
  const status = getHttpStatus(error);
  return status === undefined ? "GOOGLE_API_REQUEST_FAILED" : `GOOGLE_API_HTTP_${status}`;
}

function assertAllStatesEqual(
  expected: Map<string, CellState>,
  actual: Map<string, CellState>,
  failureCode: string,
): void {
  for (const [address, state] of expected) {
    if (!isDeepStrictEqual(state, actual.get(address))) {
      throw new PocFailure(failureCode);
    }
  }
}

function assertTargetPresentationUnchanged(
  before: CellState,
  after: CellState,
): void {
  if (before.note !== after.note || !isDeepStrictEqual(before.userEnteredFormat, after.userEnteredFormat)) {
    throw new PocFailure("TARGET_NOTE_OR_FORMAT_CHANGED");
  }
}

function isInsideRange(coordinate: CellCoordinate, bounds: A1Bounds): boolean {
  return coordinate.rowIndex + 1 >= bounds.startRow
    && coordinate.rowIndex + 1 <= bounds.endRow
    && coordinate.columnIndex + 1 >= bounds.startColumn
    && coordinate.columnIndex + 1 <= bounds.endColumn;
}

function countScratchNeighbors(
  targets: CellCoordinate[],
  bounds: A1Bounds,
): number {
  const targetAddresses = new Set(targets.map(formatCell));
  const neighbors = new Set<string>();
  const offsets = [
    { rowIndex: -1, columnIndex: 0 },
    { rowIndex: 1, columnIndex: 0 },
    { rowIndex: 0, columnIndex: -1 },
    { rowIndex: 0, columnIndex: 1 },
  ];

  for (const target of targets) {
    for (const offset of offsets) {
      const candidate = {
        rowIndex: target.rowIndex + offset.rowIndex,
        columnIndex: target.columnIndex + offset.columnIndex,
      };
      const address = formatCell(candidate);
      if (isInsideRange(candidate, bounds) && !targetAddresses.has(address)) {
        neighbors.add(address);
      }
    }
  }
  return neighbors.size;
}

async function getScratchSpreadsheet(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetTitle: string,
  scratchRange: string,
): Promise<sheets_v4.Schema$Spreadsheet> {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`${quoteSheetTitle(sheetTitle)}!${scratchRange}`],
    includeGridData: true,
    fields: "sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,formattedValue,note,userEnteredFormat))))",
  });
  return response.data;
}

async function restoreTargetValues(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetId: number,
  targets: CellCoordinate[],
  originalStates: Map<string, CellState>,
): Promise<void> {
  const requests: sheets_v4.Schema$Request[] = targets.map((target) => {
    const original = originalStates.get(formatCell(target));
    if (!original) throw new PocFailure("ORIGINAL_TARGET_SNAPSHOT_MISSING");
    const originalValue = cloneJson(original.userEnteredValue);
    const cell: sheets_v4.Schema$CellData = originalValue
      ? { userEnteredValue: originalValue }
      : {};

    return {
      updateCells: {
        range: {
          sheetId,
          startRowIndex: target.rowIndex,
          endRowIndex: target.rowIndex + 1,
          startColumnIndex: target.columnIndex,
          endColumnIndex: target.columnIndex + 1,
        },
        rows: [{ values: [cell] }],
        fields: "userEnteredValue",
      },
    };
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

async function runProof(): Promise<PocResult> {
  const credentialJson = requiredEnvironment("GOOGLE_SERVICE_ACCOUNT_JSON");
  const spreadsheetUrl = requiredEnvironment("GUIDED_NOTES_POC_SPREADSHEET_URL");
  const sheetTitle = requiredEnvironment("GUIDED_NOTES_POC_WORKSHEET_TITLE");
  const scratchRange = requiredEnvironment("GUIDED_NOTES_POC_SCRATCH_RANGE");
  const spreadsheetId = parseSpreadsheetId(spreadsheetUrl);
  const scratchBounds = parseScratchRange(scratchRange);

  let credentials: unknown;
  try {
    credentials = JSON.parse(credentialJson);
  } catch {
    throw new PocFailure("SERVICE_ACCOUNT_JSON_INVALID");
  }
  if (
    typeof credentials !== "object"
    || credentials === null
    || typeof (credentials as { client_email?: unknown }).client_email !== "string"
    || typeof (credentials as { private_key?: unknown }).private_key !== "string"
  ) {
    throw new PocFailure("SERVICE_ACCOUNT_JSON_INVALID");
  }

  const auth = new google.auth.GoogleAuth({
    credentials: credentials as ConstructorParameters<typeof google.auth.GoogleAuth>[0]["credentials"],
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const metadataStarted = performance.now();
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
  });
  const selectedSheet = metadata.data.sheets?.find((sheet) => sheet.properties?.title === sheetTitle);
  const sheetId = selectedSheet?.properties?.sheetId;
  const rowCount = selectedSheet?.properties?.gridProperties?.rowCount;
  const columnCount = selectedSheet?.properties?.gridProperties?.columnCount;
  if (sheetId === undefined || rowCount === undefined || columnCount === undefined) {
    throw new PocFailure("WORKSHEET_NOT_FOUND");
  }
  if (rowCount > 1000 || columnCount > 26) throw new PocFailure("GRID_EXCEEDS_POC_LIMIT");
  if (
    scratchBounds.startRow < 1
    || scratchBounds.endRow > rowCount
    || scratchBounds.startColumn < 1
    || scratchBounds.endColumn > columnCount
  ) {
    throw new PocFailure("SCRATCH_RANGE_OUTSIDE_GRID");
  }

  const gridRange = `${quoteSheetTitle(sheetTitle)}!A1:${columnToLetters(columnCount)}${rowCount}`;
  const valuesResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: gridRange,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const readMs = performance.now() - metadataStarted;
  const formattedRows = valuesResponse.data.values ?? [];

  const headerRows: Array<{ rowIndex: number; questionColumn: number; answerColumn: number }> = [];
  for (let rowIndex = 0; rowIndex < formattedRows.length; rowIndex += 1) {
    const row = formattedRows[rowIndex] ?? [];
    const questionColumns: number[] = [];
    const answerColumns: number[] = [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const label = formattedText(row[columnIndex]).trim();
      if (label === "題號") questionColumns.push(columnIndex);
      if (label === "作答") answerColumns.push(columnIndex);
    }
    if (questionColumns.length > 1 || answerColumns.length > 1) {
      throw new PocFailure("HEADER_DUPLICATED");
    }
    if (questionColumns.length === 1 && answerColumns.length === 1) {
      headerRows.push({
        rowIndex,
        questionColumn: questionColumns[0],
        answerColumn: answerColumns[0],
      });
    }
  }

  if (headerRows.length !== 1) throw new PocFailure("HEADER_NOT_UNIQUE");
  const header = headerRows[0];
  if (header.rowIndex === 0) throw new PocFailure("HEADER_MUST_NOT_BE_FIRST_ROW");
  if (header.answerColumn >= header.questionColumn) {
    throw new PocFailure("ANSWER_COLUMN_MUST_PRECEDE_QUESTION_COLUMN");
  }
  if (
    header.rowIndex + 1 < scratchBounds.startRow
    || header.rowIndex + 1 > scratchBounds.endRow
    || header.questionColumn + 1 < scratchBounds.startColumn
    || header.questionColumn + 1 > scratchBounds.endColumn
    || header.answerColumn + 1 < scratchBounds.startColumn
    || header.answerColumn + 1 > scratchBounds.endColumn
  ) {
    throw new PocFailure("SCRATCH_RANGE_MUST_INCLUDE_HEADER");
  }

  const questionIds = new Set<string>();
  const questionRows: number[] = [];
  for (let rowIndex = header.rowIndex + 1; rowIndex < rowCount; rowIndex += 1) {
    const id = formattedText(formattedRows[rowIndex]?.[header.questionColumn]);
    if (id.trim() === "") continue;
    if (questionIds.has(id)) throw new PocFailure("QUESTION_ID_DUPLICATED");
    questionIds.add(id);
    questionRows.push(rowIndex);
  }
  if (questionRows.length < 2) throw new PocFailure("POC_REQUIRES_TWO_QUESTION_ROWS");
  if (questionRows.length > 100) throw new PocFailure("QUESTION_COUNT_EXCEEDS_100");

  const targets: CellCoordinate[] = questionRows.slice(0, 2).map((rowIndex) => ({
    rowIndex,
    columnIndex: header.answerColumn,
  }));
  if (targets.some((target) => !isInsideRange(target, scratchBounds))) {
    throw new PocFailure("SCRATCH_RANGE_MUST_INCLUDE_TARGET_CELLS");
  }
  const neighborCount = countScratchNeighbors(targets, scratchBounds);
  if (neighborCount === 0) throw new PocFailure("SCRATCH_RANGE_MUST_INCLUDE_NEIGHBORS");

  let originalStates: Map<string, CellState> | undefined;
  let operationError: unknown;
  let restoreError: unknown;
  let writeMs = 0;
  let invalidBatchMs = 0;

  try {
    const beforeGrid = await getScratchSpreadsheet(sheets, spreadsheetId, sheetTitle, scratchRange);
    originalStates = readScratchStates(beforeGrid, sheetId, scratchBounds);
    const [winnerTarget, noWinnerTarget] = targets;
    const winnerAddress = formatCell(winnerTarget);
    const noWinnerAddress = formatCell(noWinnerTarget);
    const uniqueLiteral = `GUIDED_NOTES_POC_${Date.now()}`;
    const writeStarted = performance.now();
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range: `${quoteSheetTitle(sheetTitle)}!${winnerAddress}`, values: [[uniqueLiteral]] },
          { range: `${quoteSheetTitle(sheetTitle)}!${noWinnerAddress}`, values: [[""]] },
        ],
      },
    });
    writeMs = performance.now() - writeStarted;

    const afterWriteGrid = await getScratchSpreadsheet(sheets, spreadsheetId, sheetTitle, scratchRange);
    const afterWriteStates = readScratchStates(afterWriteGrid, sheetId, scratchBounds);
    if (afterWriteStates.get(winnerAddress)?.userEnteredValue?.stringValue !== uniqueLiteral) {
      throw new PocFailure("RAW_WRITE_NOT_CONFIRMED");
    }
    const clearedState = afterWriteStates.get(noWinnerAddress);
    const clearedValue = clearedState?.userEnteredValue;
    const userValueIsEmpty = clearedValue === null || clearedValue?.stringValue === "";
    const formattedValueIsEmpty = clearedState?.formattedValue === null || clearedState?.formattedValue === "";
    if (!clearedState || !userValueIsEmpty || !formattedValueIsEmpty) {
      throw new PocFailure("EMPTY_STRING_CLEAR_NOT_CONFIRMED");
    }
    for (const target of targets) {
      const address = formatCell(target);
      const before = originalStates.get(address);
      const after = afterWriteStates.get(address);
      if (!before || !after) throw new PocFailure("TARGET_SNAPSHOT_MISSING");
      assertTargetPresentationUnchanged(before, after);
    }
    const targetAddresses = new Set(targets.map(formatCell));
    for (const [address, state] of originalStates) {
      if (!targetAddresses.has(address) && !isDeepStrictEqual(state, afterWriteStates.get(address))) {
        throw new PocFailure("NON_TARGET_CELL_CHANGED");
      }
    }

    const invalidStarted = performance.now();
    let invalidBatchStatus: number | undefined;
    try {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            { range: `${quoteSheetTitle(sheetTitle)}!${winnerAddress}`, values: [["SHOULD_NOT_APPLY"]] },
            { range: `${quoteSheetTitle(sheetTitle)}!A0`, values: [["INVALID_RANGE"]] },
          ],
        },
      });
    } catch (error) {
      invalidBatchStatus = getHttpStatus(error);
    }
    invalidBatchMs = performance.now() - invalidStarted;
    if (invalidBatchStatus !== 400) throw new PocFailure("INVALID_BATCH_NOT_DEFINITIVELY_REJECTED");

    const afterInvalidGrid = await getScratchSpreadsheet(sheets, spreadsheetId, sheetTitle, scratchRange);
    const afterInvalidStates = readScratchStates(afterInvalidGrid, sheetId, scratchBounds);
    assertAllStatesEqual(afterWriteStates, afterInvalidStates, "INVALID_BATCH_PARTIALLY_APPLIED");
  } catch (error) {
    operationError = error;
  } finally {
    if (originalStates && targets.length > 0) {
      try {
        await restoreTargetValues(sheets, spreadsheetId, sheetId, targets, originalStates);
        const restoredGrid = await getScratchSpreadsheet(sheets, spreadsheetId, sheetTitle, scratchRange);
        const restoredStates = readScratchStates(restoredGrid, sheetId, scratchBounds);
        assertAllStatesEqual(originalStates, restoredStates, "SCRATCH_RESTORE_NOT_CONFIRMED");
      } catch (error) {
        restoreError = error;
      }
    }
  }

  if (restoreError) throw new PocFailure(`RESTORE_FAILED_${safeFailureCode(restoreError)}`);
  if (operationError) throw operationError;

  return {
    questionCount: questionRows.length,
    rowCount,
    columnCount,
    neighborCount,
    readMs: Math.round(readMs),
    writeMs: Math.round(writeMs),
    invalidBatchMs: Math.round(invalidBatchMs),
  };
}

async function main(): Promise<void> {
  const started = performance.now();
  try {
    const result = await runProof();
    console.log("GUIDED_NOTES_SHEETS_POC=PASS");
    console.log(`question_count=${result.questionCount}`);
    console.log(`grid=${result.rowCount}x${result.columnCount}`);
    console.log(`scratch_neighbor_cells_checked=${result.neighborCount}`);
    console.log(`read_ms=${result.readMs}`);
    console.log(`write_ms=${result.writeMs}`);
    console.log(`invalid_batch_ms=${result.invalidBatchMs}`);
  } catch (error) {
    console.error(`GUIDED_NOTES_SHEETS_POC=FAIL code=${safeFailureCode(error)}`);
    process.exitCode = 1;
  } finally {
    console.log(`elapsed_ms=${Math.round(performance.now() - started)}`);
  }
}

void main();
