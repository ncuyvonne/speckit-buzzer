import type {
  AnswerCellWrite,
  GoogleSheetsAdapter,
  ResolvedWorksheet,
  WorksheetGrid,
} from '../../src/integrations/google-sheets/types.js';
import type { WriteOutcome } from '../../src/integrations/google-sheets/errors.js';
import type { WorksheetReference } from '../../src/guided-notes/types.js';

export interface FakeCellState {
  readonly value?: string;
  readonly formula?: string;
  readonly displayValue?: string;
  readonly note?: string;
  readonly userEnteredFormat?: Readonly<Record<string, unknown>>;
}

export type FakeCellInput = string | FakeCellState | null | undefined;

export interface FakeWorksheetFixture {
  readonly worksheet: WorksheetReference;
  readonly rowCount: number;
  readonly columnCount: number;
  /** Sparse A1-keyed contents; omitted cells are blank. */
  readonly cells?: Readonly<Record<string, FakeCellInput>>;
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
  readonly requestedReadRanges: string[] = [];
  readonly requestedWriteRanges: string[][] = [];
  readonly writeBatches: Array<{
    readonly worksheet: WorksheetReference;
    readonly writes: readonly AnswerCellWrite[];
  }> = [];

  nextWriteFailure: FakeWriteFailure | null = null;
  failNextRead = false;
  failReadsRemaining = 0;
  readonly writeFailures: FakeWriteFailure[] = [];
  #unavailableReadsRemaining = 0;
  readonly #worksheets = new Map<string, {
    readonly worksheet: WorksheetReference;
    readonly rowCount: number;
    readonly columnCount: number;
    readonly cells: Map<string, FakeCellState>;
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
    return {
      worksheet: structuredClone(state.worksheet),
      rowCount: state.rowCount,
      columnCount: state.columnCount,
      values,
    };
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

  getCellState(worksheet: WorksheetReference, address: string): FakeCellState {
    const state = this.#worksheets.get(worksheetKey(worksheet.spreadsheetId, worksheet.worksheetTitle));
    if (!state) throw new Error('FAKE_WORKSHEET_NOT_FOUND');
    return structuredClone(state.cells.get(address.toUpperCase()) ?? {});
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
}
