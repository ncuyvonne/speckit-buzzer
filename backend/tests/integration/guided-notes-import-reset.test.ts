import { describe, expect, it } from 'vitest';
import { ActivityState } from '../../src/domain/activity-state.js';
import { GuidedNotesService } from '../../src/guided-notes/service.js';
import type { WinningResultsSnapshot } from '../../src/guided-notes/types.js';
import { FakeGoogleSheetsAdapter } from '../support/fake-google-sheets.js';

const cells = (answer: string, questionId: string) => ({ A2: '作答', B2: '題號', A3: answer, B3: questionId });

describe('worksheet import activity cleanup', () => {
  it('clears old activity results only after a successful worksheet commit', async () => {
    const sheets = new FakeGoogleSheetsAdapter([
      { worksheet: { spreadsheetId: 'old', sheetId: 1, worksheetTitle: 'Sheet' }, rowCount: 4, columnCount: 2, cells: cells('old', 'Q1') },
      { worksheet: { spreadsheetId: 'new', sheetId: 2, worksheetTitle: 'Sheet' }, rowCount: 4, columnCount: 2, cells: cells('new', 'Q2') },
    ]);
    const activity = new ActivityState();
    activity.replaceGuidedNotesImport({ spreadsheetId: 'old', sheetId: 1, worksheetTitle: 'Sheet' }, [
      { questionId: 'Q1', displayOrder: 1, sourceRowAtImport: 3 },
    ]);
    activity.setTimeLimitSeconds(30);
    activity.setFairRankingSettings({ enabled: true, delaySeconds: 5 });
    let oldResultsPresent = true;
    const winningResultsProvider = { async getSnapshot(): Promise<WinningResultsSnapshot> {
      return { worksheet: activity.worksheet!, questions: activity.questions, winners: [] };
    } };
    const service = new GuidedNotesService({ activity, sheets, winningResultsProvider,
      onImportCommitted: () => { oldResultsPresent = false; } });

    await expect(service.importWorksheet({
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/missing/edit', worksheetTitle: 'Sheet',
    })).rejects.toMatchObject({ code: 'SHEET_NOT_FOUND' });
    expect(activity.questions.map((question) => question.questionId)).toEqual(['Q1']);
    expect(activity.timeLimitSeconds).toBe(30);
    expect(activity.fairRankingSettings).toEqual({ enabled: true, delaySeconds: 5 });
    expect(oldResultsPresent).toBe(true);

    await service.importWorksheet({
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new/edit', worksheetTitle: 'Sheet',
    });
    expect(activity.questions.map((question) => question.questionId)).toEqual(['Q2']);
    expect(activity.timeLimitSeconds).toBe(0);
    expect(activity.fairRankingSettings).toEqual({ enabled: true, delaySeconds: 5 });
    expect(oldResultsPresent).toBe(false);
  });
});
