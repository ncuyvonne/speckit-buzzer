import type { ActivityStage } from '../domain/activity-state.js';
import { ConfigurationError } from '../config.js';
import { googleHttpStatus, GoogleSheetsIntegrationError } from '../integrations/google-sheets/errors.js';
import type { AnswerCellWrite, GoogleSheetsAdapter, WorksheetGrid } from '../integrations/google-sheets/types.js';
import type { GuidedNotesOperationType, Question, WinningResultsSnapshot, WorksheetReference } from './types.js';
import { mapActivityAnswersToWrites, parseWorksheet, WorksheetParserError } from './worksheet-parser.js';

export type GuidedNotesServiceErrorCode =
  | 'GUIDED_NOTES_BUSY'
  | 'STAGE_CONFLICT'
  | 'SHEETS_NOT_CONFIGURED'
  | 'SHEET_REFERENCE_INVALID'
  | 'SHEET_ACCESS_DENIED'
  | 'SHEET_NOT_FOUND'
  | 'SHEET_LAYOUT_INVALID'
  | 'QUESTION_IDS_INVALID'
  | 'SHEET_READ_FAILED'
  | 'WORKSHEET_NOT_IMPORTED'
  | 'WINNING_RESULTS_UNAVAILABLE'
  | 'QUESTION_TARGET_INVALID'
  | 'SHEET_WRITE_FAILED'
  | 'SHEET_WRITE_UNCONFIRMED';

export class GuidedNotesServiceError extends Error {
  constructor(readonly code: GuidedNotesServiceErrorCode, message: string = code) {
    super(message);
    this.name = 'GuidedNotesServiceError';
  }
}

export class GuidedNotesOperationError extends GuidedNotesServiceError {
  constructor() {
    super('GUIDED_NOTES_BUSY', 'GUIDED_NOTES_BUSY');
    this.name = 'GuidedNotesOperationError';
  }
}

export interface ImportWorksheetCommand {
  readonly spreadsheetUrl: string;
  readonly worksheetTitle: string;
}

export interface ImportWorksheetResult {
  readonly worksheetTitle: string;
  readonly questionIds: readonly string[];
  readonly questionCount: number;
}

export interface ExportAnswersResult {
  readonly writtenCellCount: number;
  readonly clearedCellCount: number;
}

/** Implemented by the server-owned Feature 003 results source. */
export interface WinningResultsProvider {
  getSnapshot(): Promise<WinningResultsSnapshot>;
}

/** Read-only view of server-owned stage state used by the Guided Notes workflow. */
export interface GuidedNotesActivityPort {
  readonly stage: ActivityStage;
  readonly worksheet: WorksheetReference | null;
  readonly questions: readonly Question[];
  readonly questionCount: number;
  replaceGuidedNotesImport(worksheet: WorksheetReference, questions: readonly Question[]): boolean;
}

