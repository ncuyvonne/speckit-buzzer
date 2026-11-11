import { describe, expect, it, vi } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import { ActivityState } from '../../src/domain/activity-state.js';
import { GuidedNotesService, GuidedNotesServiceError } from '../../src/guided-notes/service.js';
import type { Question, WinningAnswer, WorksheetReference } from '../../src/guided-notes/types.js';
import { createGoogleSheetsAdapter } from '../../src/integrations/google-sheets/adapter.js';
import { GoogleSheetsIntegrationError } from '../../src/integrations/google-sheets/errors.js';
import { FakeGoogleSheetsAdapter, FakeSheetsError, type FakeWorksheetFixture } from '../support/fake-google-sheets.js';
import { FakeWinningResultsProvider } from '../support/fake-winning-results.js';

const worksheet: WorksheetReference = { spreadsheetId: 'errors-sheet', sheetId: 1, worksheetTitle: '工作表1' };
const questions: readonly Question[] = [
  { questionId: '1', displayOrder: 1, sourceRowAtImport: 3 },
  { questionId: '2', displayOrder: 2, sourceRowAtImport: 4 },
];
const answers: readonly WinningAnswer[] = [
  { questionId: '1', groupId: 'A', answerText: '答案一' },
];

function validFixture(): FakeWorksheetFixture {
  return {
    worksheet,
    rowCount: 6,
    columnCount: 3,
    cells: { A2: '題號', B2: '作答', A3: '1', B3: '舊答案一', A4: '2', B4: '舊答案二' },
  };
}

function createService(
  activity: ActivityState,
  sheets: FakeGoogleSheetsAdapter,
  options: { now?: () => number; sleep?: (milliseconds: number) => Promise<void> } = {},
) {
  return new GuidedNotesService({
    activity,
    sheets,
    winningResultsProvider: new FakeWinningResultsProvider({ status: 'READY', answers }),
    ...options,
  });
}

class PendingBatchWriteSheets extends FakeGoogleSheetsAdapter {
  #completePendingWrite: (() => void) | null = null;
  #pendingWrite: Promise<void> | null = null;

  override batchWriteValues(...args: Parameters<FakeGoogleSheetsAdapter['batchWriteValues']>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.#completePendingWrite = () => {
        this.#pendingWrite = super.batchWriteValues(...args);
        void this.#pendingWrite.then(resolve, reject);
      };
    });
  }

  async completePendingWrite(): Promise<void> {
    if (this.#completePendingWrite === null) throw new Error('No write is pending.');
    this.#completePendingWrite();
    await this.#pendingWrite;
  }
}

