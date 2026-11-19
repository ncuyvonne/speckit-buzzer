import type { AnswerCellWrite } from '../integrations/google-sheets/types.js';
import type {
  AnswerSlot,
  ExportDimensionAnchor,
  ExportManifest,
  ExportMapping,
  GroupQuestion,
  Question,
  SingleQuestion,
  WinningAnswer,
  WorksheetReference,
  WorksheetLayout,
} from './types.js';
import type { DeveloperMetadataRecord } from '../integrations/google-sheets/types.js';

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
const MAX_GROUP_SLOTS = 20;
const MARKER_PATTERN = /^(?:（(\d+)）|\((\d+)\))$/u;
const MARKER_LIKE_PATTERN = /[（(]\d+[）)]/u;

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

    const isCandidateHeaderRow = questionColumns.length > 0 && answerColumns.length > 0;
    if (isCandidateHeaderRow && (questionColumns.length > 1 || answerColumns.length > 1)) {
      throw new WorksheetParserError(
        'SHEET_LAYOUT_INVALID',
        '標題列中的「題號」或「作答」重複，請各保留一個欄位標題。',
      );
    }
    if (isCandidateHeaderRow) {
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

function parseMarker(value: string): number | null {
  const match = MARKER_PATTERN.exec(value);
  if (!match) return null;
  const number = Number(match[1] ?? match[2]);
  const isCanonicalMarker = value === `（${number}）` || value === `(${number})`;
  return Number.isSafeInteger(number) && number > 0 && isCanonicalMarker ? number : -1;
}

function invalidGroup(questionId: string, rowNumber: number, detail: string): WorksheetParserError {
  return new WorksheetParserError(
    'QUESTION_IDS_INVALID',
    `題號「${questionId}」第 ${rowNumber} 列的題組佔位符${detail}；請修正為相連列中的連續全形（1）至（20）或半形 (1) 至 (20) 編號；同一題組可混用括號樣式後再匯入。`,
  );
}

function findNextQuestionId(
  values: readonly (readonly string[])[],
  startIndex: number,
  questionColumnIndex: number,
): string | null {
  for (let rowIndex = startIndex; rowIndex < values.length; rowIndex += 1) {
    const questionId = displayedCell(values[rowIndex], questionColumnIndex);
    if (questionId.trim().length > 0) return questionId;
  }
  return null;
}

function parseGroup(
  values: readonly (readonly string[])[],
  header: HeaderPosition,
  startIndex: number,
  questionId: string,
): { readonly question: GroupQuestion; readonly lastConsumedIndex: number } {
  const sourceRowAtImport = startIndex + 1;
  const answerSlots: AnswerSlot[] = [{ placeholderNumber: 1, sourceRowAtImport }];
  let cursor = startIndex;

  while (cursor + 1 < values.length) {
    const nextIndex = cursor + 1;
    const childQuestionId = displayedCell(values[nextIndex], header.questionColumnIndex);
    if (childQuestionId.trim().length > 0) break;

    const answerValue = displayedCell(values[nextIndex], header.answerColumnIndex);
    const markerNumber = parseMarker(answerValue);
    if (markerNumber === -1 || (markerNumber === null && MARKER_LIKE_PATTERN.test(answerValue))) {
      throw invalidGroup(questionId, nextIndex + 1, '格式無效或未單獨佔用作答儲存格');
    }
    if (markerNumber !== null) {
      const expected = answerSlots.length + 1;
      if (expected > MAX_GROUP_SLOTS) {
        throw invalidGroup(questionId, nextIndex + 1, `超過 ${MAX_GROUP_SLOTS} 個子題上限`);
      }
      if (markerNumber !== expected) {
        throw invalidGroup(
          questionId,
          nextIndex + 1,
          `應為（${expected}），目前為（${markerNumber}），存在缺號、重複或倒序`,
        );
      }
      answerSlots.push({ placeholderNumber: markerNumber, sourceRowAtImport: nextIndex + 1 });
      cursor = nextIndex;
      continue;
    }

    // A marker after an empty child row would leave a gap inside this group.
    for (let lookAhead = nextIndex + 1; lookAhead < values.length; lookAhead += 1) {
      const laterQuestionId = displayedCell(values[lookAhead], header.questionColumnIndex);
      if (laterQuestionId.trim().length > 0) break;
      const laterAnswer = displayedCell(values[lookAhead], header.answerColumnIndex);
      const laterMarker = parseMarker(laterAnswer);
      if (laterMarker === -1 || (laterMarker === null && MARKER_LIKE_PATTERN.test(laterAnswer))) {
        throw invalidGroup(questionId, lookAhead + 1, '格式無效或未單獨佔用作答儲存格');
      }
      if (laterMarker !== null) {
        throw invalidGroup(
          questionId,
          lookAhead + 1,
          `必須緊接前一子題，預期為（${answerSlots.length + 1}）`,
        );
      }
    }
    break;
  }

  if (answerSlots.length < 2) {
    throw invalidGroup(questionId, sourceRowAtImport, '只有 1 個子題；題組至少需要 2 個子題');
  }

  return {
    question: {
      questionId,
      displayOrder: 0,
      sourceRowAtImport,
      kind: 'GROUP',
      answerSlots,
    },
    lastConsumedIndex: cursor,
  };
}

/** Find the unique header row and extract ordered single/group questions atomically. */
export function parseWorksheet(values: readonly (readonly string[])[]): ParsedWorksheet {
  const header = findUniqueHeader(values);
  const duplicateRows = new Map<string, number[]>();
  const questionRows = new Map<string, number>();
  const slotRows = new Map<string, readonly number[]>();
  const questions: Question[] = [];
  let previousQuestionId: string | null = null;

  for (let rowIndex = header.rowIndex + 1; rowIndex < values.length; rowIndex += 1) {
    const questionId = displayedCell(values[rowIndex], header.questionColumnIndex);
    const answerValue = displayedCell(values[rowIndex], header.answerColumnIndex);
    const markerNumber = parseMarker(answerValue);
    if (questionId.trim().length === 0) {
      if (markerNumber !== null || markerNumber === -1 || MARKER_LIKE_PATTERN.test(answerValue)) {
        const contextQuestionId = previousQuestionId
          ?? findNextQuestionId(values, rowIndex + 1, header.questionColumnIndex)
          ?? '（無題號）';
        throw invalidGroup(contextQuestionId, rowIndex + 1, '為孤立或格式無效的佔位符');
      }
      continue;
    }

    const sourceRowAtImport = rowIndex + 1;
    const existingRow = questionRows.get(questionId);
    if (existingRow !== undefined) {
      const rows = duplicateRows.get(questionId) ?? [existingRow];
      rows.push(sourceRowAtImport);
      duplicateRows.set(questionId, rows);
      continue;
    }

    questionRows.set(questionId, sourceRowAtImport);
    previousQuestionId = questionId;

    if (markerNumber === -1 || (markerNumber === null && MARKER_LIKE_PATTERN.test(answerValue))) {
      throw invalidGroup(questionId, sourceRowAtImport, '格式無效或未單獨佔用作答儲存格');
    }
    if (markerNumber !== null && markerNumber !== 1) {
      throw invalidGroup(questionId, sourceRowAtImport, `起始編號應為（1），目前為（${markerNumber}）`);
    }

    if (markerNumber === 1) {
      const { question, lastConsumedIndex } = parseGroup(values, header, rowIndex, questionId);
      questions.push({ ...question, displayOrder: questions.length + 1 });
      slotRows.set(questionId, question.answerSlots.map((slot) => slot.sourceRowAtImport));
      rowIndex = lastConsumedIndex;
      continue;
    }

    const question: SingleQuestion = {
      questionId,
      displayOrder: questions.length + 1,
      sourceRowAtImport,
      kind: 'SINGLE',
      answerSlots: [{ placeholderNumber: 1, sourceRowAtImport }],
    };
    questions.push(question);
    slotRows.set(questionId, [sourceRowAtImport]);
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
      slotRows,
    },
    questions,
  };
}