export interface GuidedNotesServiceDependencies {
  readonly activity: GuidedNotesActivityPort;
  readonly sheets: GoogleSheetsAdapter;
  readonly winningResultsProvider: WinningResultsProvider;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

interface OperationContext {
  readonly operationType: GuidedNotesOperationType;
  readonly deadlineAt: number;
  retryCount: number;
  writeMayHaveApplied: boolean;
}

const OPERATION_DEADLINE_MS = 10_000;
const RETRY_DELAYS_MS = [250, 500] as const;

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createDeadlineError(context: OperationContext): GuidedNotesServiceError {
  if (context.operationType === 'IMPORT') {
    return new GuidedNotesServiceError(
      'SHEET_READ_FAILED',
      '讀取試算表超過 10 秒，題號清單未更新；請檢查連線後再試。',
    );
  }
  if (context.writeMayHaveApplied) {
    return new GuidedNotesServiceError(
      'SHEET_WRITE_UNCONFIRMED',
      '寫回超過 10 秒，結果未確認；請先檢查試算表再決定是否重試。',
    );
  }
  return new GuidedNotesServiceError(
    'SHEET_WRITE_FAILED',
    '寫回操作超過 10 秒，尚未確認任何更新；請檢查連線後再試。',
  );
}

function isRetryableReadError(error: unknown): boolean {
  if (error instanceof GuidedNotesServiceError || error instanceof WorksheetParserError || error instanceof ConfigurationError) {
    return false;
  }
  if (error instanceof GoogleSheetsIntegrationError) return error.code === 'SHEET_READ_FAILED';
  if (typeof error === 'object' && error !== null) {
    const kind = (error as { kind?: unknown }).kind;
    if (kind === 'NOT_FOUND') return false;
    if (kind === 'READ_FAILED') return true;
  }
  const status = googleHttpStatus(error);
  if (status === 403 || status === 404) return false;
  if (status !== undefined) return status === 429 || status >= 500;
  return true;
}

/**
 * Serializes external Guided Notes work in the single-process activity.
 * Import/export methods added in later phases must use runExclusive; request
 * payloads never supply the stage, results provider, or target answers.
 */
export class GuidedNotesService {
  #activeOperation: GuidedNotesOperationType | null = null;
  #activeOperationId: symbol | null = null;
  readonly #dependencies: GuidedNotesServiceDependencies;
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(dependencies: GuidedNotesServiceDependencies) {
    this.#dependencies = dependencies;
    this.#now = dependencies.now ?? Date.now;
    this.#sleep = dependencies.sleep ?? defaultSleep;
  }

  get activeOperation(): GuidedNotesOperationType | null {
    return this.#activeOperation;
  }

  async runExclusive<T>(
    operationType: GuidedNotesOperationType,
    operation: (dependencies: GuidedNotesServiceDependencies, context: OperationContext) => Promise<T>,
  ): Promise<T> {
    if (this.#activeOperation !== null) {
      throw new GuidedNotesOperationError();
    }

    const operationId = Symbol(operationType);
    this.#activeOperation = operationType;
    this.#activeOperationId = operationId;
    const context: OperationContext = {
      operationType,
      deadlineAt: this.#now() + OPERATION_DEADLINE_MS,
      retryCount: 0,
      writeMayHaveApplied: false,
    };
    const pending = Promise.resolve().then(() => operation(this.#dependencies, context));
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          reject(createDeadlineError(context));
        }, OPERATION_DEADLINE_MS);
      });
      return await Promise.race([pending, deadline]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (timedOut) {
        void pending.then(() => this.#releaseOperation(operationId), () => this.#releaseOperation(operationId));
      } else {
        this.#releaseOperation(operationId);
      }
    }
  }

  #releaseOperation(operationId: symbol): void {
    if (this.#activeOperationId !== operationId) return;
    this.#activeOperationId = null;
    this.#activeOperation = null;
  }

  #assertBeforeDeadline(context: OperationContext): void {
    if (this.#now() >= context.deadlineAt) throw createDeadlineError(context);
  }

