import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { google } from 'googleapis';
import { parseGoogleServiceAccountCredentials } from '../dist/config.js';
import { ActivityState } from '../dist/domain/activity-state.js';
import { GuidedNotesService } from '../dist/guided-notes/service.js';
import { mapActivityAnswersToWrites } from '../dist/guided-notes/worksheet-parser.js';
import { createGoogleSheetsAdapter } from '../dist/integrations/google-sheets/adapter.js';

const SPREADSHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`CONFIG_MISSING_${name}`);
  return value;
}

function spreadsheetIdFrom(urlValue) {
  const url = new URL(urlValue);
  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !match) {
    throw new Error('SHEET_REFERENCE_INVALID');
  }
  return match[1];
}

function columnToNumber(letters) {
  let value = 0;
  for (const letter of letters.toUpperCase()) value = value * 26 + letter.charCodeAt(0) - 64;
  return value;
}

function columnToLetters(column) {
  let value = column;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function parseScratchRange(range) {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)(?::\$?([A-Z]{1,3})\$?([1-9]\d*))?$/i.exec(range);
  if (!match) throw new Error('SCRATCH_RANGE_INVALID');
  const bounds = {
    startRow: Number(match[2]),
    startColumn: columnToNumber(match[1]),
    endRow: Number(match[4] ?? match[2]),
    endColumn: columnToNumber(match[3] ?? match[1]),
  };
  if (bounds.endRow < bounds.startRow || bounds.endColumn < bounds.startColumn) {
    throw new Error('SCRATCH_RANGE_INVALID');
  }
  return bounds;
}

function quoteSheetTitle(title) {
  return `'${title.replace(/'/g, "''")}'`;
}

function getUserEnteredValue(response, sheetId, rowIndex, columnIndex) {
  const sheet = response.data.sheets?.find((candidate) => candidate.properties?.sheetId === sheetId);
  const data = sheet?.data?.[0];
  if (!data) return null;
  const rowOffset = rowIndex - (data.startRow ?? 0);
  const columnOffset = columnIndex - (data.startColumn ?? 0);
  if (rowOffset < 0 || columnOffset < 0) return null;
  return data.rowData?.[rowOffset]?.values?.[columnOffset]?.userEnteredValue ?? null;
}

async function readScratchGrid(sheets, spreadsheetId, worksheetTitle, scratchRange) {
  return sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`${quoteSheetTitle(worksheetTitle)}!${scratchRange}`],
    includeGridData: true,
    fields: 'sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(userEnteredValue))))',
  });
}

