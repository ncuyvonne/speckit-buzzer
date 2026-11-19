import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { sheets_v4 } from 'googleapis';
import { loadConfig } from '../../src/config.js';
import { createRealtimeServer } from '../../src/server.js';
import { createGoogleSheetsAdapter } from '../../src/integrations/google-sheets/adapter.js';
import type { Question, WinningAnswer, WorksheetReference } from '../../src/guided-notes/types.js';
import { FakeGoogleSheetsAdapter, type FakeWorksheetFixture } from '../support/fake-google-sheets.js';
import { FakeWinningResultsProvider } from '../support/fake-winning-results.js';

const ORIGIN = 'http://127.0.0.1:5173';
type JsonMessage = { type: string; requestId?: string; payload: Record<string, unknown> };

function createInbox(socket: WebSocket) {
  const messages: JsonMessage[] = [];
  const waiters: Array<{ predicate: (message: JsonMessage) => boolean; resolve: (message: JsonMessage) => void }> = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as JsonMessage;
    const index = waiters.findIndex(({ predicate }) => predicate(message));
    if (index >= 0) waiters.splice(index, 1)[0]?.resolve(message);
    else messages.push(message);
  });

  return {
    waitFor(predicate: (message: JsonMessage) => boolean, timeoutMs = 2_000): Promise<JsonMessage> {
      const index = messages.findIndex(predicate);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]!);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve };
        const timeout = setTimeout(() => {
          const waiterIndex = waiters.indexOf(waiter);
          if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
          reject(new Error(`Timed out waiting for message; queued: ${JSON.stringify(messages)}`));
        }, timeoutMs);
        waiters.push({
          predicate,
          resolve: (message) => {
            clearTimeout(timeout);
            resolve(message);
          },
        });
      });
    },
  };
}

const worksheet: WorksheetReference = {
  spreadsheetId: 'export-sheet',
  sheetId: 7,
  worksheetTitle: '工作表1',
};

const activityQuestions: readonly Question[] = [
  { questionId: '1', displayOrder: 1, sourceRowAtImport: 3 },
  { questionId: '2', displayOrder: 2, sourceRowAtImport: 5 },
  { questionId: '4', displayOrder: 3, sourceRowAtImport: 7 },
];

const readyAnswers: readonly WinningAnswer[] = [
  { questionId: '1', groupId: 'A', answerText: '本次答案一' },
  { questionId: '4', groupId: 'B', answerText: '本次答案四' },
];

function currentWorksheetFixture(cells: FakeWorksheetFixture['cells'] = {
  A1: '課程名稱',
  A2: '作答', B2: '題號', C2: '題目敘述',
  A3: '舊答案四', B3: '4', C3: '第四題說明',
  A5: '舊答案一', B5: '1', C5: '第一題說明',
  A7: '舊答案二', B7: '2', C7: '第二題說明',
  A8: '額外答案', B8: '99', C8: '非活動題目',
  D3: { value: '2', displayValue: '2', formula: '=1+1', note: '保留公式', userEnteredFormat: { textFormat: { bold: true } } },
}) {
  return { worksheet, rowCount: 10, columnCount: 5, cells };
}