  async #waitBeforeRetry(context: OperationContext): Promise<void> {
    this.#assertBeforeDeadline(context);
    const delay = RETRY_DELAYS_MS[context.retryCount];
    if (delay === undefined || context.deadlineAt - this.#now() <= delay) {
      throw createDeadlineError(context);
    }
    context.retryCount += 1;
    await this.#sleep(delay);
    this.#assertBeforeDeadline(context);
  }

  async #readWithRetry<T>(context: OperationContext, read: () => Promise<T>): Promise<T> {
    while (true) {
      this.#assertBeforeDeadline(context);
      try {
        const result = await read();
        this.#assertBeforeDeadline(context);
        return result;
      } catch (error) {
        if (!isRetryableReadError(error) || context.retryCount >= RETRY_DELAYS_MS.length) throw error;
        await this.#waitBeforeRetry(context);
      }
    }
  }

  async #writeWithRetry(
    context: OperationContext,
    write: () => Promise<void>,
  ): Promise<void> {
    while (true) {
      this.#assertBeforeDeadline(context);
      context.writeMayHaveApplied = true;
      try {
        await write();
        context.writeMayHaveApplied = false;
        this.#assertBeforeDeadline(context);
        return;
      } catch (error) {
        if (getWriteOutcome(error) !== 'DEFINITELY_NOT_APPLIED') throw error;
        context.writeMayHaveApplied = false;
        if (context.retryCount >= RETRY_DELAYS_MS.length) throw error;
        await this.#waitBeforeRetry(context);
      }
    }
  }

  async importWorksheet(command: ImportWorksheetCommand): Promise<ImportWorksheetResult> {
    try {
      return await this.runExclusive('IMPORT', async ({ activity, sheets }, context) => {
        if (activity.stage !== 'PREPARING') {
          throw new GuidedNotesServiceError('STAGE_CONFLICT', '活動已不在準備階段，請回到準備階段後再匯入。');
        }

        const spreadsheetId = parseSpreadsheetId(command.spreadsheetUrl);
        if (
          typeof command.worksheetTitle !== 'string'
          || command.worksheetTitle.trim().length === 0
          || /[\u0000-\u001f\u007f]/.test(command.worksheetTitle)
        ) {
          throw new GuidedNotesServiceError('SHEET_REFERENCE_INVALID', '請提供有效的 Google 試算表網址與工作表分頁名稱。');
        }

        const resolved = await this.#readWithRetry(
          context,
          () => sheets.resolveWorksheet(spreadsheetId, command.worksheetTitle),
        );
        const grid = await this.#readWithRetry(context, () => sheets.readWorksheet(resolved));
        const parsed = parseWorksheet(grid.values);
        this.#assertBeforeDeadline(context);
        if (
          activity.stage !== 'PREPARING'
          || !activity.replaceGuidedNotesImport(resolved.worksheet, parsed.questions)
        ) {
          throw new GuidedNotesServiceError('STAGE_CONFLICT', '活動階段已變更，題號清單未更新；請確認活動階段後重試。');
        }

        return {
          worksheetTitle: resolved.worksheet.worksheetTitle,
          questionIds: parsed.questions.map((question) => question.questionId),
          questionCount: parsed.questions.length,
        };
      });
    } catch (error) {
      throw normalizeImportError(error);
    }
  }

  async exportAnswers(): Promise<ExportAnswersResult> {
    try {
      return await this.runExclusive('EXPORT', async ({ activity, sheets, winningResultsProvider }, context) => {
        if (activity.stage !== 'ENDED') {
          throw new GuidedNotesServiceError('STAGE_CONFLICT', '請先結束活動，再將答案寫回學習單。');
        }
        const worksheet = activity.worksheet;
        if (worksheet === null) {
          throw new GuidedNotesServiceError('WORKSHEET_NOT_IMPORTED', '目前活動尚未匯入學習單，請先在準備階段匯入。');
        }

        this.#assertBeforeDeadline(context);
        const results = await winningResultsProvider.getSnapshot();
        this.#assertBeforeDeadline(context);
        if (results.status !== 'READY') {
          throw new GuidedNotesServiceError(
            'WINNING_RESULTS_UNAVAILABLE',
            '搶答結果尚未就緒，請稍後再試；目前不會寫入學習單。',
          );
        }

        const resolved = await this.#readWithRetry(
          context,
          () => sheets.resolveWorksheet(worksheet.spreadsheetId, worksheet.worksheetTitle),
        );
        if (resolved.worksheet.sheetId !== worksheet.sheetId) {
          throw new GuidedNotesServiceError('SHEET_NOT_FOUND', '找不到原本匯入的工作表分頁，請確認分頁名稱。');
        }
        const grid = await this.#readWithRetry(context, () => sheets.readWorksheet(resolved));
        const writes = mapActivityAnswersToWrites(grid.values, activity.questions, results.answers);
        const previousValues = writes.map((write) => worksheetCellValue(grid, write));
        const winnerIds = new Set(results.answers.map((answer) => answer.questionId));
        const successResult = createExportResult(writes, winnerIds);

        try {
          await this.#writeWithRetry(context, () => sheets.batchWriteValues(resolved, writes));
          return successResult;
        } catch (writeError) {
          if (getWriteOutcome(writeError) === 'DEFINITELY_NOT_APPLIED') throw normalizeExportError(writeError);

          let readBack: WorksheetGrid;
          try {
            readBack = await this.#readWithRetry(context, () => sheets.readWorksheet(resolved));
          } catch {
            throw new GuidedNotesServiceError(
              'SHEET_WRITE_UNCONFIRMED',
              '寫回結果未確認，請先檢查試算表再決定是否重試。',
            );
          }

          if (writes.every((write) => worksheetCellValue(readBack, write) === write.value)) {
            context.writeMayHaveApplied = false;
            return successResult;
          }
          if (writes.every((write, index) => worksheetCellValue(readBack, write) === previousValues[index])) {
            context.writeMayHaveApplied = false;
            throw new GuidedNotesServiceError(
              'SHEET_WRITE_FAILED',
              '寫回未套用，學習單資料未變更；請檢查權限或連線後再試。',
            );
          }
          throw new GuidedNotesServiceError(
            'SHEET_WRITE_UNCONFIRMED',
            '寫回結果未確認，請先檢查試算表再決定是否重試。',
          );
        }
      });
    } catch (error) {
      throw normalizeExportError(error);
    }
  }
}

