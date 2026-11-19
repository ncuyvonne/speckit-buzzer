import { describe, expect, it } from 'vitest';
import { ActivityState } from '../../../src/domain/activity-state.js';
import { GuidedNotesService } from '../../../src/guided-notes/service.js';
import { FakeGoogleSheetsAdapter } from '../../support/fake-google-sheets.js';
import { FakeWinningResultsProvider } from '../../support/fake-winning-results.js';

describe('GuidedNotesService operation coordinator', () => {
  it('retains PREPARED and CONFIRMED anchor manifests and clears them when a new import replaces the activity', () => {
    const activity = new ActivityState();
    const worksheet = { spreadsheetId: 'sheet', sheetId: 7, worksheetTitle: 'Sheet' };
    const questions = [{ questionId: '1', displayOrder: 1, sourceRowAtImport: 2 }];
    expect(activity.replaceGuidedNotesImport(worksheet, questions)).toBe(true);
    const manifest = {
      worksheet,
      header: { rowNumber: 1, questionColumnNumber: 1, answerColumnNumber: 2 },
      targets: [{ questionId: '1', placeholderNumber: 1, rowNumber: 2, answerColumnNumber: 2, prewriteValue: 'old', intendedValue: 'new' }],
      anchors: [{ metadataId: 1, metadataKey: 'sb004' as const, attemptToken: 'token', dimension: 'ROW' as const, sheetId: 7, coordinate: 1 }],
    };

    activity.setExportAnchorState({ status: 'PREPARED', manifest });
    expect(activity.exportAnchorState).toMatchObject({ status: 'PREPARED', manifest });
    activity.setExportAnchorState({ status: 'CONFIRMED', manifest });
    expect(activity.exportAnchorState).toMatchObject({ status: 'CONFIRMED', manifest });
    expect(activity.replaceGuidedNotesImport(worksheet, questions)).toBe(true);
    expect(activity.exportAnchorState).toEqual({ status: 'NONE' });
  });

  it('rejects an export manifest tied to another worksheet', () => {
    const activity = new ActivityState();
    const worksheet = { spreadsheetId: 'sheet', sheetId: 7, worksheetTitle: 'Sheet' };
    expect(activity.replaceGuidedNotesImport(worksheet, [{ questionId: '1', displayOrder: 1, sourceRowAtImport: 2 }])).toBe(true);
    expect(() => activity.setExportAnchorState({
      status: 'PREPARED',
      manifest: {
        worksheet: { spreadsheetId: 'other', sheetId: 8, worksheetTitle: 'Other' },
        header: { rowNumber: 1, questionColumnNumber: 1, answerColumnNumber: 2 },
        targets: [],
        anchors: [],
      },
    })).toThrow(TypeError);
  });

  it('rejects a concurrent external operation and releases the lock when work finishes', async () => {
    const service = new GuidedNotesService({
      activity: { stage: 'PREPARING' },
      sheets: new FakeGoogleSheetsAdapter(),
      winningResultsProvider: new FakeWinningResultsProvider(),
    });
    let finish!: (value: string) => void;
    const firstOperation = service.runExclusive('IMPORT', () => new Promise<string>((resolve) => {
      finish = resolve;
    }));

    expect(service.activeOperation).toBe('IMPORT');
    await expect(service.runExclusive('EXPORT', async () => 'should not run'))
      .rejects.toMatchObject({ code: 'GUIDED_NOTES_BUSY' });

    finish('import complete');
    await expect(firstOperation).resolves.toBe('import complete');
    expect(service.activeOperation).toBeNull();
    await expect(service.runExclusive('EXPORT', async () => 'export complete'))
      .resolves.toBe('export complete');
  });
});
