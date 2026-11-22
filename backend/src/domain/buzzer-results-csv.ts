import type { BuzzerCsvQuestion } from './buzzer-results.js';

const HEADER = ['題號', '組別', '答案', '搶答順位', '是否搶答成功', '送出時間'] as const;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

function localTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function formatBuzzerResultsLocalTimestamp(timestampMs: number): string {
  return localTimestamp(timestampMs);
}

function csvField(value: string): string {
  const spreadsheetSafeValue = /^[=+\-@＝＋－＠\t\r\n]/u.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(spreadsheetSafeValue)
    ? `"${spreadsheetSafeValue.replaceAll('"', '""')}"`
    : spreadsheetSafeValue;
}

/** Serializes accepted submissions only; answer correctness and scoring are not part of this export. */
export function serializeBuzzerResultsCsv(questions: readonly BuzzerCsvQuestion[]): string {
  const records = [HEADER.join(',')];
  for (const question of questions) {
    for (const submission of [...question.submissions].sort((left, right) => left.rank - right.rank)) {
      records.push([
        question.questionId,
        submission.groupId,
        submission.answerText,
        String(submission.rank),
        submission.rank === 1 ? '是' : '否',
        localTimestamp(submission.receivedAtMs),
      ].map(csvField).join(','));
    }
  }
  return `\uFEFF${records.join('\r\n')}`;
}