function worksheetCellValue(grid: WorksheetGrid, write: AnswerCellWrite): string {
  return grid.values[write.rowNumber - 1]?.[write.answerColumnNumber - 1] ?? '';
}

function createExportResult(writes: readonly AnswerCellWrite[], winnerIds: ReadonlySet<string>): ExportAnswersResult {
  return {
    writtenCellCount: writes.filter((write) => winnerIds.has(write.questionId)).length,
    clearedCellCount: writes.filter((write) => !winnerIds.has(write.questionId)).length,
  };
}

function getWriteOutcome(error: unknown): 'DEFINITELY_NOT_APPLIED' | 'AMBIGUOUS' | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if (error instanceof GoogleSheetsIntegrationError) {
    if (error.writeOutcome !== undefined) return error.writeOutcome;
    if (error.code === 'SHEETS_NOT_CONFIGURED' || error.code === 'SHEET_ACCESS_DENIED' || error.code === 'SHEET_NOT_FOUND') {
      return 'DEFINITELY_NOT_APPLIED';
    }
  }
  const outcome = (error as { writeOutcome?: unknown }).writeOutcome;
  if (outcome === 'DEFINITELY_NOT_APPLIED' || outcome === 'AMBIGUOUS') return outcome;
  const kind = (error as { kind?: unknown }).kind;
  if (kind === 'DEFINITE_REJECTION') return 'DEFINITELY_NOT_APPLIED';
  if (kind === 'AMBIGUOUS_WRITE') return 'AMBIGUOUS';
  return undefined;
}

function fakeSheetsErrorKind(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const kind = (error as { kind?: unknown }).kind;
  return typeof kind === 'string' ? kind : undefined;
}

function parseSpreadsheetId(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new GuidedNotesServiceError('SHEET_REFERENCE_INVALID', '請提供有效的 Google 試算表網址。');
  }

  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname);
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'docs.google.com'
    || url.username.length > 0
    || url.password.length > 0
    || !match
  ) {
    throw new GuidedNotesServiceError('SHEET_REFERENCE_INVALID', '請提供有效的 Google 試算表網址。');
  }
  return match[1]!;
}

