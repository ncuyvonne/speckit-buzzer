import type {
  AnswerCellWrite,
  DeveloperMetadataRecord,
  GoogleSheetsAdapter,
  ResolvedWorksheet,
  WorksheetGrid,
} from '../../src/integrations/google-sheets/types.js';
import type { WriteOutcome } from '../../src/integrations/google-sheets/errors.js';
import type { WorksheetReference } from '../../src/guided-notes/types.js';
import type { ExportDimensionAnchor } from '../../src/guided-notes/types.js';

export interface FakeCellState {
  readonly value?: string;
  readonly formula?: string;
  readonly displayValue?: string;
  readonly note?: string;
  readonly userEnteredFormat?: Readonly<Record<string, unknown>>;
}

export type FakeCellInput = string | FakeCellState | null | undefined;

export interface FakeDeveloperMetadataFixture {
  readonly metadataId?: number;
  readonly metadataKey: string;
  readonly metadataValue?: string;
  readonly visibility: 'PROJECT' | 'DOCUMENT';
  readonly locationType: 'ROW' | 'COLUMN' | 'SHEET' | 'SPREADSHEET';
  readonly sheetId?: number;
  readonly coordinate?: number;
  readonly endCoordinate?: number;
}

export interface FakeWorksheetFixture {
  readonly worksheet: WorksheetReference;
  readonly rowCount: number;
  readonly columnCount: number;
  /** Sparse A1-keyed contents; omitted cells are blank. */
  readonly cells?: Readonly<Record<string, FakeCellInput>>;
  readonly developerMetadata?: readonly FakeDeveloperMetadataFixture[];
}

export type FakeWriteFailure =
  | { readonly kind: 'DEFINITE_REJECTION' }
  | {
      readonly kind: 'LOST_RESPONSE';
      readonly commit: 'FULL' | 'NONE';
      readonly readBack: 'AVAILABLE' | 'UNAVAILABLE';
    };

export class FakeSheetsError extends Error {
  readonly writeOutcome: WriteOutcome | undefined;

  constructor(readonly kind: 'NOT_FOUND' | 'READ_FAILED' | 'DEFINITE_REJECTION' | 'AMBIGUOUS_WRITE') {
    super(kind);
    this.name = 'FakeSheetsError';
    this.writeOutcome = kind === 'DEFINITE_REJECTION'
      ? 'DEFINITELY_NOT_APPLIED'
      : kind === 'AMBIGUOUS_WRITE' ? 'AMBIGUOUS' : undefined;
  }
}

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

function parseAddress(address: string): { rowNumber: number; columnNumber: number } {
  const match = /^([A-Z]{1,3})([1-9]\d*)$/i.exec(address);
  if (!match) throw new Error('FAKE_RANGE_INVALID');
  let columnNumber = 0;
  for (const letter of match[1].toUpperCase()) {
    columnNumber = columnNumber * 26 + letter.charCodeAt(0) - 64;
  }
  return { rowNumber: Number(match[2]), columnNumber };
}

function cloneCell(input: FakeCellInput): FakeCellState {
  if (typeof input === 'string') return { value: input, displayValue: input };
  if (!input) return {};
  return structuredClone(input);
}

function formattedValue(cell: FakeCellState): string {
  return cell.displayValue ?? cell.value ?? cell.formula ?? '';
}

function worksheetKey(spreadsheetId: string, title: string): string {
  return `${spreadsheetId}:${title}`;
}

export class FakeGoogleSheetsAdapter implements GoogleSheetsAdapter {
  readonly resolveRequests: Array<{ spreadsheetId: string; worksheetTitle: string }> = [];
  readonly metadataSearchRequests: Array<{ spreadsheetId: string; metadataKey: string; visibility: 'PROJECT' }> = [];
  readonly requestedReadRanges: string[] = [];
  readonly requestedWriteRanges: string[][] = [];
  readonly writeBatches: Array<{
    readonly worksheet: WorksheetReference;
    readonly writes: readonly AnswerCellWrite[];
  }> = [];
  readonly exportBatches: Array<{
    readonly worksheet: WorksheetReference;
    readonly writes: readonly AnswerCellWrite[];
    readonly anchors: readonly ExportDimensionAnchor[];
  }> = [];

