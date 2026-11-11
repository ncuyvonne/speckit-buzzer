import type { AnswerCellWrite } from '../integrations/google-sheets/types.js';
import type { Question, WinningAnswer, WorksheetLayout } from './types.js';

export type WorksheetParserErrorCode = 'SHEET_LAYOUT_INVALID' | 'QUESTION_IDS_INVALID' | 'QUESTION_TARGET_INVALID';

export class WorksheetParserError extends Error {
  constructor(readonly code: WorksheetParserErrorCode, message: string) {
    super(message);
    this.name = 'WorksheetParserError';
  }
}

export interface ParsedWorksheet {
  readonly layout: WorksheetLayout;
  readonly questions: readonly Question[];
}

const QUESTION_HEADER = '題號';
const ANSWER_HEADER = '作答';
const MAX_QUESTIONS = 100;

interface HeaderPosition {
  readonly rowIndex: number;
  readonly questionColumnIndex: number;
  readonly answerColumnIndex: number;
}

function displayedCell(row: readonly string[] | undefined, columnIndex: number): string {
  const value = row?.[columnIndex];
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

function findUniqueHeader(values: readonly (readonly string[])[]): HeaderPosition {
  const candidates: HeaderPosition[] = [];

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] ?? [];
    const questionColumns: number[] = [];
    const answerColumns: number[] = [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const label = displayedCell(row, columnIndex).trim();
      if (label === QUESTION_HEADER) questionColumns.push(columnIndex);
      if (label === ANSWER_HEADER) answerColumns.push(columnIndex);
    }

    if (questionColumns.length > 1 || answerColumns.length > 1) {
      throw new WorksheetParserError(
        'SHEET_LAYOUT_INVALID',
        '標題列中的「題號」或「作答」重複，請各保留一個欄位標題。',
      );
    }
    if (questionColumns.length === 1 && answerColumns.length === 1) {
      candidates.push({
        rowIndex,
        questionColumnIndex: questionColumns[0]!,
        answerColumnIndex: answerColumns[0]!,
      });
    }
  }

  if (candidates.length !== 1) {
    throw new WorksheetParserError(
      'SHEET_LAYOUT_INVALID',
      '找不到唯一標題列；請確認只有一列同時包含各一個「題號」與「作答」標題。',
    );
  }
  return candidates[0]!;
}

/** Find the unique header row and extract only ordered, non-empty question IDs. */
export function parseWorksheet(values: readonly (readonly string[])[]): ParsedWorksheet {
  const header = findUniqueHeader(values);
  const duplicateRows = new Map<string, number[]>();
  const questionRows = new Map<string, number>();
  const questions: Question[] = [];

  for (let rowIndex = header.rowIndex + 1; rowIndex < values.length; rowIndex += 1) {
    const questionId = displayedCell(values[rowIndex], header.questionColumnIndex);
    if (questionId.trim().length === 0) continue;

    const sourceRowAtImport = rowIndex + 1;
    const existingRow = questionRows.get(questionId);
    if (existingRow !== undefined) {
      const rows = duplicateRows.get(questionId) ?? [existingRow];
      rows.push(sourceRowAtImport);
      duplicateRows.set(questionId, rows);
      continue;
    }

    questionRows.set(questionId, sourceRowAtImport);
    questions.push({
      questionId,
      displayOrder: questions.length + 1,
      sourceRowAtImport,
    });
  }

  if (duplicateRows.size > 0) {
    const details = [...duplicateRows]
      .map(([questionId, rows]) => `「${questionId}」位於第 ${rows.join('、')} 列`)
      .join('；');
    throw new WorksheetParserError(
      'QUESTION_IDS_INVALID',
      `題號不可重複：${details}。請修正題號後再匯入。`,
    );
  }
  if (questions.length === 0) {
    throw new WorksheetParserError(
      'QUESTION_IDS_INVALID',
      '找不到有效題號；請在「題號」欄填入至少一個非空題號。',
    );
  }
  if (questions.length > MAX_QUESTIONS) {
    throw new WorksheetParserError(
      'QUESTION_IDS_INVALID',
      `每份學習單最多支援 ${MAX_QUESTIONS} 題，請移除多餘題號後再匯入。`,
    );
  }

  return {
    layout: {
      headerRowNumber: header.rowIndex + 1,
      questionColumnNumber: header.questionColumnIndex + 1,
      answerColumnNumber: header.answerColumnIndex + 1,
      questionRows,
    },
    questions,
  };
}

/** Map server-owned answers to fresh worksheet coordinates by exact activity question ID. */
export function mapActivityAnswersToWrites(
  values: readonly (readonly string[])[],
  questions: readonly Question[],
  answers: readonly WinningAnswer[],
): readonly AnswerCellWrite[] {
  const header = findUniqueHeader(values);
  const targetIds = new Set<string>();
  for (const question of questions) {
    if (question.questionId.trim().length === 0 || targetIds.has(question.questionId)) {
      throw new WorksheetParserError('QUESTION_TARGET_INVALID', '活動題號無效或重複，無法安全定位答案儲存格。');
    }
    targetIds.add(question.questionId);
  }
  if (targetIds.size === 0) {
    throw new WorksheetParserError('QUESTION_TARGET_INVALID', '目前活動沒有可寫回的題號。');
  }

  const currentRows = new Map<string, number[]>();
  for (let rowIndex = header.rowIndex + 1; rowIndex < values.length; rowIndex += 1) {
    const questionId = displayedCell(values[rowIndex], header.questionColumnIndex);
    if (!targetIds.has(questionId)) continue;
    const rows = currentRows.get(questionId) ?? [];
    rows.push(rowIndex + 1);
    currentRows.set(questionId, rows);
  }

  for (const question of questions) {
    const rows = currentRows.get(question.questionId) ?? [];
    if (rows.length !== 1) {
      const detail = rows.length === 0 ? '找不到' : `出現在第 ${rows.join('、')} 列`;
      throw new WorksheetParserError(
        'QUESTION_TARGET_INVALID',
        `活動題號「${question.questionId}」在目前工作表中${detail}，請確認每個活動題號只對應一列。`,
      );
    }
  }

  const answersByQuestion = new Map<string, string>();
  for (const answer of answers) {
    if (!targetIds.has(answer.questionId)) continue;
    if (answersByQuestion.has(answer.questionId)) {
      throw new WorksheetParserError(
        'QUESTION_TARGET_INVALID',
        `活動題號「${answer.questionId}」有多筆成功答案，無法安全寫回。`,
      );
    }
    answersByQuestion.set(answer.questionId, answer.answerText);
  }

  return questions.map((question) => ({
    questionId: question.questionId,
    rowNumber: currentRows.get(question.questionId)![0]!,
    answerColumnNumber: header.answerColumnIndex + 1,
    value: answersByQuestion.get(question.questionId) ?? '',
  }));
}