function questionTargetsInvalid(message: string): WorksheetParserError {
  return new WorksheetParserError('QUESTION_TARGET_INVALID', message);
}

function questionSlotCount(question: Question): number {
  return question.kind === 'GROUP' ? question.answerSlots.length : 1;
}

function questionKindMatches(question: Question, values: readonly (readonly string[])[], header: HeaderPosition, rowIndex: number): number[] {
  if (question.kind !== 'GROUP') {
    const answerValue = displayedCell(values[rowIndex], header.answerColumnIndex);
    if (parseMarker(answerValue) !== null || MARKER_LIKE_PATTERN.test(answerValue)) {
      throw questionTargetsInvalid(`活動單題「${question.questionId}」目前出現題組佔位符，請修正題型後再寫回。`);
    }
    return [rowIndex + 1];
  }

  const slotRows: number[] = [];
  for (let slotIndex = 0; slotIndex < question.answerSlots.length; slotIndex += 1) {
    const rowIndexAtSlot = rowIndex + slotIndex;
    const rowQuestionId = displayedCell(values[rowIndexAtSlot], header.questionColumnIndex);
    const marker = parseMarker(displayedCell(values[rowIndexAtSlot], header.answerColumnIndex));
    const expected = slotIndex + 1;
    if (rowIndexAtSlot >= values.length
      || (slotIndex === 0 ? rowQuestionId !== question.questionId : rowQuestionId.trim().length > 0)
      || marker !== expected) {
      throw questionTargetsInvalid(
        `題組「${question.questionId}」目前第 ${expected} 個佔位符與匯入時的題型/數量不符，請修正學習單後再寫回。`,
      );
    }
    slotRows.push(rowIndexAtSlot + 1);
  }

  for (let lookAhead = rowIndex + question.answerSlots.length; lookAhead < values.length; lookAhead += 1) {
    const rowQuestionId = displayedCell(values[lookAhead], header.questionColumnIndex);
    if (rowQuestionId.trim().length > 0) break;
    const answerValue = displayedCell(values[lookAhead], header.answerColumnIndex);
    if (parseMarker(answerValue) !== null || MARKER_LIKE_PATTERN.test(answerValue)) {
      throw questionTargetsInvalid(
        `題組「${question.questionId}」目前的佔位符數量超過匯入時的 ${question.answerSlots.length} 格，請修正後再寫回。`,
      );
    }
  }
  return slotRows;
}