  nextWriteFailure: FakeWriteFailure | null = null;
  failNextRead = false;
  failReadsRemaining = 0;
  readonly writeFailures: FakeWriteFailure[] = [];
  #unavailableReadsRemaining = 0;
  readonly #worksheets = new Map<string, {
    readonly worksheet: WorksheetReference;
    rowCount: number;
    readonly columnCount: number;
    readonly cells: Map<string, FakeCellState>;
    developerMetadata: FakeDeveloperMetadataFixture[];
  }>();

  constructor(fixtures: readonly FakeWorksheetFixture[] = []) {
    for (const fixture of fixtures) this.addWorksheet(fixture);
  }

  addWorksheet(fixture: FakeWorksheetFixture): void {
    const cells = new Map<string, FakeCellState>();
    for (const [address, input] of Object.entries(fixture.cells ?? {})) {
      const { rowNumber, columnNumber } = parseAddress(address);
      if (rowNumber > fixture.rowCount || columnNumber > fixture.columnCount) {
        throw new Error('FAKE_CELL_OUTSIDE_GRID');
      }
      cells.set(address.toUpperCase(), cloneCell(input));
    }
    this.#worksheets.set(
      worksheetKey(fixture.worksheet.spreadsheetId, fixture.worksheet.worksheetTitle),
      {
        worksheet: structuredClone(fixture.worksheet),
        rowCount: fixture.rowCount,
        columnCount: fixture.columnCount,
        cells,
        developerMetadata: (fixture.developerMetadata ?? []).map((metadata) => ({ ...metadata })),
      },
    );
  }

  async resolveWorksheet(spreadsheetId: string, worksheetTitle: string): Promise<ResolvedWorksheet> {
    this.resolveRequests.push({ spreadsheetId, worksheetTitle });
    const worksheet = this.#worksheets.get(worksheetKey(spreadsheetId, worksheetTitle));
    if (!worksheet) throw new FakeSheetsError('NOT_FOUND');
    return {
      worksheet: structuredClone(worksheet.worksheet),
      rowCount: worksheet.rowCount,
      columnCount: worksheet.columnCount,
    };
  }

  async readWorksheet(resolved: ResolvedWorksheet): Promise<WorksheetGrid> {
    const { worksheet } = resolved;
    const state = this.#worksheets.get(worksheetKey(worksheet.spreadsheetId, worksheet.worksheetTitle));
    if (!state || state.worksheet.sheetId !== worksheet.sheetId) {
      throw new FakeSheetsError('NOT_FOUND');
    }
    this.requestedReadRanges.push(
      `'${worksheet.worksheetTitle.replace(/'/g, "''")}'!A1:${columnToLetters(state.columnCount)}${state.rowCount}`,
    );
    if (this.failNextRead || this.failReadsRemaining > 0 || this.#unavailableReadsRemaining > 0) {
      this.failNextRead = false;
      if (this.failReadsRemaining > 0) this.failReadsRemaining -= 1;
      if (this.#unavailableReadsRemaining > 0) this.#unavailableReadsRemaining -= 1;
      throw new FakeSheetsError('READ_FAILED');
    }

    const values = Array.from({ length: state.rowCount }, (_, rowIndex) =>
      Array.from({ length: state.columnCount }, (_, columnIndex) => {
        const address = `${columnToLetters(columnIndex + 1)}${rowIndex + 1}`;
        return formattedValue(state.cells.get(address) ?? {});
      }),
    );
    const rawValues = Array.from({ length: state.rowCount }, (_, rowIndex) =>
      Array.from({ length: state.columnCount }, (_, columnIndex) => {
        const address = `${columnToLetters(columnIndex + 1)}${rowIndex + 1}`;
        const cell = state.cells.get(address);
        if (cell?.formula !== undefined) return JSON.stringify({ formulaValue: cell.formula });
        if (cell?.value !== undefined) return JSON.stringify({ stringValue: cell.value });
        return null;
      }),
    );
    return {
      worksheet: structuredClone(state.worksheet),
      rowCount: state.rowCount,
      columnCount: state.columnCount,
      values,
      rawValues,
    };
  }

  async searchDeveloperMetadata(
    spreadsheetId: string,
    metadataKey: string,
    visibility: 'PROJECT',
  ): Promise<readonly DeveloperMetadataRecord[]> {
    this.metadataSearchRequests.push({ spreadsheetId, metadataKey, visibility });
    return [...this.#worksheets.values()]
      .filter((state) => state.worksheet.spreadsheetId === spreadsheetId)
      .flatMap((state) => state.developerMetadata
        .filter((metadata) => metadata.metadataKey === metadataKey && metadata.visibility === visibility)
        .map((metadata) => ({
          ...metadata,
          ...(metadata.sheetId === undefined ? { sheetId: state.worksheet.sheetId } : {}),
          ...(metadata.locationType === 'ROW' || metadata.locationType === 'COLUMN'
            ? { dimension: metadata.locationType }
            : {}),
          ...(metadata.metadataId === undefined ? {} : { metadataId: metadata.metadataId }),
        })));
  }

  async batchWriteValues(resolved: ResolvedWorksheet, writes: readonly AnswerCellWrite[]): Promise<void> {
    const { worksheet } = resolved;
    const state = this.#worksheets.get(worksheetKey(worksheet.spreadsheetId, worksheet.worksheetTitle));
    if (!state || state.worksheet.sheetId !== worksheet.sheetId) {
      throw new FakeSheetsError('DEFINITE_REJECTION');
    }

    const copiedWrites = structuredClone(writes);
    this.writeBatches.push({ worksheet: structuredClone(worksheet), writes: copiedWrites });
    this.requestedWriteRanges.push(copiedWrites.map((write) => (
      `${columnToLetters(write.answerColumnNumber)}${write.rowNumber}`
    )));

    for (const write of copiedWrites) {
      if (
        write.rowNumber < 1
        || write.rowNumber > state.rowCount
        || write.answerColumnNumber < 1
        || write.answerColumnNumber > state.columnCount
      ) {
        throw new FakeSheetsError('DEFINITE_REJECTION');
      }
    }

    const failure = this.writeFailures.shift() ?? this.nextWriteFailure;
    if (failure === this.nextWriteFailure) this.nextWriteFailure = null;
    if (failure?.kind === 'DEFINITE_REJECTION') {
      throw new FakeSheetsError('DEFINITE_REJECTION');
    }

    if (failure?.kind === 'LOST_RESPONSE') {
      if (failure.commit === 'FULL') this.applyWrites(state.cells, copiedWrites);
      if (failure.readBack === 'UNAVAILABLE') this.#unavailableReadsRemaining = 3;
      throw new FakeSheetsError('AMBIGUOUS_WRITE');
    }

    this.applyWrites(state.cells, copiedWrites);
  }

  async batchExport(
    resolved: ResolvedWorksheet,
    writes: readonly AnswerCellWrite[],
    anchors: readonly ExportDimensionAnchor[],
  ): Promise<void> {
    const { worksheet } = resolved;
    const state = this.#worksheets.get(worksheetKey(worksheet.spreadsheetId, worksheet.worksheetTitle));
    if (!state || state.worksheet.sheetId !== worksheet.sheetId) throw new FakeSheetsError('DEFINITE_REJECTION');
    const copiedWrites = structuredClone(writes);
    const copiedAnchors = structuredClone(anchors);
    this.writeBatches.push({ worksheet: structuredClone(worksheet), writes: copiedWrites });
    this.requestedWriteRanges.push(copiedWrites.map((write) => (
      `${columnToLetters(write.answerColumnNumber)}${write.rowNumber}`
    )));
    this.exportBatches.push({ worksheet: structuredClone(worksheet), writes: copiedWrites, anchors: copiedAnchors });

    const cells = new Set<string>();
    for (const write of copiedWrites) {
      const cell = `${write.rowNumber}:${write.answerColumnNumber}`;
      if (cells.has(cell)
        || write.rowNumber < 1 || write.rowNumber > state.rowCount
        || write.answerColumnNumber < 1 || write.answerColumnNumber > state.columnCount) {
        throw new FakeSheetsError('DEFINITE_REJECTION');
      }
      cells.add(cell);
    }
    const metadataIds = new Set<number>();
    for (const anchor of copiedAnchors) {
      const limit = anchor.dimension === 'ROW' ? state.rowCount : state.columnCount;
      if (anchor.sheetId !== worksheet.sheetId
        || !Number.isSafeInteger(anchor.metadataId) || anchor.metadataId <= 0
        || metadataIds.has(anchor.metadataId)
        || !Number.isInteger(anchor.coordinate) || anchor.coordinate < 1 || anchor.coordinate > limit) {
        throw new FakeSheetsError('DEFINITE_REJECTION');
      }
      metadataIds.add(anchor.metadataId);
    }

    const failure = this.writeFailures.shift() ?? this.nextWriteFailure;
    if (failure === this.nextWriteFailure) this.nextWriteFailure = null;
    if (failure?.kind === 'DEFINITE_REJECTION') throw new FakeSheetsError('DEFINITE_REJECTION');
    if (failure?.kind === 'LOST_RESPONSE') {
      if (failure.commit === 'FULL') {
        this.applyWrites(state.cells, copiedWrites);
        this.applyAnchors(state.developerMetadata, copiedAnchors);
      }
      if (failure.readBack === 'UNAVAILABLE') this.#unavailableReadsRemaining = 3;
      throw new FakeSheetsError('AMBIGUOUS_WRITE');
    }
    this.applyWrites(state.cells, copiedWrites);
    this.applyAnchors(state.developerMetadata, copiedAnchors);
  }

  getCellState(worksheet: WorksheetReference, address: string): FakeCellState {
    const state = this.#worksheets.get(worksheetKey(worksheet.spreadsheetId, worksheet.worksheetTitle));
    if (!state) throw new Error('FAKE_WORKSHEET_NOT_FOUND');
    return structuredClone(state.cells.get(address.toUpperCase()) ?? {});
  }

  setCellState(worksheet: WorksheetReference, address: string, input: FakeCellInput): void {
    const state = this.#worksheets.get(worksheetKey(worksheet.spreadsheetId, worksheet.worksheetTitle));
    if (!state) throw new Error('FAKE_WORKSHEET_NOT_FOUND');
    state.cells.set(address.toUpperCase(), cloneCell(input));
  }

  getDeveloperMetadata(worksheet: WorksheetReference): readonly FakeDeveloperMetadataFixture[] {
    const state = this.#worksheets.get(worksheetKey(worksheet.spreadsheetId, worksheet.worksheetTitle));
    if (!state) throw new Error('FAKE_WORKSHEET_NOT_FOUND');
    return structuredClone(state.developerMetadata);
  }

  removeDeveloperMetadata(worksheet: WorksheetReference, metadataId: number): void {
    const state = this.#worksheets.get(worksheetKey(worksheet.spreadsheetId, worksheet.worksheetTitle));
    if (!state) throw new Error('FAKE_WORKSHEET_NOT_FOUND');
    state.developerMetadata = state.developerMetadata.filter((metadata) => metadata.metadataId !== metadataId);
  }

  insertBlankRowBefore(worksheet: WorksheetReference, rowNumber: number): void {
    const state = this.#worksheets.get(worksheetKey(worksheet.spreadsheetId, worksheet.worksheetTitle));
    if (!state || rowNumber < 1 || rowNumber > state.rowCount + 1) throw new Error('FAKE_ROW_INVALID');
    const shiftedCells = new Map<string, FakeCellState>();
    for (const [address, cell] of state.cells) {
      const { rowNumber: existingRow, columnNumber } = parseAddress(address);
      const targetRow = existingRow >= rowNumber ? existingRow + 1 : existingRow;
      shiftedCells.set(`${columnToLetters(columnNumber)}${targetRow}`, cell);
    }
    state.cells.clear();
    for (const [address, cell] of shiftedCells) state.cells.set(address, cell);
    state.rowCount += 1;
    state.developerMetadata = state.developerMetadata.map((metadata) => (
      metadata.locationType === 'ROW'
        && (metadata.sheetId === undefined || metadata.sheetId === worksheet.sheetId)
        && metadata.coordinate !== undefined
        && metadata.coordinate >= rowNumber
        ? {
          ...metadata,
          coordinate: metadata.coordinate + 1,
          ...(metadata.endCoordinate === undefined ? {} : { endCoordinate: metadata.endCoordinate + 1 }),
        }
        : metadata
    ));
  }

  private applyWrites(cells: Map<string, FakeCellState>, writes: readonly AnswerCellWrite[]): void {
    for (const write of writes) {
      const address = `${columnToLetters(write.answerColumnNumber)}${write.rowNumber}`;
      const original = cells.get(address) ?? {};
      const next: FakeCellState = { ...original, value: write.value, displayValue: write.value };
      delete (next as { formula?: string }).formula;
      cells.set(address, next);
    }
  }

  private applyAnchors(
    metadata: FakeDeveloperMetadataFixture[],
    anchors: readonly ExportDimensionAnchor[],
  ): void {
    for (const anchor of anchors) {
      metadata.push({
        metadataId: anchor.metadataId,
        metadataKey: 'sb004',
        metadataValue: `v1:${anchor.attemptToken}:${anchor.dimension}:${anchor.sheetId}:${anchor.coordinate}`,
        visibility: 'PROJECT',
        locationType: anchor.dimension,
        sheetId: anchor.sheetId,
        coordinate: anchor.coordinate,
        endCoordinate: anchor.coordinate + 1,
      });
    }
  }
}