describe('Guided Notes integration error behavior', () => {
  it('maps missing credentials, missing sheets, and invalid layouts to stable actionable errors', async () => {
    const noCredentials = new GuidedNotesService({
      activity: new ActivityState(),
      sheets: createGoogleSheetsAdapter(null),
      winningResultsProvider: new FakeWinningResultsProvider(),
    });
    await expect(noCredentials.importWorksheet({
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-id/edit', worksheetTitle: '工作表1',
    })).rejects.toMatchObject({ code: 'SHEETS_NOT_CONFIGURED' });

    const missingSheet = createService(new ActivityState(), new FakeGoogleSheetsAdapter());
    await expect(missingSheet.importWorksheet({
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/missing-id/edit', worksheetTitle: '工作表1',
    })).rejects.toMatchObject({ code: 'SHEET_NOT_FOUND' });

    const invalidLayout = createService(new ActivityState(), new FakeGoogleSheetsAdapter([{
      worksheet, rowCount: 3, columnCount: 2, cells: { A1: '題號', A2: '1' },
    }]));
    await expect(invalidLayout.importWorksheet({
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/errors-sheet/edit', worksheetTitle: '工作表1',
    })).rejects.toMatchObject({ code: 'SHEET_LAYOUT_INVALID', message: expect.stringContaining('標題') });
  });

  it.each([
    [403, 'SHEET_ACCESS_DENIED'],
    [404, 'SHEET_NOT_FOUND'],
    [429, 'SHEET_READ_FAILED'],
    [503, 'SHEET_READ_FAILED'],
  ] as const)('normalizes Google read status %s without exposing its body', async (status, expectedCode) => {
    const get = vi.fn().mockRejectedValue({
      response: { status, data: { error: { message: 'raw private response body with secret-token' } } },
      message: 'secret-token',
    });
    const client = { spreadsheets: { get } } as unknown as sheets_v4.Sheets;
    const adapter = createGoogleSheetsAdapter(null, client);

    await expect(adapter.resolveWorksheet('private-sheet-id', '工作表1')).rejects.toMatchObject({
      code: expectedCode,
    });
    try {
      await adapter.resolveWorksheet('private-sheet-id', '工作表1');
    } catch (error) {
      expect(String(error)).not.toContain('secret-token');
      expect(String(error)).not.toContain('private-sheet-id');
    }
    expect(get).toHaveBeenCalledTimes(2);
  });

  it.each([
    [429, 'DEFINITELY_NOT_APPLIED'],
    [503, 'AMBIGUOUS'],
  ] as const)('classifies write status %s as %s', async (status, writeOutcome) => {
    const batchUpdate = vi.fn().mockRejectedValue({ response: { status }, message: 'credential-token' });
    const client = { spreadsheets: { values: { batchUpdate } } } as unknown as sheets_v4.Sheets;
    const adapter = createGoogleSheetsAdapter(null, client);

    await expect(adapter.batchWriteValues(
      { worksheet, rowCount: 6, columnCount: 3 },
      [{ questionId: '1', rowNumber: 3, answerColumnNumber: 2, value: '答案一' }],
    )).rejects.toMatchObject({ writeOutcome });
  });

  it('retries idempotent reads at 250 ms and 500 ms, up to two retries per operation', async () => {
    const delays: number[] = [];
    let attempts = 0;
    class TransientReadSheets extends FakeGoogleSheetsAdapter {
      override async resolveWorksheet(spreadsheetId: string, worksheetTitle: string) {
        attempts += 1;
        if (attempts <= 2) throw new FakeSheetsError('READ_FAILED');
        return super.resolveWorksheet(spreadsheetId, worksheetTitle);
      }
    }
    const activity = new ActivityState();
    const service = createService(activity, new TransientReadSheets([validFixture()]), {
      now: () => 0,
      sleep: async (milliseconds) => { delays.push(milliseconds); },
    });

    await expect(service.importWorksheet({
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/errors-sheet/edit', worksheetTitle: '工作表1',
    })).resolves.toMatchObject({ questionIds: ['1', '2'], questionCount: 2 });
    expect(attempts).toBe(3);
    expect(delays).toEqual([250, 500]);
    expect(activity.questionCount).toBe(2);
  });

  it('retries only definitively unapplied batches and applies the third attempt once', async () => {
    const delays: number[] = [];
    let attempts = 0;
    class RejectedBatchSheets extends FakeGoogleSheetsAdapter {
      override async batchWriteValues(...args: Parameters<FakeGoogleSheetsAdapter['batchWriteValues']>) {
        attempts += 1;
        if (attempts <= 2) {
          throw new GoogleSheetsIntegrationError('SHEET_WRITE_FAILED', { writeOutcome: 'DEFINITELY_NOT_APPLIED' });
        }
        return super.batchWriteValues(...args);
      }
    }
    const sheets = new RejectedBatchSheets([validFixture()]);
    const activity = new ActivityState();
    activity.replaceGuidedNotesImport(worksheet, questions);
    activity.advance('PREPARING', 'BUZZING');
    activity.advance('BUZZING', 'ENDED');
    const service = createService(activity, sheets, {
      now: () => 0,
      sleep: async (milliseconds) => { delays.push(milliseconds); },
    });

    await expect(service.exportAnswers()).resolves.toEqual({ writtenCellCount: 1, clearedCellCount: 1 });
    expect(attempts).toBe(3);
    expect(delays).toEqual([250, 500]);
    expect(sheets.getCellState(worksheet, 'B3').value).toBe('答案一');
    expect(sheets.getCellState(worksheet, 'B4').value).toBe('');
  });

  it('rejects a read that completes beyond the ten-second operation deadline without committing import state', async () => {
    let time = 0;
    class SlowMetadataSheets extends FakeGoogleSheetsAdapter {
      override async resolveWorksheet(spreadsheetId: string, worksheetTitle: string) {
        time = 10_001;
        return super.resolveWorksheet(spreadsheetId, worksheetTitle);
      }
    }
    const activity = new ActivityState();
    const service = createService(activity, new SlowMetadataSheets([validFixture()]), { now: () => time });

    await expect(service.importWorksheet({
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/errors-sheet/edit', worksheetTitle: '工作表1',
    })).rejects.toMatchObject({ code: 'SHEET_READ_FAILED' });
    expect(activity.questions).toEqual([]);
    expect(activity.worksheet).toBeNull();
  });

  it('reports a pending write as unconfirmed at deadline and holds the operation lock until it settles', async () => {
    vi.useFakeTimers();
    try {
      const sheets = new PendingBatchWriteSheets([validFixture()]);
      const activity = new ActivityState();
      activity.replaceGuidedNotesImport(worksheet, questions);
      activity.advance('PREPARING', 'BUZZING');
      activity.advance('BUZZING', 'ENDED');
      const service = createService(activity, sheets);

      const exportRequest = service.exportAnswers();
      const exportRejection = expect(exportRequest).rejects.toMatchObject({
        code: 'SHEET_WRITE_UNCONFIRMED',
        message: expect.stringContaining('可能仍會完成'),
      });
      await vi.advanceTimersByTimeAsync(10_000);
      await exportRejection;
      expect(service.activeOperation).toBe('EXPORT');
      expect(sheets.writeBatches).toHaveLength(0);
      await expect(service.exportAnswers()).rejects.toMatchObject({ code: 'GUIDED_NOTES_BUSY' });

      await sheets.completePendingWrite();
      for (let index = 0; index < 8 && service.activeOperation !== null; index += 1) {
        await Promise.resolve();
      }
      expect(service.activeOperation).toBeNull();
      expect(sheets.writeBatches).toHaveLength(1);
      expect(sheets.getCellState(worksheet, 'B3').value).toBe('答案一');
      expect(sheets.getCellState(worksheet, 'B4').value).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('includes ambiguous-write read-back in the deadline and never retries that write', async () => {
    let time = 0;
    let writes = 0;
    class SlowReadBackSheets extends FakeGoogleSheetsAdapter {
      override async batchWriteValues(...args: Parameters<FakeGoogleSheetsAdapter['batchWriteValues']>) {
        writes += 1;
        this.nextWriteFailure = { kind: 'LOST_RESPONSE', commit: 'FULL', readBack: 'AVAILABLE' };
        const result = await super.batchWriteValues(...args);
        return result;
      }

      override async readWorksheet(...args: Parameters<FakeGoogleSheetsAdapter['readWorksheet']>) {
        const grid = await super.readWorksheet(...args);
        if (writes > 0) time = 10_001;
        return grid;
      }
    }
    const activity = new ActivityState();
    activity.replaceGuidedNotesImport(worksheet, questions);
    activity.advance('PREPARING', 'BUZZING');
    activity.advance('BUZZING', 'ENDED');
    const service = createService(activity, new SlowReadBackSheets([validFixture()]), { now: () => time });

    await expect(service.exportAnswers()).rejects.toMatchObject({ code: 'SHEET_WRITE_UNCONFIRMED' });
    expect(writes).toBe(1);
  });

  it('does not expose service credentials, raw provider errors, or submitted URLs in user-facing messages', async () => {
    const secret = 'credential-token-should-never-appear';
    class SecretErrorSheets extends FakeGoogleSheetsAdapter {
      override async resolveWorksheet() {
        throw Object.assign(new Error(`${secret} raw provider response`), { response: { status: 403 } });
      }
    }
    const rawUrl = `https://docs.google.com/spreadsheets/d/private-sheet/edit?token=${secret}`;
    const service = createService(new ActivityState(), new SecretErrorSheets());

    try {
      await service.importWorksheet({ spreadsheetUrl: rawUrl, worksheetTitle: '工作表1' });
      throw new Error('Expected import to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(GuidedNotesServiceError);
      expect(error).toMatchObject({ code: 'SHEET_READ_FAILED' });
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain(rawUrl);
      expect(String(error)).not.toContain('private-sheet');
    }
  });
});
