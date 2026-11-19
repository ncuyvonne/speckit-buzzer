import assert from 'node:assert/strict';
import { google } from 'googleapis';
import { parseGoogleServiceAccountCredentials } from '../dist/config.js';
import { ActivityState } from '../dist/domain/activity-state.js';
import { GuidedNotesService } from '../dist/guided-notes/service.js';
import { createGoogleSheetsAdapter } from '../dist/integrations/google-sheets/adapter.js';

const credentials = parseGoogleServiceAccountCredentials(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
const spreadsheetUrl = new URL(process.env.GUIDED_NOTES_POC_SPREADSHEET_URL);
const spreadsheetId = spreadsheetUrl.pathname.split('/')[3];
if (!spreadsheetId) throw new Error('POC_CONFIGURATION_INVALID');

const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheetsClient = google.sheets({ version: 'v4', auth });
const adapter = createGoogleSheetsAdapter(credentials, sheetsClient);
let serviceBatchCount = 0;
const observedAdapter = {
  resolveWorksheet: (...args) => adapter.resolveWorksheet(...args),
  readWorksheet: (...args) => adapter.readWorksheet(...args),
  searchDeveloperMetadata: (...args) => adapter.searchDeveloperMetadata(...args),
  batchExport: (...args) => {
    serviceBatchCount += 1;
    return adapter.batchExport(...args);
  },
};
const temporaryTitle = `F004Anchor_${Date.now()}`;
let temporarySheetId;

function safeCode(error) {
  if (typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)) return error.code;
  if (Number.isInteger(error?.code) && error.code >= 100 && error.code <= 599) return `HTTP_${error.code}`;
  return 'LIVE_ANCHOR_VALIDATION_FAILED';
}

function sheetIdForMetadata(record) {
  return record.location?.dimensionRange?.sheetId ?? record.location?.sheetId;
}

async function anchorCount() {
  const response = await sheetsClient.spreadsheets.developerMetadata.search({
    spreadsheetId,
    requestBody: { dataFilters: [{ developerMetadataLookup: { metadataKey: 'sb004', visibility: 'PROJECT' } }] },
  });
  return (response.data.matchedDeveloperMetadata ?? []).filter(({ developerMetadata }) => (
    developerMetadata && sheetIdForMetadata(developerMetadata) === temporarySheetId
  )).length;
}

async function readMatrix(endRow = 12) {
  const response = await sheetsClient.spreadsheets.values.get({
    spreadsheetId,
    range: `'${temporaryTitle}'!A1:B${endRow}`,
    valueRenderOption: 'FORMULA',
  });
  return Array.from({ length: endRow }, (_, rowIndex) => Array.from({ length: 2 }, (_, columnIndex) => (
    response.data.values?.[rowIndex]?.[columnIndex] ?? ''
  )));
}