function answersByQuestion(
  questions: readonly Question[],
  answers: readonly WinningAnswer[],
): ReadonlyMap<string, WinningAnswer> {
  const targetIds = new Set(questions.map((question) => question.questionId));
  const winners = new Map<string, WinningAnswer>();
  for (const answer of answers) {
    if (!targetIds.has(answer.questionId)) continue;
    if (winners.has(answer.questionId)) {
      throw questionTargetsInvalid(`活動題號「${answer.questionId}」有多筆成功答案，無法安全寫回。`);
    }
    winners.set(answer.questionId, answer);
  }
  return winners;
}

function winningSlotValues(question: Question, winner: WinningAnswer | undefined): readonly (string | null)[] {
  const slotCount = questionSlotCount(question);
  if (!winner) return Array.from({ length: slotCount }, () => null);
  if (question.kind === 'GROUP') {
    const answers = winner.answers;
    if (winner.answerText !== undefined || !Array.isArray(answers) || answers.length !== slotCount) {
      throw questionTargetsInvalid(`題組「${question.questionId}」的成功答案數量與學習單佔位符不符。`);
    }
    return answers.map((answer, index) => {
      if (answer.placeholderNumber !== index + 1 || !/\P{White_Space}/u.test(answer.answerText)) {
        throw questionTargetsInvalid(`題組「${question.questionId}」第 ${index + 1} 格的成功答案無效。`);
      }
      return answer.answerText;
    });
  }
  if (winner.answers !== undefined || typeof winner.answerText !== 'string' || !/\P{White_Space}/u.test(winner.answerText)) {
    throw questionTargetsInvalid(`單題「${question.questionId}」的成功答案格式無效。`);
  }
  return [winner.answerText];
}

