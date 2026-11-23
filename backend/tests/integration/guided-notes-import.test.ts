import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadConfig } from '../../src/config.js';
import { createRealtimeServer } from '../../src/server.js';
import {
  FakeGoogleSheetsAdapter,
  type FakeDeveloperMetadataFixture,
  type FakeWorksheetFixture,
} from '../support/fake-google-sheets.js';
import { FakeWinningResultsProvider } from '../support/fake-winning-results.js';

const ORIGIN = 'http://127.0.0.1:5173';
type JsonMessage = { type: string; requestId?: string; payload: Record<string, unknown> };
type Inbox = ReturnType<typeof createInbox>;

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
          const queued = messages.map(({ type, requestId }) => ({ type, requestId })).slice(-10);
          reject(new Error(`Timed out waiting for message; queued: ${JSON.stringify(queued)}`));
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

function fixture(
  spreadsheetId: string,
  cells: FakeWorksheetFixture['cells'],
  options: {
    readonly sheetId?: number;
    readonly worksheetTitle?: string;
    readonly rowCount?: number;
    readonly columnCount?: number;
    readonly developerMetadata?: readonly FakeDeveloperMetadataFixture[];
  } = {},
): FakeWorksheetFixture {
  return {
    worksheet: {
      spreadsheetId,
      sheetId: options.sheetId ?? 7,
      worksheetTitle: options.worksheetTitle ?? '工作表1',
    },
    rowCount: options.rowCount ?? 8,
    columnCount: options.columnCount ?? 4,
    cells,
    developerMetadata: options.developerMetadata,
  };
}

const validCells = {
  A2: '作答', B2: '題號', C2: '題目敘述',
  A3: '舊答案一', B3: '1', C3: '第一題說明',
  A4: '', B4: '',
  A5: '舊答案二', B5: '2', C5: '第二題說明',
  A7: '舊答案四', B7: '4', C7: '第四題說明',
};

function minimumGroupQuestionId(targetBytes: number): string {
  const envelope = {
    type: 'buzzerResults.submitAnswer',
    requestId: '123e4567-e89b-12d3-a456-426614174000',
    payload: {
      questionId: '',
      subAnswers: [
        { placeholderNumber: 1, answerText: 'a' },
        { placeholderNumber: 2, answerText: 'a' },
      ],
    },
  };
  const questionIdLength = targetBytes - new TextEncoder().encode(JSON.stringify(envelope)).length;
  if (questionIdLength < 1) throw new Error('TARGET_BYTES_TOO_SMALL');
  return 'Q'.repeat(questionIdLength);
}

function minimumGroupCells(questionId: string) {
  return {
    A2: '作答', B2: '題號',
    A3: '（1）', B3: questionId,
    A4: '（2）', B4: '',
  };
}