describe('Guided Notes answer export integration', () => {
  const apps: ReturnType<typeof createRealtimeServer>[] = [];
  const sockets: WebSocket[] = [];

  async function start(
    sheets: FakeGoogleSheetsAdapter,
    provider = new FakeWinningResultsProvider({ status: 'READY', answers: readyAnswers }),
    importWorksheet = true,
    stage: 'PREPARING' | 'BUZZING' | 'ENDED' = 'ENDED',
    questions: readonly Question[] = activityQuestions,
  ) {
    const app = createRealtimeServer({
      config: loadConfig({ GROUP_IDS: '1,2', TEACHER_PASSWORD: 'test-password' }),
      port: 0,
      guidedNotes: { sheetsAdapter: sheets, winningResultsProvider: provider },
    });
    apps.push(app);
    if (importWorksheet) app.activity.replaceGuidedNotesImport(worksheet, questions);
    if (stage === 'BUZZING' || stage === 'ENDED') app.activity.advance('PREPARING', 'BUZZING');
    if (stage === 'ENDED') app.activity.advance('BUZZING', 'ENDED');
    return { app, port: await app.listen(0), provider };
  }

  async function connect(port: number) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: ORIGIN } });
    sockets.push(socket);
    const inbox = createInbox(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    await inbox.waitFor((message) => message.type === 'activity.snapshot');
    return { socket, inbox };
  }

  async function login(connection: Awaited<ReturnType<typeof connect>>) {
    const authenticated = connection.inbox.waitFor((message) => message.type === 'teacher.authenticated');
    connection.socket.send(JSON.stringify({
      type: 'teacher.authenticate', requestId: 'teacher-login', payload: { password: 'test-password' },
    }));
    await authenticated;
    await connection.inbox.waitFor((message) => message.type === 'guidedNotes.snapshot');
  }

  function sendExport(socket: WebSocket, requestId: string) {
    socket.send(JSON.stringify({ type: 'guidedNotes.export', requestId, payload: {} }));
  }

  async function exportAndReceive(connection: Awaited<ReturnType<typeof connect>>, requestId: string) {
    const response = connection.inbox.waitFor((message) => message.requestId === requestId);
    sendExport(connection.socket, requestId);
    return response;
  }

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('re-reads the worksheet, writes one batch by current question ID, clears no-winner cells, and preserves other cells', async () => {
    const sheets = new FakeGoogleSheetsAdapter([currentWorksheetFixture()]);
    const { app, port, provider } = await start(sheets);
    const teacher = await connect(port);
    await login(teacher);

    const response = await exportAndReceive(teacher, 'export-success');
    expect(response).toMatchObject({
      type: 'guidedNotes.exported',
      requestId: 'export-success',
      payload: { writtenCellCount: 2, clearedCellCount: 1 },
    });
    expect(app.activity.stage).toBe('ENDED');
    expect(provider.callCount).toBe(1);
    expect(sheets.resolveRequests).toEqual([{ spreadsheetId: 'export-sheet', worksheetTitle: '工作表1' }]);
    expect(sheets.requestedReadRanges).toHaveLength(1);
    expect(sheets.writeBatches).toHaveLength(1);
    expect(sheets.requestedWriteRanges).toEqual([['A5', 'A7', 'A3']]);
    expect(sheets.writeBatches[0]?.writes).toEqual([
      { questionId: '1', rowNumber: 5, answerColumnNumber: 1, value: '本次答案一' },
      { questionId: '2', rowNumber: 7, answerColumnNumber: 1, value: '' },
      { questionId: '4', rowNumber: 3, answerColumnNumber: 1, value: '本次答案四' },
    ]);
    expect(sheets.getCellState(worksheet, 'A5')).toMatchObject({ value: '本次答案一' });
    expect(sheets.getCellState(worksheet, 'A7').value).toBe('');
    expect(sheets.getCellState(worksheet, 'A3')).toMatchObject({ value: '本次答案四' });
    expect(sheets.getCellState(worksheet, 'B8').value).toBe('99');
    expect(sheets.getCellState(worksheet, 'C3').value).toBe('第四題說明');
    expect(sheets.getCellState(worksheet, 'D3')).toEqual({
      value: '2', displayValue: '2', formula: '=1+1', note: '保留公式',
      userEnteredFormat: { textFormat: { bold: true } },
    });
  });

  it('writes mixed single/group vectors and no-winner clears to each marker in one anchored batch', async () => {
    const groupFixture: FakeWorksheetFixture = {
      worksheet,
      rowCount: 10,
      columnCount: 4,
      cells: {
        A2: '作答', B2: '題號', C2: '題目敘述',
        A3: '舊單題', B3: '1', C3: 'single',
        A4: '（1）', B4: '2',
        A5: '（2）', B5: '',
        A7: '（1）', B7: '4',
        A8: '（2）', B8: '',
        A9: '（3）', B9: '',
      },
    };
    const groupQuestions: readonly Question[] = [
      { questionId: '1', kind: 'SINGLE', displayOrder: 1, sourceRowAtImport: 3, answerSlots: [{ placeholderNumber: 1, sourceRowAtImport: 3 }] },
      { questionId: '2', kind: 'GROUP', displayOrder: 2, sourceRowAtImport: 4, answerSlots: [
        { placeholderNumber: 1, sourceRowAtImport: 4 },
        { placeholderNumber: 2, sourceRowAtImport: 5 },
      ] },
      { questionId: '4', kind: 'GROUP', displayOrder: 3, sourceRowAtImport: 7, answerSlots: [
        { placeholderNumber: 1, sourceRowAtImport: 7 },
        { placeholderNumber: 2, sourceRowAtImport: 8 },
        { placeholderNumber: 3, sourceRowAtImport: 9 },
      ] },
    ];
    const results = new FakeWinningResultsProvider({ status: 'READY', answers: [
      { questionId: '1', groupId: 'A', answerText: '單題答案' },
      { questionId: '2', groupId: 'B', answers: [
        { placeholderNumber: 1, answerText: '=題組答案一' },
        { placeholderNumber: 2, answerText: '題組答案二' },
      ] },
    ] });
    const sheets = new FakeGoogleSheetsAdapter([groupFixture]);
    const { app } = await start(sheets, results, true, 'ENDED', groupQuestions);

    await expect(app.guidedNotes.exportAnswers()).resolves.toEqual({ writtenCellCount: 3, clearedCellCount: 3 });
    expect(sheets.exportBatches).toHaveLength(1);
    expect(sheets.exportBatches[0]?.writes).toEqual([
      { questionId: '1', rowNumber: 3, answerColumnNumber: 1, value: '單題答案' },
      { questionId: '2', rowNumber: 4, answerColumnNumber: 1, value: '=題組答案一' },
      { questionId: '2', rowNumber: 5, answerColumnNumber: 1, value: '題組答案二' },
      { questionId: '4', rowNumber: 7, answerColumnNumber: 1, value: '' },
      { questionId: '4', rowNumber: 8, answerColumnNumber: 1, value: '' },
      { questionId: '4', rowNumber: 9, answerColumnNumber: 1, value: '' },
    ]);
    expect(sheets.exportBatches[0]?.anchors).toHaveLength(9);
    expect(sheets.getCellState(worksheet, 'A4').value).toBe('=題組答案一');
    expect(sheets.getCellState(worksheet, 'A5').value).toBe('題組答案二');
    expect(sheets.getCellState(worksheet, 'A9').value).toBe('');
    expect(sheets.getCellState(worksheet, 'C3').value).toBe('single');
    expect(app.activity.exportAnchorState.status).toBe('CONFIRMED');

    const firstManifest = app.activity.exportAnchorState.status === 'CONFIRMED'
      ? app.activity.exportAnchorState.manifest
      : null;
    expect(firstManifest?.targets.map(({ questionId, placeholderNumber, rowNumber }) => ({ questionId, placeholderNumber, rowNumber })))
      .toEqual([
        { questionId: '1', placeholderNumber: 1, rowNumber: 3 },
        { questionId: '2', placeholderNumber: 1, rowNumber: 4 },
        { questionId: '2', placeholderNumber: 2, rowNumber: 5 },
        { questionId: '4', placeholderNumber: 1, rowNumber: 7 },
        { questionId: '4', placeholderNumber: 2, rowNumber: 8 },
        { questionId: '4', placeholderNumber: 3, rowNumber: 9 },
      ]);

    sheets.setCellState(worksheet, 'A4', '老師只修改答案格');
    results.snapshot = { status: 'READY', answers: [
      { questionId: '1', groupId: 'A', answerText: '單題更新' },
      { questionId: '2', groupId: 'B', answers: [
        { placeholderNumber: 1, answerText: '更新一' },
        { placeholderNumber: 2, answerText: '更新二' },
      ] },
    ] };
    await expect(app.guidedNotes.exportAnswers()).resolves.toEqual({ writtenCellCount: 3, clearedCellCount: 3 });
    expect(sheets.exportBatches).toHaveLength(2);
    expect(sheets.exportBatches[1]?.anchors).toEqual([]);
    expect(sheets.exportBatches[1]?.writes.map((write) => write.rowNumber)).toEqual([3, 4, 5, 7, 8, 9]);
    expect(sheets.getCellState(worksheet, 'A4').value).toBe('更新一');
    expect(app.activity.exportAnchorState.status).toBe('CONFIRMED');

    const confirmed = app.activity.exportAnchorState.status === 'CONFIRMED'
      ? app.activity.exportAnchorState.manifest
      : null;
    const rowAnchor = confirmed?.anchors.find((anchor) => anchor.dimension === 'ROW' && anchor.coordinate === 5);
    if (rowAnchor) sheets.removeDeveloperMetadata(worksheet, rowAnchor.metadataId);
    await expect(app.guidedNotes.exportAnswers()).rejects.toMatchObject({ code: 'QUESTION_TARGET_INVALID' });
    expect(sheets.exportBatches).toHaveLength(2);
  });

  it('exports correctly when headers are on row 5 and answer/question columns are E and C', async () => {
    const alternateFixture: FakeWorksheetFixture = {
      worksheet,
      rowCount: 12,
      columnCount: 6,
      cells: {
        A1: '課程名稱',
        A2: '欄位說明：題號與作答',
        C5: ' 題號 ', E5: ' 作答 ', F5: '題目敘述',
        C6: '1', E6: '舊答案一', F6: '第一題',
        C8: '2', E8: '舊答案二', F8: '第二題',
        C10: '4', E10: '舊答案四', F10: '第四題',
        D5: { value: '不應改動', displayValue: '不應改動', note: '標題旁資料' },
      },
    };
    const sheets = new FakeGoogleSheetsAdapter([alternateFixture]);
    const { port } = await start(sheets);
    const teacher = await connect(port);
    await login(teacher);

    expect(await exportAndReceive(teacher, 'alternate-layout')).toMatchObject({
      type: 'guidedNotes.exported',
      requestId: 'alternate-layout',
      payload: { writtenCellCount: 2, clearedCellCount: 1 },
    });
    expect(sheets.requestedWriteRanges).toEqual([['E6', 'E8', 'E10']]);
    expect(sheets.getCellState(worksheet, 'E6').value).toBe('本次答案一');
    expect(sheets.getCellState(worksheet, 'E8').value).toBe('');
    expect(sheets.getCellState(worksheet, 'E10').value).toBe('本次答案四');
    expect(sheets.getCellState(worksheet, 'C8').value).toBe('2');
    expect(sheets.getCellState(worksheet, 'F6').value).toBe('第一題');
    expect(sheets.getCellState(worksheet, 'D5')).toMatchObject({
      value: '不應改動', note: '標題旁資料',
    });
  });

  it('reconciles an uncertain confirmed re-export before sending another target-only batch', async () => {
    const sheets = new FakeGoogleSheetsAdapter([currentWorksheetFixture()]);
    const results = new FakeWinningResultsProvider({ status: 'READY', answers: readyAnswers });
    const { app } = await start(sheets, results);
    await app.guidedNotes.exportAnswers();
    expect(app.activity.exportAnchorState.status).toBe('CONFIRMED');

    sheets.setCellState(worksheet, 'A5', '老師的現有修改');
    results.snapshot = { status: 'READY', answers: [
      { questionId: '1', groupId: 'A', answerText: '更新答案一' },
      { questionId: '4', groupId: 'B', answerText: '更新答案四' },
    ] };
    sheets.nextWriteFailure = { kind: 'LOST_RESPONSE', commit: 'NONE', readBack: 'UNAVAILABLE' };
    await expect(app.guidedNotes.exportAnswers()).rejects.toMatchObject({ code: 'SHEET_WRITE_UNCONFIRMED' });
    expect(app.activity.exportAnchorState.status).toBe('CONFIRMED');
    expect(sheets.exportBatches).toHaveLength(2);
    expect(sheets.exportBatches[1]?.anchors).toEqual([]);

    await expect(app.guidedNotes.exportAnswers()).rejects.toMatchObject({ code: 'SHEET_WRITE_FAILED' });
    expect(sheets.exportBatches).toHaveLength(2);
    expect(app.activity.exportAnchorState.status).toBe('CONFIRMED');
    expect(sheets.getCellState(worksheet, 'A5').value).toBe('老師的現有修改');
  });

  it('returns WORKSHEET_NOT_IMPORTED before calling the results provider or Sheets adapter', async () => {
    const sheets = new FakeGoogleSheetsAdapter();
    const provider = new FakeWinningResultsProvider({ status: 'READY', answers: readyAnswers });
    const { port } = await start(sheets, provider, false);
    const teacher = await connect(port);
    await login(teacher);

    expect(await exportAndReceive(teacher, 'no-worksheet')).toMatchObject({
      type: 'error', requestId: 'no-worksheet', payload: { code: 'WORKSHEET_NOT_IMPORTED' },
    });
    expect(provider.callCount).toBe(0);
    expect(sheets.resolveRequests).toHaveLength(0);
    expect(sheets.requestedReadRanges).toHaveLength(0);
    expect(sheets.writeBatches).toHaveLength(0);
  });

  it('rejects export outside ENDED before calling the results provider or Sheets adapter', async () => {
    const sheets = new FakeGoogleSheetsAdapter([currentWorksheetFixture()]);
    const { port, provider } = await start(sheets, undefined, true, 'BUZZING');
    const teacher = await connect(port);
    await login(teacher);

    expect(await exportAndReceive(teacher, 'wrong-stage')).toMatchObject({
      type: 'error', requestId: 'wrong-stage', payload: { code: 'STAGE_CONFLICT' },
    });
    expect(provider.callCount).toBe(0);
    expect(sheets.resolveRequests).toHaveLength(0);
    expect(sheets.requestedReadRanges).toHaveLength(0);
    expect(sheets.writeBatches).toHaveLength(0);
  });

  it('does not write when Feature 003 results are unavailable', async () => {
    const sheets = new FakeGoogleSheetsAdapter([currentWorksheetFixture()]);
    const provider = new FakeWinningResultsProvider({ status: 'UNAVAILABLE', reason: 'NOT_READY' });
    const { port } = await start(sheets, provider);
    const teacher = await connect(port);
    await login(teacher);

    expect(await exportAndReceive(teacher, 'results-unavailable')).toMatchObject({
      type: 'error', requestId: 'results-unavailable', payload: { code: 'WINNING_RESULTS_UNAVAILABLE' },
    });
    expect(provider.callCount).toBe(1);
    expect(sheets.resolveRequests).toHaveLength(0);
    expect(sheets.requestedReadRanges).toHaveLength(0);
    expect(sheets.writeBatches).toHaveLength(0);
  });

  it('keeps all target cells unchanged after a definitive atomic batch rejection', async () => {
    const sheets = new FakeGoogleSheetsAdapter([currentWorksheetFixture()]);
    sheets.writeFailures.push(
      { kind: 'DEFINITE_REJECTION' },
      { kind: 'DEFINITE_REJECTION' },
      { kind: 'DEFINITE_REJECTION' },
    );
    const { port } = await start(sheets);
    const teacher = await connect(port);
    await login(teacher);

    expect(await exportAndReceive(teacher, 'rejected-batch')).toMatchObject({
      type: 'error', requestId: 'rejected-batch', payload: { code: 'SHEET_WRITE_FAILED' },
    });
    expect(sheets.writeBatches).toHaveLength(3);
    expect(sheets.getCellState(worksheet, 'A5').value).toBe('舊答案一');
    expect(sheets.getCellState(worksheet, 'A7').value).toBe('舊答案二');
    expect(sheets.getCellState(worksheet, 'A3').value).toBe('舊答案四');
  });

  it('confirms a fully committed batch after the write response is lost', async () => {
    const sheets = new FakeGoogleSheetsAdapter([currentWorksheetFixture()]);
    sheets.nextWriteFailure = { kind: 'LOST_RESPONSE', commit: 'FULL', readBack: 'AVAILABLE' };
    const { port } = await start(sheets);
    const teacher = await connect(port);
    await login(teacher);

    expect(await exportAndReceive(teacher, 'lost-full-commit')).toMatchObject({
      type: 'guidedNotes.exported', requestId: 'lost-full-commit',
      payload: { writtenCellCount: 2, clearedCellCount: 1 },
    });
    expect(sheets.writeBatches).toHaveLength(1);
    expect(sheets.requestedReadRanges).toHaveLength(2);
  });

  it('reports a full unchanged read-back as a definite failure after a lost response', async () => {
    const sheets = new FakeGoogleSheetsAdapter([currentWorksheetFixture()]);
    sheets.nextWriteFailure = { kind: 'LOST_RESPONSE', commit: 'NONE', readBack: 'AVAILABLE' };
    const { port } = await start(sheets);
    const teacher = await connect(port);
    await login(teacher);

    expect(await exportAndReceive(teacher, 'lost-no-commit')).toMatchObject({
      type: 'error', requestId: 'lost-no-commit', payload: { code: 'SHEET_WRITE_FAILED' },
    });
    expect(sheets.writeBatches).toHaveLength(1);
    expect(sheets.getCellState(worksheet, 'A5').value).toBe('舊答案一');
    expect(sheets.getCellState(worksheet, 'A7').value).toBe('舊答案二');
    expect(sheets.getCellState(worksheet, 'A3').value).toBe('舊答案四');
  });

  it('reports SHEET_WRITE_UNCONFIRMED when a lost response cannot be resolved by read-back', async () => {
    const sheets = new FakeGoogleSheetsAdapter([currentWorksheetFixture()]);
    sheets.nextWriteFailure = { kind: 'LOST_RESPONSE', commit: 'NONE', readBack: 'UNAVAILABLE' };
    const { app } = await start(sheets);
    await expect(app.guidedNotes.exportAnswers()).rejects.toMatchObject({ code: 'SHEET_WRITE_UNCONFIRMED' });
    expect(sheets.writeBatches).toHaveLength(1);
    expect(app.activity.exportAnchorState.status).toBe('PREPARED');

    await expect(app.guidedNotes.exportAnswers()).rejects.toMatchObject({ code: 'SHEET_WRITE_FAILED' });
    expect(sheets.writeBatches).toHaveLength(1);
    expect(app.activity.exportAnchorState.status).toBe('NONE');
  });

  it('uses one RAW multi-range Sheets API batch for literal answer strings and clears', async () => {
    const batchUpdate = vi.fn(async () => ({ data: {} }));
    const client = {
      spreadsheets: { values: { batchUpdate } },
    } as unknown as sheets_v4.Sheets;
    const adapter = createGoogleSheetsAdapter(null, client);

    await adapter.batchWriteValues(
      { worksheet: { spreadsheetId: 'sheet-id', sheetId: 9, worksheetTitle: "Teacher's Notes" }, rowCount: 20, columnCount: 5 },
      [
        { questionId: '1', rowNumber: 3, answerColumnNumber: 2, value: '=literal answer' },
        { questionId: '2', rowNumber: 5, answerColumnNumber: 2, value: '' },
      ],
    );

    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: "'Teacher''s Notes'!B3", majorDimension: 'ROWS', values: [['=literal answer']] },
          { range: "'Teacher''s Notes'!B5", majorDimension: 'ROWS', values: [['']] },
        ],
      },
    });
  });

  it('creates literal cell updates and row/column developer metadata in one atomic Sheets batch', async () => {
    const batchUpdate = vi.fn(async () => ({ data: {} }));
    const client = { spreadsheets: { batchUpdate } } as unknown as sheets_v4.Sheets;
    const adapter = createGoogleSheetsAdapter(null, client);
    const resolved = {
      worksheet: { spreadsheetId: 'sheet-id', sheetId: 9, worksheetTitle: "Teacher's Notes" },
      rowCount: 20,
      columnCount: 5,
    };
    const anchor = {
      metadataId: 123_456,
      metadataKey: 'sb004' as const,
      attemptToken: 'attempt-1',
      dimension: 'ROW' as const,
      sheetId: 9,
      coordinate: 3,
    };

    await adapter.batchExport(resolved, [
      { questionId: 'G', rowNumber: 3, answerColumnNumber: 2, value: '=literal answer' },
      { questionId: 'G', rowNumber: 4, answerColumnNumber: 2, value: '' },
    ], [anchor]);

    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(batchUpdate.mock.calls[0]?.[0]).toMatchObject({
      spreadsheetId: 'sheet-id',
      requestBody: {
        requests: [
          {
            updateCells: {
              range: { sheetId: 9, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 2 },
              rows: [{ values: [{ userEnteredValue: { stringValue: '=literal answer' } }] }],
              fields: 'userEnteredValue',
            },
          },
          {
            updateCells: {
              range: { sheetId: 9, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 1, endColumnIndex: 2 },
              rows: [{ values: [{}] }],
              fields: 'userEnteredValue',
            },
          },
          {
            createDeveloperMetadata: {
              developerMetadata: {
                metadataId: 123_456,
                metadataKey: 'sb004',
                metadataValue: 'v1:attempt-1:ROW:9:3',
                visibility: 'PROJECT',
                location: { dimensionRange: { sheetId: 9, dimension: 'ROWS', startIndex: 2, endIndex: 3 } },
              },
            },
          },
        ],
      },
    });
  });

  it('reads formatted worksheet values alongside exact user-entered cell values', async () => {
    const get = vi.fn(async () => ({ data: {
      sheets: [{ properties: { sheetId: 9 }, data: [{ rowData: [
        { values: [
          { formattedValue: '題號', userEnteredValue: { stringValue: '題號' } },
          { formattedValue: '作答', userEnteredValue: { stringValue: '作答' } },
        ] },
        { values: [
          { formattedValue: '1', userEnteredValue: { numberValue: 1 } },
          { formattedValue: '2', userEnteredValue: { formulaValue: '=1+1' } },
        ] },
      ] }] }],
    } }));
    const client = { spreadsheets: { get } } as unknown as sheets_v4.Sheets;
    const adapter = createGoogleSheetsAdapter(null, client);
    const resolved = {
      worksheet: { spreadsheetId: 'sheet-id', sheetId: 9, worksheetTitle: "Teacher's Notes" },
      rowCount: 3,
      columnCount: 3,
    };

    const grid = await adapter.readWorksheet(resolved);

    expect(get).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      ranges: ["'Teacher''s Notes'!A1:C3"],
      includeGridData: true,
      fields: 'sheets(properties(sheetId),data(rowData(values(formattedValue,userEnteredValue))))',
    });
    expect(grid.values).toEqual([
      ['題號', '作答', ''],
      ['1', '2', ''],
      ['', '', ''],
    ]);
    expect(grid.rawValues).toEqual([
      ['{"stringValue":"題號"}', '{"stringValue":"作答"}', null],
      ['{"numberValue":1}', '{"formulaValue":"=1+1"}', null],
      [null, null, null],
    ]);
  });
});