/** Build first-export targets from a fresh worksheet scan and the imported slot layout. */
export function mapActivityAnswersToTargets(
  values: readonly (readonly string[])[],
  questions: readonly Question[],
  answers: readonly WinningAnswer[],
  rawValues?: readonly (readonly (string | null)[])[],
): ExportMapping {
  const header = findUniqueHeader(values);
  const targetIds = new Set<string>();
  for (const question of questions) {
    if (question.questionId.trim().length === 0 || targetIds.has(question.questionId)) {
      throw questionTargetsInvalid('活動題號無效或重複，無法安全定位答案儲存格。');
    }
    targetIds.add(question.questionId);
  }
  if (targetIds.size === 0) {
    throw questionTargetsInvalid('目前活動沒有可寫回的題號。');
  }

  const currentRows = new Map<string, number[]>();
  for (let rowIndex = header.rowIndex + 1; rowIndex < values.length; rowIndex += 1) {
    const questionId = displayedCell(values[rowIndex], header.questionColumnIndex);
    if (!targetIds.has(questionId)) continue;
    const rows = currentRows.get(questionId) ?? [];
    rows.push(rowIndex + 1);
    currentRows.set(questionId, rows);
  }

  const winnerMap = answersByQuestion(questions, answers);
  const targets = questions.flatMap((question) => {
    const rows = currentRows.get(question.questionId) ?? [];
    if (rows.length !== 1) {
      const detail = rows.length === 0 ? '找不到' : `出現在第 ${rows.join('、')} 列`;
      throw questionTargetsInvalid(
        `活動題號「${question.questionId}」在目前工作表中${detail}，請確認每個活動題號只對應一列。`,
      );
    }
    const rowIndex = rows[0]! - 1;
    const slotRows = questionKindMatches(question, values, header, rowIndex);
    const intendedValues = winningSlotValues(question, winnerMap.get(question.questionId));
    return slotRows.map((rowNumber, index) => ({
      questionId: question.questionId,
      placeholderNumber: index + 1,
      rowNumber,
      answerColumnNumber: header.answerColumnIndex + 1,
      prewriteValue: rawValues === undefined
        ? displayedCell(values[rowNumber - 1], header.answerColumnIndex)
        : rawValues[rowNumber - 1]?.[header.answerColumnIndex] ?? null,
      intendedValue: intendedValues[index] ?? null,
    }));
  });
  return {
    header: {
      rowNumber: header.rowIndex + 1,
      questionColumnNumber: header.questionColumnIndex + 1,
      answerColumnNumber: header.answerColumnIndex + 1,
    },
    targets,
  };
}

/** Rebuild literal cell writes for a previously confirmed layout at its anchored coordinates. */
export function mapAnswersToManifestWrites(
  questions: readonly Question[],
  answers: readonly WinningAnswer[],
  manifest: ExportManifest,
): readonly AnswerCellWrite[] {
  const winnerMap = answersByQuestion(questions, answers);
  const expectedTargetCount = questions.reduce((count, question) => count + questionSlotCount(question), 0);
  if (manifest.targets.length !== expectedTargetCount) {
    throw questionTargetsInvalid('已確認的匯出清單與活動題目數量不符。');
  }
  return questions.flatMap((question) => {
    const targets = manifest.targets
      .filter((target) => target.questionId === question.questionId)
      .sort((left, right) => left.placeholderNumber - right.placeholderNumber);
    const values = winningSlotValues(question, winnerMap.get(question.questionId));
    if (targets.length !== values.length || targets.some((target, index) => target.placeholderNumber !== index + 1)) {
      throw questionTargetsInvalid(`題號「${question.questionId}」的已確認答案格數量不符。`);
    }
    if (question.kind === 'GROUP' && !winnerMap.has(question.questionId)) return [];
    return targets.map((target, index) => ({
      questionId: question.questionId,
      rowNumber: target.rowNumber,
      answerColumnNumber: target.answerColumnNumber,
      value: values[index] ?? '',
    }));
  });
}

/** Metadata values identify the anchor attempt and its expected original dimension coordinate. */
export function exportAnchorMetadataValue(anchor: ExportDimensionAnchor): string {
  return `v1:${anchor.attemptToken}:${anchor.dimension}:${anchor.sheetId}:${anchor.coordinate}`;
}