describe('Guided Notes worksheet import integration', () => {
  const apps: ReturnType<typeof createRealtimeServer>[] = [];
  const sockets: WebSocket[] = [];

  async function start(sheets: FakeGoogleSheetsAdapter) {
    const app = createRealtimeServer({
      config: loadConfig({ GROUP_IDS: '1,2', TEACHER_PASSWORD: 'test-password' }),
      port: 0,
      guidedNotes: { sheetsAdapter: sheets, winningResultsProvider: new FakeWinningResultsProvider() },
    });
    apps.push(app);
    return { app, port: await app.listen(0) };
  }

  async function connect(port: number): Promise<{ socket: WebSocket; inbox: Inbox }> {
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

  async function login(connection: { socket: WebSocket; inbox: Inbox }, requestId = 'teacher-login') {
    const authenticated = connection.inbox.waitFor((message) => message.type === 'teacher.authenticated');
    connection.socket.send(JSON.stringify({
      type: 'teacher.authenticate', requestId, payload: { password: 'test-password' },
    }));
    await authenticated;
    return connection.inbox.waitFor((message) => message.type === 'guidedNotes.snapshot');
  }

  function sendImport(socket: WebSocket, requestId: string, spreadsheetId: string) {
    socket.send(JSON.stringify({
      type: 'guidedNotes.import',
      requestId,
      payload: {
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        worksheetTitle: '工作表1',
      },
    }));
  }

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('rejects unauthenticated, student, and non-PREPARING imports before contacting Sheets', async () => {
    const sheets = new FakeGoogleSheetsAdapter([fixture('valid-sheet', validCells)]);
    const { app, port } = await start(sheets);
    const unauthenticated = await connect(port);
    sendImport(unauthenticated.socket, 'unauth-import', 'valid-sheet');
    expect(await unauthenticated.inbox.waitFor((message) => message.type === 'error'))
      .toMatchObject({ requestId: 'unauth-import', payload: { code: 'AUTH_REQUIRED' } });

    const student = await connect(port);
    student.socket.send(JSON.stringify({ type: 'student.join', requestId: 'join', payload: { groupId: '1' } }));
    await student.inbox.waitFor((message) => message.type === 'student.joined');
    sendImport(student.socket, 'student-import', 'valid-sheet');
    expect(await student.inbox.waitFor((message) => message.type === 'error'))
      .toMatchObject({ requestId: 'student-import', payload: { code: 'AUTH_REQUIRED' } });

    const teacher = await connect(port);
    await login(teacher);
    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'start', payload: { from: 'PREPARING', to: 'BUZZING' },
    }));
    await teacher.inbox.waitFor((message) => message.type === 'activity.phaseChanged');
    sendImport(teacher.socket, 'wrong-stage-import', 'valid-sheet');
    expect(await teacher.inbox.waitFor((message) => message.type === 'error'))
      .toMatchObject({ requestId: 'wrong-stage-import', payload: { code: 'STAGE_CONFLICT' } });
    expect(sheets.resolveRequests).toHaveLength(0);
    expect(sheets.requestedReadRanges).toHaveLength(0);
    expect(sheets.metadataSearchRequests).toHaveLength(0);
    expect(app.activity.stage).toBe('BUZZING');
  });

  it('imports selected worksheet IDs atomically and keeps the teacher snapshot free of descriptions and full URLs', async () => {
    const sheets = new FakeGoogleSheetsAdapter([
      fixture('valid-sheet', validCells),
      fixture('bad-layout', { A2: '題號', A3: '1', B3: '題目描述但缺少作答' }),
    ]);
    const { app, port } = await start(sheets);
    const teacher = await connect(port);
    const initialSnapshot = await login(teacher);
    expect(initialSnapshot.payload).toEqual({
      worksheetTitle: null, questionIds: [], questionCount: 0, questionLayouts: [],
    });

    const timeLimitSet = teacher.inbox.waitFor((message) => message.type === 'activity.timeLimitSet'
      && message.payload.seconds === 30);
    teacher.socket.send(JSON.stringify({
      type: 'activity.setTimeLimit', requestId: 'set-time-limit-before-import', payload: { seconds: 30 },
    }));
    await timeLimitSet;
    expect(app.activity.timeLimitSeconds).toBe(30);

    const importedPromise = teacher.inbox.waitFor((message) => message.type === 'guidedNotes.imported');
    sendImport(teacher.socket, 'good-import', 'valid-sheet');
    const imported = await importedPromise;
    expect(imported).toMatchObject({
      requestId: 'good-import',
      payload: { worksheetTitle: '工作表1', questionIds: ['1', '2', '4'], questionCount: 3 },
    });
    expect(sheets.resolveRequests).toContainEqual({ spreadsheetId: 'valid-sheet', worksheetTitle: '工作表1' });
    expect(app.activity.questions.map((question) => question.questionId)).toEqual(['1', '2', '4']);
    expect(app.activity.questionCount).toBe(3);
    expect(app.activity.timeLimitSeconds).toBe(0);
    expect(JSON.stringify(app.activity.questions)).not.toContain('第一題說明');

    const reconnect = await connect(port);
    const reconnectSnapshotPromise = login(reconnect, 'teacher-login-again');
    const reconnectSnapshot = await reconnectSnapshotPromise;
    expect(reconnectSnapshot.payload).toEqual({
      worksheetTitle: '工作表1',
      questionIds: ['1', '2', '4'],
      questionCount: 3,
      questionLayouts: [
        { questionId: '1', kind: 'SINGLE', answerCount: 1 },
        { questionId: '2', kind: 'SINGLE', answerCount: 1 },
        { questionId: '4', kind: 'SINGLE', answerCount: 1 },
      ],
    });
    expect(JSON.stringify(reconnectSnapshot)).not.toContain('valid-sheet');
    expect(JSON.stringify(reconnectSnapshot)).not.toContain('題目敘述');

    const stateBeforeBadImport = structuredClone(app.activity.questions);
    const badImport = teacher.inbox.waitFor((message) => message.type === 'error');
    sendImport(teacher.socket, 'bad-import', 'bad-layout');
    expect(await badImport).toMatchObject({ requestId: 'bad-import', payload: { code: 'SHEET_LAYOUT_INVALID' } });
    expect(app.activity.questions).toEqual(stateBeforeBadImport);

    sheets.failReadsRemaining = 3;
    const failedRead = teacher.inbox.waitFor((message) => message.type === 'error');
    sendImport(teacher.socket, 'read-failure', 'valid-sheet');
    expect(await failedRead).toMatchObject({ requestId: 'read-failure', payload: { code: 'SHEET_READ_FAILED' } });
    expect(app.activity.questions).toEqual(stateBeforeBadImport);
  });

  it('rechecks the authoritative stage after the sheet read and before committing an import', async () => {
    let readStarted!: () => void;
    let releaseRead!: () => void;
    const started = new Promise<void>((resolve) => { readStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseRead = resolve; });
    class BlockingSheets extends FakeGoogleSheetsAdapter {
      override async readWorksheet(worksheet: Parameters<FakeGoogleSheetsAdapter['readWorksheet']>[0]) {
        readStarted();
        await blocked;
        return super.readWorksheet(worksheet);
      }
    }
    const sheets = new BlockingSheets([fixture('valid-sheet', validCells)]);
    const { app, port } = await start(sheets);
    const teacher = await connect(port);
    await login(teacher);

    const result = teacher.inbox.waitFor((message) => message.type === 'error');
    sendImport(teacher.socket, 'stage-race', 'valid-sheet');
    await started;
    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'advance-during-read', payload: { from: 'PREPARING', to: 'BUZZING' },
    }));
    await teacher.inbox.waitFor((message) => message.type === 'activity.phaseChanged');
    releaseRead();

    expect(await result).toMatchObject({ requestId: 'stage-race', payload: { code: 'STAGE_CONFLICT' } });
    expect(app.activity.stage).toBe('BUZZING');
    expect(app.activity.questions).toEqual([]);
    expect(app.activity.worksheet).toBeNull();
  });

  it('accepts a 16,384-byte minimum group request and rejects 16,385 bytes without replacing activity state', async () => {
    const exactId = minimumGroupQuestionId(16_384);
    const oversizedId = minimumGroupQuestionId(16_385);
    const sheets = new FakeGoogleSheetsAdapter([
      fixture('exact-minimum', minimumGroupCells(exactId), { rowCount: 5 }),
      fixture('oversized-minimum', minimumGroupCells(oversizedId), { rowCount: 5 }),
    ]);
    const { app, port } = await start(sheets);
    const teacher = await connect(port);
    await login(teacher);

    const accepted = teacher.inbox.waitFor((message) => message.type === 'guidedNotes.imported');
    sendImport(teacher.socket, 'exact-minimum-import', 'exact-minimum');
    expect(await accepted).toMatchObject({
      requestId: 'exact-minimum-import',
      payload: { questionCount: 1, questionIds: [exactId] },
    });
    const stateBeforeOversized = structuredClone(app.activity.questions);

    const rejected = teacher.inbox.waitFor((message) => message.type === 'error');
    sendImport(teacher.socket, 'oversized-minimum-import', 'oversized-minimum');
    const error = await rejected;
    const message = String(error.payload.message ?? '');
    expect(message).toContain(oversizedId);
    expect(message).toContain('第 3 列');
    expect(message).toContain('16,384');
    expect(app.activity.questions).toEqual(stateBeforeOversized);
    expect(app.activity.worksheet?.spreadsheetId).toBe('exact-minimum');
  });

  it('blocks selected sheets carrying PROJECT sb004 row/column anchors but ignores unrelated metadata', async () => {
    const sheets = new FakeGoogleSheetsAdapter([
      fixture('valid-sheet', validCells),
      fixture('exported-workbook', validCells, {
        developerMetadata: [
          { metadataKey: 'sb004', visibility: 'PROJECT', locationType: 'ROW', sheetId: 7 },
        ],
      }),
      fixture('safe-workbook', validCells, {
        developerMetadata: [
          { metadataKey: 'another-feature', visibility: 'PROJECT', locationType: 'ROW', sheetId: 7 },
          { metadataKey: 'sb004', visibility: 'PROJECT', locationType: 'SHEET', sheetId: 7 },
          { metadataKey: 'sb004', visibility: 'PROJECT', locationType: 'ROW', sheetId: 9 },
          { metadataKey: 'sb004', visibility: 'DOCUMENT', locationType: 'COLUMN', sheetId: 7 },
        ],
      }),
      fixture('safe-workbook', validCells, {
        sheetId: 9,
        worksheetTitle: '其他分頁',
        developerMetadata: [
          { metadataKey: 'sb004', visibility: 'PROJECT', locationType: 'COLUMN', sheetId: 9 },
        ],
      }),
    ]);
    const { app, port } = await start(sheets);
    const teacher = await connect(port);
    await login(teacher);

    const initialImport = teacher.inbox.waitFor((message) => message.type === 'guidedNotes.imported');
    sendImport(teacher.socket, 'initial-import', 'valid-sheet');
    await initialImport;
    const previousQuestions = structuredClone(app.activity.questions);
    const readCountBeforeBlock = sheets.requestedReadRanges.length;

    const blockedImport = teacher.inbox.waitFor((message) => message.type === 'error');
    sendImport(teacher.socket, 'blocked-exported-import', 'exported-workbook');
    const blocked = await blockedImport;
    expect(String(blocked.payload.message ?? '')).toContain('原始');
    expect(String(blocked.payload.message ?? '')).toContain('佔位符已被取代');
    expect(String(blocked.payload.message ?? '')).toContain('副本');
    expect(app.activity.questions).toEqual(previousQuestions);
    expect(app.activity.worksheet?.spreadsheetId).toBe('valid-sheet');
    expect(sheets.requestedReadRanges).toHaveLength(readCountBeforeBlock);

    const allowedImport = teacher.inbox.waitFor((message) => message.type === 'guidedNotes.imported');
    sendImport(teacher.socket, 'unrelated-metadata-import', 'safe-workbook');
    expect(await allowedImport).toMatchObject({ requestId: 'unrelated-metadata-import' });
    expect(app.activity.worksheet?.spreadsheetId).toBe('safe-workbook');
    expect(sheets.metadataSearchRequests).toEqual([
      { spreadsheetId: 'valid-sheet', metadataKey: 'sb004', visibility: 'PROJECT' },
      { spreadsheetId: 'exported-workbook', metadataKey: 'sb004', visibility: 'PROJECT' },
      { spreadsheetId: 'safe-workbook', metadataKey: 'sb004', visibility: 'PROJECT' },
    ]);
  });
});