try {
  const created = await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: temporaryTitle, gridProperties: { rowCount: 1000, columnCount: 26 } } } }],
    },
  });
  temporarySheetId = created.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (!Number.isInteger(temporarySheetId)) throw new Error('TEMPORARY_SHEET_CREATE_FAILED');

  const fixture = [
    ['題號', '作答'],
    ['Q001', ''],
    ['Q002', '（1）'],
    ['', '（2）'],
    ['Q003', '（1）'],
    ['', '（2）'],
    ['', '（3）'],
    ['Q004', ''],
  ];
  await sheetsClient.spreadsheets.values.update({
    spreadsheetId,
    range: `'${temporaryTitle}'!A1:B${fixture.length}`,
    valueInputOption: 'RAW',
    requestBody: { values: fixture },
  });

  const activity = new ActivityState();
  const service = new GuidedNotesService({
    activity,
    sheets: observedAdapter,
    winningResultsProvider: {
      getSnapshot: async () => ({
        status: 'READY',
        answers: [
          { questionId: 'Q001', groupId: '1', answerText: 'SINGLE_WINNER' },
          { questionId: 'Q002', groupId: '2', answers: [
            { placeholderNumber: 1, answerText: 'GROUP_2_SLOT_1' },
            { placeholderNumber: 2, answerText: 'GROUP_2_SLOT_2' },
          ] },
        ],
      }),
    },
  });

  const importResult = await service.importWorksheet({
    spreadsheetUrl: process.env.GUIDED_NOTES_POC_SPREADSHEET_URL,
    worksheetTitle: temporaryTitle,
  });
  assert.equal(importResult.questionCount, 4);
  assert.equal(activity.advance('PREPARING', 'BUZZING').accepted, true);
  assert.equal(activity.advance('BUZZING', 'ENDED').accepted, true);

  const first = await service.exportAnswers();
  assert.equal(first.writtenCellCount, 3);
  assert.equal(first.clearedCellCount, 1);
  assert.equal(serviceBatchCount, 1);
  const afterFirstExport = await readMatrix();
  assert.equal(afterFirstExport[1][1], 'SINGLE_WINNER');
  assert.equal(afterFirstExport[2][1], 'GROUP_2_SLOT_1');
  assert.equal(afterFirstExport[3][1], 'GROUP_2_SLOT_2');
  assert.equal(afterFirstExport[4][1], '（1）');
  assert.equal(afterFirstExport[5][1], '（2）');
  assert.equal(afterFirstExport[6][1], '（3）');
  assert.equal(afterFirstExport[7][1], '');
  const anchorsAfterFirst = await anchorCount();
  assert.ok(anchorsAfterFirst > 0);

  await sheetsClient.spreadsheets.values.update({
    spreadsheetId,
    range: `'${temporaryTitle}'!B3`,
    valueInputOption: 'RAW',
    requestBody: { values: [['TEACHER_TARGET_EDIT']] },
  });
  const repeat = await service.exportAnswers();
  assert.equal(repeat.writtenCellCount, 3);
  assert.equal(repeat.clearedCellCount, 1);
  assert.equal(serviceBatchCount, 2);
  assert.equal(await anchorCount(), anchorsAfterFirst);
  const afterValueRepeat = await readMatrix();
  assert.equal(afterValueRepeat[1][1], 'SINGLE_WINNER');
  assert.equal(afterValueRepeat[2][1], 'GROUP_2_SLOT_1');
  assert.equal(afterValueRepeat[3][1], 'GROUP_2_SLOT_2');
  assert.equal(afterValueRepeat[4][1], '（1）');
  assert.equal(afterValueRepeat[5][1], '（2）');
  assert.equal(afterValueRepeat[6][1], '（3）');
  assert.equal(afterValueRepeat[7][1], '');

  await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ insertDimension: { range: { sheetId: temporarySheetId, dimension: 'ROWS', startIndex: 3, endIndex: 4 }, inheritFromBefore: false } }],
    },
  });
  const beforeRejectedRepeat = await readMatrix();
  let rejectionCode = null;
  try {
    await service.exportAnswers();
  } catch (error) {
    rejectionCode = error?.code ?? null;
  }
  assert.equal(rejectionCode, 'QUESTION_TARGET_INVALID');
  assert.equal(serviceBatchCount, 2);
  assert.deepEqual(await readMatrix(), beforeRejectedRepeat);

  console.log('LIVE_ANCHOR_VALIDATION=PASS');
  console.log(`first_export_written=${first.writtenCellCount}`);
  console.log(`first_export_cleared=${first.clearedCellCount}`);
  console.log('target_value_only_repeat=PASS');
  console.log('anchor_count_unchanged_on_repeat=true');
  console.log(`structural_change_rejected=${rejectionCode}`);
  console.log('rejected_repeat_batches=0');
} catch (error) {
  console.error(`LIVE_ANCHOR_VALIDATION=FAIL code=${safeCode(error)}`);
  process.exitCode = 1;
} finally {
  if (Number.isInteger(temporarySheetId)) {
    try {
      await sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ deleteSheet: { sheetId: temporarySheetId } }] },
      });
      const check = await sheetsClient.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId))' });
      const stillPresent = check.data.sheets?.some((sheet) => sheet.properties?.sheetId === temporarySheetId) ?? false;
      assert.equal(stillPresent, false);
      console.log('temporary_tab_removed=true');
    } catch (error) {
      console.error(`TEMPORARY_TAB_CLEANUP=FAIL code=${safeCode(error)}`);
      process.exitCode = 1;
    }
  }
}