/** Construct a compact manifest and unique row/column anchors for one atomic first export. */
export function createExportManifest(
  worksheet: WorksheetReference,
  mapping: ExportMapping,
  attemptToken: string,
  metadataIds: readonly number[],
): ExportManifest {
  const coordinates = [
    ...[...new Set([mapping.header.rowNumber, ...mapping.targets.map((target) => target.rowNumber)])]
      .sort((left, right) => left - right)
      .map((coordinate) => ({ dimension: 'ROW' as const, coordinate })),
    ...[...new Set([mapping.header.questionColumnNumber, mapping.header.answerColumnNumber])]
      .sort((left, right) => left - right)
      .map((coordinate) => ({ dimension: 'COLUMN' as const, coordinate })),
  ];
  if (attemptToken.length === 0 || !/^[A-Za-z0-9_-]+$/.test(attemptToken) || metadataIds.length !== coordinates.length) {
    throw questionTargetsInvalid('無法建立有效的匯出錨點識別資料。');
  }
  const ids = new Set<number>();
  const anchors = coordinates.map(({ dimension, coordinate }, index): ExportDimensionAnchor => {
    const metadataId = metadataIds[index];
    if (!Number.isSafeInteger(metadataId) || metadataId! <= 0 || ids.has(metadataId!)) {
      throw questionTargetsInvalid('匯出錨點 ID 必須是唯一的正整數。');
    }
    ids.add(metadataId!);
    return {
      metadataId: metadataId!,
      metadataKey: 'sb004',
      attemptToken,
      dimension,
      sheetId: worksheet.sheetId,
      coordinate,
    };
  });
  return {
    worksheet: { ...worksheet },
    header: { ...mapping.header },
    targets: mapping.targets.map((target) => ({ ...target })),
    anchors,
  };
}

