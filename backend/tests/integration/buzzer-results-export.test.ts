import { afterEach, describe, expect, it } from 'vitest';
import { createRealtimeServer } from '../../src/server.js';
import { BuzzerWinningResultsProvider } from '../../src/guided-notes/winning-results-provider.js';
import { FakeGoogleSheetsAdapter, type FakeWorksheetFixture } from '../support/fake-google-sheets.js';

const worksheet = { spreadsheetId: 'provider-sheet', sheetId: 7, worksheetTitle: '工作表1' };
const fixture: FakeWorksheetFixture = {
  worksheet,
  rowCount: 4,
  columnCount: 3,
  cells: { A1: '題號', B1: '作答', A2: '1', B2: '舊答案', A3: '2', B3: '舊答案二' },
};

describe('Feature 003 winning results provider integration', () => {
  const apps: ReturnType<typeof createRealtimeServer>[] = [];

  async function setup() {
    const sheets = new FakeGoogleSheetsAdapter([fixture]);
    const app = createRealtimeServer({
      config: { groups: ['A', 'B'], teacherPassword: 'test-password', teacherLoginEnabled: true },
      port: 0,
      guidedNotes: { sheetsAdapter: sheets },
    });
    apps.push(app);
    app.activity.replaceGuidedNotesImport(worksheet, [1, 2].map((index) => ({
      questionId: String(index), displayOrder: index, sourceRowAtImport: index + 1,
    })));
    app.activity.advance('PREPARING', 'BUZZING');
    return { app, sheets };
  }

  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it('exports the server winner through the fake Sheets adapter without credentials', async () => {
    const { app, sheets } = await setup();
    app.buzzerResults.submitAnswer('B', '1', 'server winner');
    app.buzzerResults.submitAnswer('A', '1', 'later answer');
    app.activity.advance('BUZZING', 'ENDED');

    await expect(app.guidedNotes.exportAnswers()).resolves.toMatchObject({ writtenCellCount: 1, clearedCellCount: 1 });
    expect(sheets.writeBatches[0]?.writes).toEqual([
      { questionId: '1', rowNumber: 2, answerColumnNumber: 2, value: 'server winner' },
      { questionId: '2', rowNumber: 3, answerColumnNumber: 2, value: '' },
    ]);
  });

  it('returns a READY empty answer snapshot when nobody submits', async () => {
    const { app, sheets } = await setup();
    app.activity.advance('BUZZING', 'ENDED');

    await expect(app.guidedNotes.exportAnswers()).resolves.toMatchObject({ writtenCellCount: 0, clearedCellCount: 2 });
    expect(sheets.writeBatches[0]?.writes.every((write) => write.value === '')).toBe(true);
  });

  it('orders provider winners by server receipt order rather than worksheet order', async () => {
    const { app } = await setup();
    app.buzzerResults.submitAnswer('A', '2', 'second worksheet question');
    app.buzzerResults.submitAnswer('B', '1', 'first worksheet question');
    app.activity.advance('BUZZING', 'ENDED');
    const provider = new BuzzerWinningResultsProvider(app.activity, app.buzzerResults);

    await expect(provider.getSnapshot()).resolves.toMatchObject({
      status: 'READY',
      answers: [
        { questionId: '2', answerText: 'second worksheet question' },
        { questionId: '1', answerText: 'first worksheet question' },
      ],
    });
  });

  it('exports the server-ranked winner as one full group vector to its original marker cells', async () => {
    const groupFixture: FakeWorksheetFixture = {
      worksheet,
      rowCount: 5,
      columnCount: 3,
      cells: { A1: '題號', B1: '作答', A2: '1', B2: 'old', A3: 'G', B3: '（1）', A4: '', B4: '（2）' },
    };
    const sheets = new FakeGoogleSheetsAdapter([groupFixture]);
    const app = createRealtimeServer({
      config: { groups: ['A', 'B'], teacherPassword: 'test-password', teacherLoginEnabled: true },
      port: 0,
      guidedNotes: { sheetsAdapter: sheets },
    });
    apps.push(app);
    app.activity.replaceGuidedNotesImport(worksheet, [
      { questionId: '1', kind: 'SINGLE', displayOrder: 1, sourceRowAtImport: 2, answerSlots: [{ placeholderNumber: 1, sourceRowAtImport: 2 }] },
      { questionId: 'G', kind: 'GROUP', displayOrder: 2, sourceRowAtImport: 3, answerSlots: [
        { placeholderNumber: 1, sourceRowAtImport: 3 },
        { placeholderNumber: 2, sourceRowAtImport: 4 },
      ] },
    ]);
    app.activity.advance('PREPARING', 'BUZZING');
    app.buzzerResults.submitAnswer('B', 'G', [
      { placeholderNumber: 1, answerText: 'server winner one' },
      { placeholderNumber: 2, answerText: 'server winner two' },
    ]);
    app.buzzerResults.submitAnswer('A', 'G', [
      { placeholderNumber: 1, answerText: 'later one' },
      { placeholderNumber: 2, answerText: 'later two' },
    ]);
    app.activity.advance('BUZZING', 'ENDED');

    await expect(app.guidedNotes.exportAnswers()).resolves.toMatchObject({ writtenCellCount: 2, clearedCellCount: 1 });
    expect(sheets.exportBatches[0]?.writes).toEqual([
      { questionId: '1', rowNumber: 2, answerColumnNumber: 2, value: '' },
      { questionId: 'G', rowNumber: 3, answerColumnNumber: 2, value: 'server winner one' },
      { questionId: 'G', rowNumber: 4, answerColumnNumber: 2, value: 'server winner two' },
    ]);
    expect(app.buzzerResults.getWinner('G')).toMatchObject({ groupId: 'B', kind: 'GROUP', answers: [
      { placeholderNumber: 1, answerText: 'server winner one' },
      { placeholderNumber: 2, answerText: 'server winner two' },
    ] });
  });

  it('reports UNAVAILABLE before questions or ended results exist', async () => {
    const app = createRealtimeServer({
      config: { groups: ['A', 'B'], teacherPassword: 'test-password', teacherLoginEnabled: true },
      port: 0,
    });
    apps.push(app);
    const provider = new BuzzerWinningResultsProvider(app.activity, app.buzzerResults);
    await expect(provider.getSnapshot()).resolves.toEqual({ status: 'UNAVAILABLE', reason: 'NOT_READY' });
  });
});
