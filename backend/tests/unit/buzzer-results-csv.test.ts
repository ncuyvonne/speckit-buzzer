import { describe, expect, it } from 'vitest';
import { formatBuzzerResultsLocalTimestamp, serializeBuzzerResultsCsv } from '../../src/domain/buzzer-results-csv.js';
import { ActivityState } from '../../src/domain/activity-state.js';
import { BuzzerResultsService, type BuzzerCsvQuestion } from '../../src/domain/buzzer-results.js';
import { GroupRoster } from '../../src/domain/group-roster.js';

describe('buzzer results CSV', () => {
  it('exports one row per submission in rank order with the required columns and local timestamp', () => {
    const timestampMs = Date.UTC(2026, 10, 19, 12, 34, 56, 789);
    const date = new Date(timestampMs);
    const localTimestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} `
      + `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`;
    const questions: BuzzerCsvQuestion[] = [
      {
        questionId: '1',
        submissions: [
          { groupId: 'B', answerText: '第二順位', rank: 2, receivedAtMs: timestampMs },
          { groupId: 'A', answerText: '（1）第一格（2）第二格', rank: 1, receivedAtMs: timestampMs },
        ],
      },
      { questionId: '2', submissions: [] },
    ];

    const csv = serializeBuzzerResultsCsv(questions);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.slice(1)).toBe([
      '題號,組別,答案,搶答順位,是否搶答成功,送出時間',
      `1,A,（1）第一格（2）第二格,1,是,${localTimestamp}`,
      `1,B,第二順位,2,否,${localTimestamp}`,
    ].join('\r\n'));
    expect(formatBuzzerResultsLocalTimestamp(timestampMs)).toBe(localTimestamp);
    expect(new TextEncoder().encode(csv).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    expect(csv.slice(1).split('\r\n').some((row) => row.startsWith('2,'))).toBe(false);
  });

  it('builds submission-only export data with contiguous group answers and server receive time', () => {
    const receivedAtMs = Date.UTC(2026, 10, 19, 12, 34, 56, 789);
    const activity = new ActivityState();
    activity.replaceGuidedNotesImport({ spreadsheetId: 'csv', sheetId: 1, worksheetTitle: 'Sheet' }, [{
      kind: 'GROUP', questionId: '1', displayOrder: 1, sourceRowAtImport: 2,
      answerSlots: [
        { placeholderNumber: 1, sourceRowAtImport: 2 },
        { placeholderNumber: 2, sourceRowAtImport: 3 },
      ],
    }]);
    activity.advance('PREPARING', 'BUZZING');
    const service = new BuzzerResultsService({ activity, roster: new GroupRoster(['A', 'B']), now: () => receivedAtMs });
    service.submitAnswer('A', '1', [
      { placeholderNumber: 1, answerText: '第一格' },
      { placeholderNumber: 2, answerText: '第二格' },
    ]);

    expect(service.getCsvExportData()).toEqual([{
      questionId: '1',
      submissions: [{
        groupId: 'A', answerText: '（1）第一格（2）第二格', rank: 1, receivedAtMs,
      }],
    }]);
  });

  it.each(['=SUM(1,2)', '+1', '-1', '@name', '＝1+1', '＋1', '－1', '＠name', '\t=1+1', '\r=1+1', '\n=1+1'])(
    'prefixes spreadsheet formula trigger %j before CSV escaping',
    (answerText) => {
      const csv = serializeBuzzerResultsCsv([{
        questionId: '1',
        submissions: [{ groupId: 'A', answerText, rank: 1, receivedAtMs: 0 }],
      }]);

      expect(csv.slice(1)).toContain(`'${answerText}`);
    },
  );

  it('sanitizes a formula answer that also contains commas, quotes, and newlines', () => {
    const csv = serializeBuzzerResultsCsv([{
      questionId: '1',
      submissions: [{ groupId: 'A', answerText: '=SUM("a", "b")\r\nnext', rank: 1, receivedAtMs: 0 }],
    }]);

    expect(csv.slice(1)).toContain('1,A,"\'=SUM(""a"", ""b"")\r\nnext",1,是,');
  });
});