/** Revalidate original target rows/columns and developer metadata before a confirmed re-export. */
export function validateConfirmedExportManifest(
  values: readonly (readonly string[])[],
  questions: readonly Question[],
  worksheet: WorksheetReference,
  manifest: ExportManifest,
  metadata: readonly DeveloperMetadataRecord[],
): void {
  if (worksheet.spreadsheetId !== manifest.worksheet.spreadsheetId
    || worksheet.sheetId !== manifest.worksheet.sheetId
    || worksheet.worksheetTitle !== manifest.worksheet.worksheetTitle) {
    throw questionTargetsInvalid('目前工作表與已確認的原始匯出分頁不符。');
  }
  const header = findUniqueHeader(values);
  const currentHeader = {
    rowNumber: header.rowIndex + 1,
    questionColumnNumber: header.questionColumnIndex + 1,
    answerColumnNumber: header.answerColumnIndex + 1,
  };
  if (currentHeader.rowNumber !== manifest.header.rowNumber
    || currentHeader.questionColumnNumber !== manifest.header.questionColumnNumber
    || currentHeader.answerColumnNumber !== manifest.header.answerColumnNumber) {
    throw questionTargetsInvalid('已匯出的標題列或題號/作答欄位已移動，無法確認原始寫回位置。');
  }

  const expectedTargetCount = questions.reduce((count, question) => count + questionSlotCount(question), 0);
  if (manifest.targets.length !== expectedTargetCount) {
    throw questionTargetsInvalid('已確認的匯出清單與活動題目數量不符。');
  }
  const targetRows = new Set<number>();
  const currentRows = new Map<string, number[]>();
  for (let rowIndex = header.rowIndex + 1; rowIndex < values.length; rowIndex += 1) {
    const questionId = displayedCell(values[rowIndex], header.questionColumnIndex);
    if (!questions.some((question) => question.questionId === questionId)) continue;
    const rows = currentRows.get(questionId) ?? [];
    rows.push(rowIndex + 1);
    currentRows.set(questionId, rows);
  }
  for (const question of questions) {
    const expectedSlots = questionSlotCount(question);
    const targets = manifest.targets
      .filter((target) => target.questionId === question.questionId)
      .sort((left, right) => left.placeholderNumber - right.placeholderNumber);
    if (targets.length !== expectedSlots
      || targets.some((target, index) => (
        target.placeholderNumber !== index + 1
        || target.answerColumnNumber !== manifest.header.answerColumnNumber
        || !Number.isSafeInteger(target.rowNumber)
        || target.rowNumber <= manifest.header.rowNumber
        || targetRows.has(target.rowNumber)
      ))) {
      throw questionTargetsInvalid(`題號「${question.questionId}」的已確認儲存格座標無效或重複。`);
    }
    for (const target of targets) targetRows.add(target.rowNumber);
    const parentRow = targets[0]?.rowNumber;
    const rows = currentRows.get(question.questionId) ?? [];
    if (rows.length !== 1 || rows[0] !== parentRow) {
      throw questionTargetsInvalid(`活動題號「${question.questionId}」已移動、重複或不在原始列。`);
    }
    for (let slotIndex = 1; slotIndex < targets.length; slotIndex += 1) {
      const target = targets[slotIndex]!;
      if (target.rowNumber !== parentRow! + slotIndex
        || displayedCell(values[target.rowNumber - 1], header.questionColumnIndex).trim().length > 0) {
        throw questionTargetsInvalid(`題組「${question.questionId}」的子題列已移動或題號欄不再空白。`);
      }
    }
  }

  const expectedAnchorCoordinates = new Set([
    ...[...new Set([manifest.header.rowNumber, ...manifest.targets.map((target) => target.rowNumber)])]
      .map((coordinate) => `ROW:${coordinate}`),
    ...[...new Set([manifest.header.questionColumnNumber, manifest.header.answerColumnNumber])]
      .map((coordinate) => `COLUMN:${coordinate}`),
  ]);
  if (manifest.anchors.length !== expectedAnchorCoordinates.size) {
    throw questionTargetsInvalid('已確認的匯出錨點數量不符。');
  }
  const manifestCoordinates = new Set<string>();
  const anchorIds = new Set<number>();
  for (const anchor of manifest.anchors) {
    const coordinateKey = `${anchor.dimension}:${anchor.coordinate}`;
    if (anchor.metadataKey !== 'sb004'
      || anchor.sheetId !== worksheet.sheetId
      || anchor.attemptToken.length === 0
      || !Number.isSafeInteger(anchor.metadataId)
      || anchor.metadataId <= 0
      || manifestCoordinates.has(coordinateKey)
      || anchorIds.has(anchor.metadataId)
      || !expectedAnchorCoordinates.has(coordinateKey)) {
      throw questionTargetsInvalid('已確認的匯出錨點資料無效。');
    }
    manifestCoordinates.add(coordinateKey);
    anchorIds.add(anchor.metadataId);
  }
  const sheetAnchors = metadata.filter((record) => (
    record.metadataKey === 'sb004'
    && record.visibility === 'PROJECT'
    && (record.locationType === 'ROW' || record.locationType === 'COLUMN')
    && record.sheetId === worksheet.sheetId
  ));
  if (sheetAnchors.length !== manifest.anchors.length) {
    throw questionTargetsInvalid('已確認的工作表錨點已遺失或重複，無法安全再次寫回。');
  }
  for (const expected of manifest.anchors) {
    const matching = sheetAnchors.filter((record) => record.metadataId === expected.metadataId);
    if (matching.length !== 1) throw questionTargetsInvalid('原始匯出錨點已遺失或重複，無法安全再次寫回。');
    const record = matching[0]!;
    if (record.metadataValue !== exportAnchorMetadataValue(expected)
      || record.locationType !== expected.dimension
      || record.dimension !== expected.dimension
      || record.sheetId !== expected.sheetId
      || record.coordinate !== expected.coordinate
      || record.endCoordinate !== expected.coordinate + 1) {
      throw questionTargetsInvalid('原始匯出錨點已移動或內容不符，無法安全再次寫回。');
    }
  }
}

/** Backwards-compatible single-cell projection used by older unit callers. */
export function mapActivityAnswersToWrites(
  values: readonly (readonly string[])[],
  questions: readonly Question[],
  answers: readonly WinningAnswer[],
): readonly AnswerCellWrite[] {
  return mapActivityAnswersToTargets(values, questions, answers).targets.map((target) => ({
    questionId: target.questionId,
    rowNumber: target.rowNumber,
    answerColumnNumber: target.answerColumnNumber,
    value: target.intendedValue ?? '',
  }));
}
