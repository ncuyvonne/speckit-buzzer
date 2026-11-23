import type { ActivityStage } from '../domain/activity-state.js';
import { randomInt, randomUUID } from 'node:crypto';
import { ConfigurationError, MAX_MESSAGE_BYTES } from '../config.js';
import { googleHttpStatus, GoogleSheetsIntegrationError } from '../integrations/google-sheets/errors.js';
import type { AnswerCellWrite, DeveloperMetadataRecord, GoogleSheetsAdapter, WorksheetGrid } from '../integrations/google-sheets/types.js';
import type {
  ExportAnchorState,
  ExportManifest,
  GuidedNotesOperationType,
  Question,
  QuestionLayoutSummary,
  WinningResultsSnapshot,
  WorksheetReference,
} from './types.js';
import {
  createExportManifest,
  mapActivityAnswersToTargets,
  mapAnswersToManifestWrites,
  parseWorksheet,
  validateConfirmedExportManifest,
  WorksheetParserError,
} from './worksheet-parser.js';

export type GuidedNotesServiceErrorCode =
  | 'GUIDED_NOTES_BUSY'
  | 'STAGE_CONFLICT'
  | 'SHEETS_NOT_CONFIGURED'
  | 'SHEET_REFERENCE_INVALID'
  | 'SHEET_ACCESS_DENIED'
  | 'SHEET_NOT_FOUND'
  | 'SHEET_LAYOUT_INVALID'
  | 'QUESTION_IDS_INVALID'
  | 'WORKSHEET_ALREADY_EXPORTED'
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
  readonly questionLayouts: readonly QuestionLayoutSummary[];
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
  readonly exportAnchorState: ExportAnchorState;
  replaceGuidedNotesImport(worksheet: WorksheetReference, questions: readonly Question[]): boolean;
  setExportAnchorState(state: ExportAnchorState): void;
}

export interface GuidedNotesServiceDependencies {
  readonly activity: GuidedNotesActivityPort;
  readonly sheets: GoogleSheetsAdapter;
  readonly winningResultsProvider: WinningResultsProvider;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  /** Runs synchronously after the worksheet/questions have been committed. */
  readonly onImportCommitted?: () => void;
}

interface OperationContext {
  readonly operationType: GuidedNotesOperationType;
  readonly deadlineAt: number;
  writeMayHaveApplied: boolean;
}

const OPERATION_DEADLINE_MS = 10_000;
const RETRY_DELAYS_MS = [250, 500] as const;
const GROUP_MINIMUM_REQUEST_ID = '123e4567-e89b-12d3-a456-426614174000';

function minimumGroupSubmissionBytes(question: Question): number | null {
  if (question.kind !== 'GROUP') return null;
  const request = {
    type: 'buzzerResults.submitAnswer',
    requestId: GROUP_MINIMUM_REQUEST_ID,
    payload: {
      questionId: question.questionId,
      subAnswers: question.answerSlots.map(({ placeholderNumber }) => ({
        placeholderNumber,
        answerText: 'a',
      })),
    },
  };
  return Buffer.byteLength(JSON.stringify(request), 'utf8');
}