async function restoreTargets(sheets, spreadsheetId, sheetId, targets, originals) {
  const requests = targets.map((target, index) => ({
    updateCells: {
      range: {
        sheetId,
        startRowIndex: target.rowNumber - 1,
        endRowIndex: target.rowNumber,
        startColumnIndex: target.answerColumnNumber - 1,
        endColumnIndex: target.answerColumnNumber,
      },
      rows: [{ values: [originals[index] === null ? {} : { userEnteredValue: originals[index] }] }],
      fields: 'userEnteredValue',
    },
  }));
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

async function run() {
  const credentialJson = requiredEnvironment('GOOGLE_SERVICE_ACCOUNT_JSON');
  const spreadsheetUrl = requiredEnvironment('GUIDED_NOTES_POC_SPREADSHEET_URL');
  const worksheetTitle = requiredEnvironment('GUIDED_NOTES_POC_WORKSHEET_TITLE');
  const scratchRange = requiredEnvironment('GUIDED_NOTES_POC_SCRATCH_RANGE');
  const spreadsheetId = spreadsheetIdFrom(spreadsheetUrl);
  const bounds = parseScratchRange(scratchRange);
  const credentials = parseGoogleServiceAccountCredentials(credentialJson);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: [SPREADSHEETS_SCOPE] });
  const sheetsClient = google.sheets({ version: 'v4', auth });
  const adapter = createGoogleSheetsAdapter(credentials, sheetsClient);
  const activity = new ActivityState();
  let winningSnapshot = { status: 'READY', answers: [] };
  const service = new GuidedNotesService({
    activity,
    sheets: adapter,
    winningResultsProvider: { getSnapshot: async () => winningSnapshot },
  });

  const importStarted = performance.now();
  const imported = await service.importWorksheet({ spreadsheetUrl, worksheetTitle });
  const importMs = Math.round(performance.now() - importStarted);
  if (imported.questionCount < 2 || imported.questionCount > 100) throw new Error('QUESTION_COUNT_OUT_OF_RANGE');

  const activityQuestions = activity.questions;
  const winningQuestionId = imported.questionIds[0];
  if (!winningQuestionId) throw new Error('NO_WINNING_TARGET');
  winningSnapshot = {
    status: 'READY',
    answers: [{ questionId: winningQuestionId, groupId: '1', answerText: `GUIDED_NOTES_LIVE_BENCH_${Date.now()}` }],
  };

  const worksheet = activity.worksheet;
  if (!worksheet) throw new Error('IMPORT_DID_NOT_SAVE_WORKSHEET');
  const resolved = await adapter.resolveWorksheet(worksheet.spreadsheetId, worksheet.worksheetTitle);
  const grid = await adapter.readWorksheet(resolved);
  const targets = mapActivityAnswersToWrites(grid.values, activityQuestions, winningSnapshot.answers);
  const scratchBefore = await readScratchGrid(sheetsClient, spreadsheetId, worksheetTitle, scratchRange);
  const sheetId = resolved.worksheet.sheetId;
  const scratchCoordinates = targets.map((target) => ({
    rowIndex: target.rowNumber - 1,
    columnIndex: target.answerColumnNumber - 1,
  }));
  for (const coordinate of scratchCoordinates) {
    if (
      coordinate.rowIndex + 1 < bounds.startRow || coordinate.rowIndex + 1 > bounds.endRow
      || coordinate.columnIndex + 1 < bounds.startColumn || coordinate.columnIndex + 1 > bounds.endColumn
    ) {
      throw new Error('TARGET_OUTSIDE_SCRATCH_RANGE');
    }
  }
  const originals = scratchCoordinates.map(({ rowIndex, columnIndex }) => (
    getUserEnteredValue(scratchBefore, sheetId, rowIndex, columnIndex)
  ));

  let exportResult;
  let exportMs;
  let restoreVerified = false;
  let exportError;
  try {
    activity.advance('PREPARING', 'BUZZING');
    activity.advance('BUZZING', 'ENDED');
    const exportStarted = performance.now();
    exportResult = await service.exportAnswers();
    exportMs = Math.round(performance.now() - exportStarted);
  } catch (error) {
    exportError = error;
  } finally {
    await restoreTargets(sheetsClient, spreadsheetId, sheetId, targets, originals);
    const scratchAfter = await readScratchGrid(sheetsClient, spreadsheetId, worksheetTitle, scratchRange);
    for (let index = 0; index < scratchCoordinates.length; index += 1) {
      const { rowIndex, columnIndex } = scratchCoordinates[index];
      assert.ok(isDeepStrictEqual(originals[index], getUserEnteredValue(scratchAfter, sheetId, rowIndex, columnIndex)));
    }
    restoreVerified = true;
  }
  if (exportError) throw exportError;
  const totalTargetCellCount = activityQuestions.reduce(
    (count, question) => count + (question.kind === 'GROUP' ? question.answerSlots.length : 1),
    0,
  );
  assert.equal(exportResult?.writtenCellCount, 1);
  assert.equal(exportResult?.clearedCellCount, totalTargetCellCount - 1);

  return { importMs, exportMs, questionCount: imported.questionCount, grid: `${resolved.rowCount}x${resolved.columnCount}`, restoreVerified };
}

function safeFailureCode(error) {
  if (typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)) return error.code;
  if (Number.isInteger(error?.code) && error.code >= 100 && error.code <= 599) return `HTTP_${error.code}`;
  if (typeof error?.message === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message)) return error.message;
  return 'UNEXPECTED_FAILURE';
}

try {
  const result = await run();
  console.log('GUIDED_NOTES_SERVICE_BENCHMARK=PASS');
  console.log(`question_count=${result.questionCount}`);
  console.log(`grid=${result.grid}`);
  console.log(`import_ms=${result.importMs}`);
  console.log(`export_ms=${result.exportMs}`);
  console.log(`scratch_targets_restored=${result.restoreVerified}`);
} catch (error) {
  console.error(`GUIDED_NOTES_SERVICE_BENCHMARK=FAIL code=${safeFailureCode(error)}`);
  process.exitCode = 1;
}