function normalizeImportError(error: unknown): GuidedNotesServiceError {
  if (error instanceof GuidedNotesServiceError) return error;
  if (error instanceof WorksheetParserError) return new GuidedNotesServiceError(error.code, error.message);
  if (error instanceof ConfigurationError) {
    return new GuidedNotesServiceError('SHEETS_NOT_CONFIGURED', 'Google Sheets 尚未完成本機設定，請檢查環境變數。');
  }
  if (fakeSheetsErrorKind(error) === 'NOT_FOUND') {
    return new GuidedNotesServiceError('SHEET_NOT_FOUND', '找不到指定的試算表或工作表分頁，請檢查網址與分頁名稱。');
  }
  if (fakeSheetsErrorKind(error) === 'READ_FAILED') {
    return new GuidedNotesServiceError('SHEET_READ_FAILED', '目前無法讀取試算表，請檢查網路或存取權限後再試。');
  }
  if (error instanceof GoogleSheetsIntegrationError) {
    const messages: Partial<Record<GuidedNotesServiceErrorCode, string>> = {
      SHEETS_NOT_CONFIGURED: 'Google Sheets 尚未完成本機設定，請檢查環境變數。',
      SHEET_ACCESS_DENIED: '無法讀取此試算表，請確認已將工作表分享給系統服務帳戶。',
      SHEET_NOT_FOUND: '找不到指定的試算表或工作表分頁，請檢查網址與分頁名稱。',
      SHEET_READ_FAILED: '目前無法讀取試算表，請檢查網路或存取權限後再試。',
    };
    return new GuidedNotesServiceError(error.code, messages[error.code] ?? '目前無法完成試算表操作，請稍後再試。');
  }
  return new GuidedNotesServiceError('SHEET_READ_FAILED', '目前無法讀取試算表，請檢查網路或存取權限後再試。');
}

function normalizeExportError(error: unknown): GuidedNotesServiceError {
  if (error instanceof GuidedNotesServiceError) return error;
  if (error instanceof WorksheetParserError) {
    if (error.code === 'QUESTION_TARGET_INVALID') return new GuidedNotesServiceError(error.code, error.message);
    return new GuidedNotesServiceError(error.code, error.message);
  }
  if (error instanceof ConfigurationError) {
    return new GuidedNotesServiceError('SHEETS_NOT_CONFIGURED', 'Google Sheets 尚未完成本機設定，請檢查環境變數。');
  }
  const fakeErrorKind = fakeSheetsErrorKind(error);
  if (fakeErrorKind === 'NOT_FOUND') {
    return new GuidedNotesServiceError('SHEET_NOT_FOUND', '找不到原本匯入的試算表或工作表分頁，請檢查網址與分頁名稱。');
  }
  if (fakeErrorKind === 'READ_FAILED') {
    return new GuidedNotesServiceError('SHEET_READ_FAILED', '目前無法讀取試算表，請檢查網路或存取權限後再試。');
  }
  if (fakeErrorKind === 'DEFINITE_REJECTION') {
    return new GuidedNotesServiceError('SHEET_WRITE_FAILED', '試算表拒絕寫入，資料未變更；請檢查編輯權限或受保護儲存格。');
  }
  if (fakeErrorKind === 'AMBIGUOUS_WRITE') {
    return new GuidedNotesServiceError('SHEET_WRITE_UNCONFIRMED', '寫回結果未確認，請先檢查試算表再決定是否重試。');
  }
  if (error instanceof GoogleSheetsIntegrationError) {
    const messages: Partial<Record<GuidedNotesServiceErrorCode, string>> = {
      SHEETS_NOT_CONFIGURED: 'Google Sheets 尚未完成本機設定，請檢查環境變數。',
      SHEET_ACCESS_DENIED: '無法寫入此試算表，請確認服務帳戶具有編輯權限。',
      SHEET_NOT_FOUND: '找不到原本匯入的試算表或工作表分頁，請檢查網址與分頁名稱。',
      SHEET_READ_FAILED: '目前無法讀取試算表，請檢查網路或存取權限後再試。',
      SHEET_WRITE_FAILED: '試算表拒絕寫入，資料未變更；請檢查編輯權限或受保護儲存格。',
      SHEET_WRITE_UNCONFIRMED: '寫回結果未確認，請先檢查試算表再決定是否重試。',
    };
    return new GuidedNotesServiceError(error.code, messages[error.code] ?? '目前無法完成試算表操作，請稍後再試。');
  }
  return new GuidedNotesServiceError('SHEET_WRITE_FAILED', '目前無法寫回試算表，請檢查權限或網路後再試。');
}