function questionLayoutSummary(question: Question): QuestionLayoutSummary {
  return {
    questionId: question.questionId,
    kind: question.kind ?? 'SINGLE',
    answerCount: question.kind === 'GROUP' ? question.answerSlots.length : 1,
  };
}

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
      '寫回超過 10 秒，結果未確認；批次可能仍會完成。請先檢查試算表，再決定是否重試。',
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
  #pendingRepeat: ExportManifest | null = null;
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
      if (timedOut && context.writeMayHaveApplied) {
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

  async #waitBeforeRetry(context: OperationContext, retryCount: number): Promise<void> {
    this.#assertBeforeDeadline(context);
    const delay = RETRY_DELAYS_MS[retryCount];
    if (delay === undefined || context.deadlineAt - this.#now() <= delay) {
      throw createDeadlineError(context);
    }
    await this.#sleep(delay);
    this.#assertBeforeDeadline(context);
  }

  async #readWithRetry<T>(context: OperationContext, read: () => Promise<T>): Promise<T> {
    let retryCount = 0;
    while (true) {
      this.#assertBeforeDeadline(context);
      try {
        const result = await read();
        this.#assertBeforeDeadline(context);
        return result;
      } catch (error) {
        if (!isRetryableReadError(error) || retryCount >= RETRY_DELAYS_MS.length) throw error;
        await this.#waitBeforeRetry(context, retryCount);
        retryCount += 1;
      }
    }
  }

  async #writeWithRetry(
    context: OperationContext,
    write: () => Promise<void>,
  ): Promise<void> {
    let retryCount = 0;
    while (true) {
      this.#assertBeforeDeadline(context);
      context.writeMayHaveApplied = true;
      try {
        await write();
        context.writeMayHaveApplied = false;
        return;
      } catch (error) {
        if (getWriteOutcome(error) !== 'DEFINITELY_NOT_APPLIED') throw error;
        context.writeMayHaveApplied = false;
        if (retryCount >= RETRY_DELAYS_MS.length) throw error;
        await this.#waitBeforeRetry(context, retryCount);
        retryCount += 1;
      }
    }
  }

  async #readExportEvidence(
    context: OperationContext,
    sheets: GoogleSheetsAdapter,
    worksheet: WorksheetReference,
    resolved: Awaited<ReturnType<GoogleSheetsAdapter['resolveWorksheet']>>,
  ): Promise<{ grid: WorksheetGrid; metadata: readonly DeveloperMetadataRecord[] }> {
    const metadata = await this.#readWithRetry(
      context,
      () => sheets.searchDeveloperMetadata(worksheet.spreadsheetId, 'sb004', 'PROJECT'),
    );
    const grid = await this.#readWithRetry(context, () => sheets.readWorksheet(resolved));
    return { grid, metadata };
  }

  #newExportManifest(worksheet: WorksheetReference, mapping: ReturnType<typeof mapActivityAnswersToTargets>): ExportManifest {
    const rowCoordinates = new Set([mapping.header.rowNumber, ...mapping.targets.map((target) => target.rowNumber)]);
    const columnCoordinates = new Set([mapping.header.questionColumnNumber, mapping.header.answerColumnNumber]);
    const metadataIds: number[] = [];
    const used = new Set<number>();
    while (metadataIds.length < rowCoordinates.size + columnCoordinates.size) {
      const id = randomInt(1, 2_147_483_647);
      if (used.has(id)) continue;
      used.add(id);
      metadataIds.push(id);
    }
    return createExportManifest(worksheet, mapping, randomUUID(), metadataIds);
  }

  #exportWrites(manifest: ExportManifest, questions: readonly Question[]): readonly AnswerCellWrite[] {
    const groupQuestionIds = new Set(questions
      .filter((question) => question.kind === 'GROUP')
      .map((question) => question.questionId));
    return manifest.targets.flatMap((target) => {
      if (groupQuestionIds.has(target.questionId) && target.intendedValue === null) return [];
      return [{
        questionId: target.questionId,
        rowNumber: target.rowNumber,
        answerColumnNumber: target.answerColumnNumber,
        value: target.intendedValue ?? '',
      }];
    });
  }

  #resultForManifest(manifest: ExportManifest, questions: readonly Question[]): ExportAnswersResult {
    const writes = this.#exportWrites(manifest, questions);
    const winnerIds = new Set(manifest.targets
      .filter((target) => target.intendedValue !== null)
      .map((target) => target.questionId));
    return createExportResult(writes, winnerIds);
  }

  #reconcilePreparedExport(
    activity: GuidedNotesActivityPort,
    worksheet: WorksheetReference,
    grid: WorksheetGrid,
    metadata: readonly DeveloperMetadataRecord[],
  ): ExportAnswersResult {
    const state = activity.exportAnchorState;
    if (state.status !== 'PREPARED') throw new TypeError('Export reconciliation requires PREPARED state.');
    const { manifest } = state;
    const result = this.#resultForManifest(manifest, activity.questions);

    const sheetAnchors = sheetScopedExportAnchors(metadata, worksheet);
    if (sheetAnchors.length === manifest.anchors.length) {
      validateConfirmedExportManifest(grid.values, activity.questions, worksheet, manifest, metadata);
      if (manifestTargetsMatch(grid, manifest, 'intendedValue', activity.questions)) {
        activity.setExportAnchorState({ status: 'CONFIRMED', manifest });
        return result;
      }
      throw new GuidedNotesServiceError(
        'SHEET_WRITE_UNCONFIRMED',
        '寫回錨點已建立，但答案格與預期不一致；請先檢查試算表。',
      );
    }

    if (sheetAnchors.length === 0 && firstExportStillUnapplied(grid, activity.questions, manifest)) {
      activity.setExportAnchorState({ status: 'NONE' });
      throw new GuidedNotesServiceError('SHEET_WRITE_FAILED', '寫回未套用，學習單資料未變更；請檢查連線後再試。');
    }
    throw new GuidedNotesServiceError(
      'SHEET_WRITE_UNCONFIRMED',
      '首次寫回結果未確認，批次可能已套用或仍會完成；請先檢查試算表，系統不會重送尚未確認的批次。',
    );
  }

  async importWorksheet(command: ImportWorksheetCommand): Promise<ImportWorksheetResult> {
    try {
      return await this.runExclusive('IMPORT', async ({ activity, sheets, onImportCommitted }, context) => {
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
        const metadata = await this.#readWithRetry(
          context,
          () => sheets.searchDeveloperMetadata(resolved.worksheet.spreadsheetId, 'sb004', 'PROJECT'),
        );
        if (metadata.some((record) => (
          record.metadataKey === 'sb004'
          && record.visibility === 'PROJECT'
          && (record.locationType === 'ROW' || record.locationType === 'COLUMN')
          && record.sheetId === resolved.worksheet.sheetId
        ))) {
          throw new GuidedNotesServiceError(
            'WORKSHEET_ALREADY_EXPORTED',
            '此工作表已匯出題組答案，原佔位符已被取代；錨點用來保護同一活動的重複匯出定位，系統不提供匯出後重設。請使用原始學習單，或從原始範本建立的副本，建立新活動。',
          );
        }
        const grid = await this.#readWithRetry(context, () => sheets.readWorksheet(resolved));
        const parsed = parseWorksheet(grid.values);
        for (const question of parsed.questions) {
          const minimumBytes = minimumGroupSubmissionBytes(question);
          if (minimumBytes !== null && minimumBytes > MAX_MESSAGE_BYTES) {
            throw new GuidedNotesServiceError(
              'QUESTION_IDS_INVALID',
              `題號「${question.questionId}」第 ${question.sourceRowAtImport} 列的題組，使用每格最短答案時仍需 ${minimumBytes.toLocaleString('en-US')} 位元組，超過 ${MAX_MESSAGE_BYTES.toLocaleString('en-US')} 位元組上限；請縮短題號或拆分題組。`,
            );
          }
        }
        this.#assertBeforeDeadline(context);
        if (
          activity.stage !== 'PREPARING'
          || !activity.replaceGuidedNotesImport(resolved.worksheet, parsed.questions)
        ) {
          throw new GuidedNotesServiceError('STAGE_CONFLICT', '活動階段已變更，題號清單未更新；請確認活動階段後重試。');
        }
        onImportCommitted?.();

        return {
          worksheetTitle: resolved.worksheet.worksheetTitle,
          questionIds: parsed.questions.map((question) => question.questionId),
          questionCount: parsed.questions.length,
          questionLayouts: parsed.questions.map(questionLayoutSummary),
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
        const evidence = await this.#readExportEvidence(context, sheets, worksheet, resolved);
        const state = activity.exportAnchorState;
        if (this.#pendingRepeat !== null) {
          if (state.status !== 'CONFIRMED') {
            throw new GuidedNotesServiceError('SHEET_WRITE_UNCONFIRMED', '再次寫回仍待確認；請先檢查試算表。');
          }
          const pending = this.#pendingRepeat;
          validateConfirmedExportManifest(evidence.grid.values, activity.questions, worksheet, state.manifest, evidence.metadata);
          if (manifestTargetsMatch(evidence.grid, pending, 'intendedValue', activity.questions)) {
            activity.setExportAnchorState({ status: 'CONFIRMED', manifest: pending });
            this.#pendingRepeat = null;
            return this.#resultForManifest(pending, activity.questions);
          }
          if (manifestTargetsMatch(evidence.grid, pending, 'prewriteValue', activity.questions)) {
            this.#pendingRepeat = null;
            throw new GuidedNotesServiceError('SHEET_WRITE_FAILED', '再次寫回未套用，學習單資料未變更；請檢查連線後再試。');
          }
          throw new GuidedNotesServiceError(
            'SHEET_WRITE_UNCONFIRMED',
            '再次寫回結果仍未確認；目前答案格只部分符合預期，請先檢查試算表後再重試。',
          );
        }
        if (state.status === 'PREPARED') {
          return this.#reconcilePreparedExport(activity, worksheet, evidence.grid, evidence.metadata);
        }

        if (state.status === 'CONFIRMED') {
          validateConfirmedExportManifest(evidence.grid.values, activity.questions, worksheet, state.manifest, evidence.metadata);
          const writes = mapAnswersToManifestWrites(activity.questions, results.answers, state.manifest);
          const writesByCoordinate = new Map(writes.map((write) => [`${write.rowNumber}:${write.answerColumnNumber}`, write]));
          const pendingManifest: ExportManifest = {
            ...state.manifest,
            targets: state.manifest.targets.map((target) => ({
              ...target,
              prewriteValue: worksheetCellRawValue(evidence.grid, target.rowNumber, target.answerColumnNumber),
              intendedValue: (() => {
                const write = writesByCoordinate.get(`${target.rowNumber}:${target.answerColumnNumber}`);
                return write === undefined || write.value === '' ? null : write.value;
              })(),
            })),
          };
          const successResult = this.#resultForManifest(pendingManifest, activity.questions);
          if (writes.every((write) => worksheetCellValue(evidence.grid, write) === write.value)) {
            activity.setExportAnchorState({ status: 'CONFIRMED', manifest: pendingManifest });
            return successResult;
          }

          this.#pendingRepeat = pendingManifest;
          try {
            await this.#writeWithRetry(context, () => sheets.batchExport(resolved, writes, []));
            activity.setExportAnchorState({ status: 'CONFIRMED', manifest: pendingManifest });
            this.#pendingRepeat = null;
            return successResult;
          } catch (writeError) {
            if (getWriteOutcome(writeError) === 'DEFINITELY_NOT_APPLIED') {
              this.#pendingRepeat = null;
              throw normalizeExportError(writeError);
            }
            try {
              const readBack = await this.#readExportEvidence(context, sheets, worksheet, resolved);
              validateConfirmedExportManifest(readBack.grid.values, activity.questions, worksheet, pendingManifest, readBack.metadata);
              if (manifestTargetsMatch(readBack.grid, pendingManifest, 'intendedValue', activity.questions)) {
                activity.setExportAnchorState({ status: 'CONFIRMED', manifest: pendingManifest });
                this.#pendingRepeat = null;
                context.writeMayHaveApplied = false;
                return successResult;
              }
              if (manifestTargetsMatch(readBack.grid, pendingManifest, 'prewriteValue', activity.questions)) {
                this.#pendingRepeat = null;
                context.writeMayHaveApplied = false;
                throw new GuidedNotesServiceError('SHEET_WRITE_FAILED', '再次寫回未套用，學習單資料未變更；請檢查連線後再試。');
              }
            } catch (readError) {
              if (readError instanceof GuidedNotesServiceError && readError.code !== 'SHEET_WRITE_UNCONFIRMED') throw readError;
            }
            throw new GuidedNotesServiceError(
              'SHEET_WRITE_UNCONFIRMED',
              '再次寫回結果未確認；請先檢查試算表，系統不會重送尚未確認的批次。',
            );
          }
        }

        if (sheetScopedExportAnchors(evidence.metadata, worksheet).length > 0) {
          throw new GuidedNotesServiceError(
            'WORKSHEET_ALREADY_EXPORTED',
            '此工作表已有題組匯出錨點；目前活動無法安全建立新的匯出對應。',
          );
        }
        const mapping = mapActivityAnswersToTargets(
          evidence.grid.values,
          activity.questions,
          results.answers,
          evidence.grid.rawValues,
        );
        const manifest = this.#newExportManifest(worksheet, mapping);
        const writes = this.#exportWrites(manifest, activity.questions);
        const successResult = this.#resultForManifest(manifest, activity.questions);
        activity.setExportAnchorState({ status: 'PREPARED', manifest });
        try {
          await this.#writeWithRetry(context, () => sheets.batchExport(resolved, writes, manifest.anchors));
          activity.setExportAnchorState({ status: 'CONFIRMED', manifest });
          return successResult;
        } catch (writeError) {
          try {
            const readBack = await this.#readExportEvidence(context, sheets, worksheet, resolved);
            if (firstExportCommitted(readBack.grid, activity.questions, worksheet, manifest, readBack.metadata)) {
              activity.setExportAnchorState({ status: 'CONFIRMED', manifest });
              context.writeMayHaveApplied = false;
              return successResult;
            }
            if (getWriteOutcome(writeError) === 'DEFINITELY_NOT_APPLIED'
              && sheetScopedExportAnchors(readBack.metadata, worksheet).length === 0
              && firstExportStillUnapplied(readBack.grid, activity.questions, manifest)) {
              activity.setExportAnchorState({ status: 'NONE' });
              context.writeMayHaveApplied = false;
              throw normalizeExportError(writeError);
            }
            if (getWriteOutcome(writeError) !== 'DEFINITELY_NOT_APPLIED'
              && sheetScopedExportAnchors(readBack.metadata, worksheet).length === 0
              && firstExportStillUnapplied(readBack.grid, activity.questions, manifest)) {
              activity.setExportAnchorState({ status: 'NONE' });
              context.writeMayHaveApplied = false;
              throw new GuidedNotesServiceError('SHEET_WRITE_FAILED', '寫回未套用，學習單資料未變更；請檢查連線後再試。');
            }
          } catch (readError) {
            if (readError instanceof GuidedNotesServiceError && readError.code !== 'SHEET_WRITE_UNCONFIRMED') throw readError;
          }
          throw new GuidedNotesServiceError(
            'SHEET_WRITE_UNCONFIRMED',
            '首次寫回結果未確認，批次可能已套用或仍會完成；請先檢查試算表，系統不會重送尚未確認的批次。',
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

function worksheetCellRawValue(grid: WorksheetGrid, rowNumber: number, columnNumber: number): string | null {
  return grid.rawValues[rowNumber - 1]?.[columnNumber - 1] ?? null;
}

function sheetScopedExportAnchors(
  metadata: readonly DeveloperMetadataRecord[],
  worksheet: WorksheetReference,
): readonly DeveloperMetadataRecord[] {
  return metadata.filter((record) => (
    record.metadataKey === 'sb004'
    && record.visibility === 'PROJECT'
    && (record.locationType === 'ROW' || record.locationType === 'COLUMN')
    && record.sheetId === worksheet.sheetId
  ));
}

function manifestTargetsMatch(
  grid: WorksheetGrid,
  manifest: ExportManifest,
  expectedField: 'prewriteValue' | 'intendedValue',
  questions: readonly Question[],
): boolean {
  const groupQuestionIds = new Set(questions
    .filter((question) => question.kind === 'GROUP')
    .map((question) => question.questionId));
  return manifest.targets.every((target) => {
    if (expectedField === 'prewriteValue') {
      return worksheetCellRawValue(grid, target.rowNumber, target.answerColumnNumber) === target.prewriteValue;
    }
    if (target.intendedValue === null && groupQuestionIds.has(target.questionId)) {
      return worksheetCellRawValue(grid, target.rowNumber, target.answerColumnNumber) === target.prewriteValue;
    }
    return worksheetCellValue(grid, {
      questionId: target.questionId,
      rowNumber: target.rowNumber,
      answerColumnNumber: target.answerColumnNumber,
      value: '',
    }) === (target.intendedValue ?? '');
  });
}

function firstExportStillUnapplied(
  grid: WorksheetGrid,
  questions: readonly Question[],
  manifest: ExportManifest,
): boolean {
  try {
    const current = mapActivityAnswersToTargets(grid.values, questions, [], grid.rawValues);
    if (current.header.rowNumber !== manifest.header.rowNumber
      || current.header.questionColumnNumber !== manifest.header.questionColumnNumber
      || current.header.answerColumnNumber !== manifest.header.answerColumnNumber
      || current.targets.length !== manifest.targets.length) return false;
    return current.targets.every((target, index) => {
      const expected = manifest.targets[index];
      return expected !== undefined
        && target.questionId === expected.questionId
        && target.placeholderNumber === expected.placeholderNumber
        && target.rowNumber === expected.rowNumber
        && target.answerColumnNumber === expected.answerColumnNumber
        && target.prewriteValue === expected.prewriteValue;
    });
  } catch {
    return false;
  }
}

function firstExportCommitted(
  grid: WorksheetGrid,
  questions: readonly Question[],
  worksheet: WorksheetReference,
  manifest: ExportManifest,
  metadata: readonly DeveloperMetadataRecord[],
): boolean {
  if (sheetScopedExportAnchors(metadata, worksheet).length !== manifest.anchors.length) return false;
  try {
    validateConfirmedExportManifest(grid.values, questions, worksheet, manifest, metadata);
  } catch {
    return false;
  }
  return manifestTargetsMatch(grid, manifest, 'intendedValue', questions);
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
    return new GuidedNotesServiceError('SHEET_WRITE_UNCONFIRMED', '寫回結果未確認；批次可能已套用或仍會完成。請先檢查試算表，再決定是否重試。');
  }
  if (error instanceof GoogleSheetsIntegrationError) {
    const messages: Partial<Record<GuidedNotesServiceErrorCode, string>> = {
      SHEETS_NOT_CONFIGURED: 'Google Sheets 尚未完成本機設定，請檢查環境變數。',
      SHEET_ACCESS_DENIED: '無法寫入此試算表，請確認服務帳戶具有編輯權限。',
      SHEET_NOT_FOUND: '找不到原本匯入的試算表或工作表分頁，請檢查網址與分頁名稱。',
      SHEET_READ_FAILED: '目前無法讀取試算表，請檢查網路或存取權限後再試。',
      SHEET_WRITE_FAILED: '試算表拒絕寫入，資料未變更；請檢查編輯權限或受保護儲存格。',
      SHEET_WRITE_UNCONFIRMED: '寫回結果未確認；批次可能已套用或仍會完成。請先檢查試算表，再決定是否重試。',
    };
    return new GuidedNotesServiceError(error.code, messages[error.code] ?? '目前無法完成試算表操作，請稍後再試。');
  }
  return new GuidedNotesServiceError('SHEET_WRITE_FAILED', '目前無法寫回試算表，請檢查權限或網路後再試。');
}
