import { describe, expect, it } from 'vitest';
import {
  exportAnchorMetadataValue,
  mapAnswersToManifestWrites,
  mapActivityAnswersToTargets,
  mapActivityAnswersToWrites,
  validateConfirmedExportManifest,
} from '../../../src/guided-notes/worksheet-parser.js';
import type { ExportDimensionAnchor, ExportManifest, Question, WinningAnswer, WorksheetReference } from '../../../src/guided-notes/types.js';
import type { DeveloperMetadataRecord } from '../../../src/integrations/google-sheets/types.js';

const activityQuestions: readonly Question[] = [
  { questionId: '1', displayOrder: 1, sourceRowAtImport: 3 },
  { questionId: '2', displayOrder: 2, sourceRowAtImport: 5 },
  { questionId: '4', displayOrder: 3, sourceRowAtImport: 7 },
];

const winningAnswers: readonly WinningAnswer[] = [
  { questionId: '1', groupId: 'A', answerText: '=literal answer' },
  { questionId: '4', groupId: 'B', answerText: '新答案四' },
];

describe('mapActivityAnswersToWrites', () => {
  it('discovers the current header and maps reordered rows and columns by exact question ID', () => {
    const values = [
      ['學習單標題'],
      ['說明'],
      ['題目說明', ' 作答 ', ' 題號 ', '其他'],
      ['第四題', '舊答案四', '4', '保留'],
      ['第一題', '舊答案一', '1', '保留'],
      ['', '', '', ''],
      ['第二題', '舊答案二', '2', '保留'],
    ];

    expect(mapActivityAnswersToWrites(values, activityQuestions, winningAnswers)).toEqual([
      { questionId: '1', rowNumber: 5, answerColumnNumber: 2, value: '=literal answer' },
      { questionId: '2', rowNumber: 7, answerColumnNumber: 2, value: '' },
      { questionId: '4', rowNumber: 4, answerColumnNumber: 2, value: '新答案四' },
    ]);
  });

  it('rejects before write when an activity question is absent from the current worksheet', () => {
    const values = [
      ['題號', '作答'],
      ['1', '舊答案一'],
      ['4', '舊答案四'],
    ];

    expect(() => mapActivityAnswersToWrites(values, activityQuestions, winningAnswers))
      .toThrow(expect.objectContaining({ code: 'QUESTION_TARGET_INVALID' }));
  });

  it('rejects before write when an activity question is duplicated in the current worksheet', () => {
    const values = [
      ['題號', '作答'],
      ['1', '舊答案一'],
      ['2', '舊答案二'],
      ['1', '重複題號'],
      ['4', '舊答案四'],
    ];

    expect(() => mapActivityAnswersToWrites(values, activityQuestions, winningAnswers))
      .toThrow(expect.objectContaining({ code: 'QUESTION_TARGET_INVALID' }));
  });

  it('ignores extra worksheet IDs and creates exactly one target per activity question', () => {
    const values = [
      ['題號', '作答'],
      ['1', '舊答案一'],
      ['99', '額外題目一'],
      ['2', '舊答案二'],
      ['99', '額外題目二'],
      ['4', '舊答案四'],
    ];

    const writes = mapActivityAnswersToWrites(values, activityQuestions, winningAnswers);
    expect(writes.map(({ questionId }) => questionId)).toEqual(['1', '2', '4']);
    expect(writes.map(({ rowNumber }) => rowNumber)).toEqual([2, 4, 6]);
  });

  it('maps each winning answer and uses an empty string for every no-winner question', () => {
    const values = [
      ['題號', '作答'],
      ['1', '舊答案一'],
      ['2', '舊答案二'],
      ['4', '舊答案四'],
    ];

    expect(mapActivityAnswersToWrites(values, activityQuestions, winningAnswers).map(({ value }) => value))
      .toEqual(['=literal answer', '', '新答案四']);
  });
});

const groupedQuestions: readonly Question[] = [
  { questionId: 'S', kind: 'SINGLE', displayOrder: 1, sourceRowAtImport: 2, answerSlots: [{ placeholderNumber: 1, sourceRowAtImport: 2 }] },
  { questionId: 'G2', kind: 'GROUP', displayOrder: 2, sourceRowAtImport: 4, answerSlots: [
    { placeholderNumber: 1, sourceRowAtImport: 4 },
    { placeholderNumber: 2, sourceRowAtImport: 5 },
  ] },
  { questionId: 'G3', kind: 'GROUP', displayOrder: 3, sourceRowAtImport: 7, answerSlots: [
    { placeholderNumber: 1, sourceRowAtImport: 7 },
    { placeholderNumber: 2, sourceRowAtImport: 8 },
    { placeholderNumber: 3, sourceRowAtImport: 9 },
  ] },
];

const groupedValues = [
  ['題號', '作答'],
  ['S', '舊單題'],
  ['', ''],
  ['G2', '（1）'],
  ['', '（2）'],
  ['', ''],
  ['G3', '（1）'],
  ['', '（2）'],
  ['', '（3）'],
];

const groupedAnswers: readonly WinningAnswer[] = [
  { questionId: 'S', groupId: 'A', answerText: '單題答案' },
  { questionId: 'G2', groupId: 'B', answers: [
    { placeholderNumber: 1, answerText: '=literal 一' },
    { placeholderNumber: 2, answerText: '第二格' },
  ] },
  { questionId: 'G3', groupId: 'C', answers: [
    { placeholderNumber: 1, answerText: '三之一' },
    { placeholderNumber: 2, answerText: '三之二' },
    { placeholderNumber: 3, answerText: '三之三' },
  ] },
];

describe('grouped export mapping', () => {
  it('maps mixed single and different group sizes to each exact placeholder cell', () => {
    expect(mapActivityAnswersToTargets(groupedValues, groupedQuestions, groupedAnswers)).toEqual({
      header: { rowNumber: 1, questionColumnNumber: 1, answerColumnNumber: 2 },
      targets: [
        { questionId: 'S', placeholderNumber: 1, rowNumber: 2, answerColumnNumber: 2, prewriteValue: '舊單題', intendedValue: '單題答案' },
        { questionId: 'G2', placeholderNumber: 1, rowNumber: 4, answerColumnNumber: 2, prewriteValue: '（1）', intendedValue: '=literal 一' },
        { questionId: 'G2', placeholderNumber: 2, rowNumber: 5, answerColumnNumber: 2, prewriteValue: '（2）', intendedValue: '第二格' },
        { questionId: 'G3', placeholderNumber: 1, rowNumber: 7, answerColumnNumber: 2, prewriteValue: '（1）', intendedValue: '三之一' },
        { questionId: 'G3', placeholderNumber: 2, rowNumber: 8, answerColumnNumber: 2, prewriteValue: '（2）', intendedValue: '三之二' },
        { questionId: 'G3', placeholderNumber: 3, rowNumber: 9, answerColumnNumber: 2, prewriteValue: '（3）', intendedValue: '三之三' },
      ],
    });
  });

  it.each([
    { values: [['題號', '作答'], ['S', 'old'], ['G2', '（1）'], ['', '（2）']] },
    { values: [['題號', '作答'], ['S', 'old'], ['G2', '（1）'], ['', '（2）'], ['', ''], ['G2', '（1）'], ['', '（2）']] },
  ])('rejects missing or duplicate first-export question targets before any write', ({ values }) => {
    expect(() => mapActivityAnswersToTargets(values, groupedQuestions, groupedAnswers))
      .toThrow(expect.objectContaining({ code: 'QUESTION_TARGET_INVALID' }));
  });

  it('marks all no-winner group targets as preserved and produces no cell writes', () => {
    const mapping = mapActivityAnswersToTargets(groupedValues, groupedQuestions, []);
    expect(mapping.targets.filter((target) => target.questionId === 'G3').map((target) => target.intendedValue))
      .toEqual([null, null, null]);
    const group = groupedQuestions.find((question) => question.questionId === 'G3')!;
    const noWinnerManifest: ExportManifest = {
      worksheet: { spreadsheetId: 'sheet', sheetId: 7, worksheetTitle: 'Sheet' },
      header: mapping.header,
      targets: mapping.targets.filter((target) => target.questionId === 'G3'),
      anchors: [],
    };
    expect(mapAnswersToManifestWrites([group], [], noWinnerManifest)).toEqual([]);
  });

  it('retains exact prewrite values, including a formula, separately from displayed values', () => {
    const rawValues = groupedValues.map((row) => row.map((value) => (
      value.length === 0 ? null : JSON.stringify({ stringValue: value })
    )));
    rawValues[1]![1] = JSON.stringify({ formulaValue: '=1+1' });

    const mapping = mapActivityAnswersToTargets(groupedValues, groupedQuestions, groupedAnswers, rawValues);

    expect(mapping.targets[0]?.prewriteValue).toBe('{"formulaValue":"=1+1"}');
    expect(mapping.targets[1]?.prewriteValue).toBe('{"stringValue":"（1）"}');
  });

  const worksheet: WorksheetReference = { spreadsheetId: 'sheet', sheetId: 7, worksheetTitle: 'Sheet' };
  const manifest: ExportManifest = {
    worksheet,
    header: { rowNumber: 1, questionColumnNumber: 1, answerColumnNumber: 2 },
    targets: [
      { questionId: 'G', placeholderNumber: 1, rowNumber: 2, answerColumnNumber: 2, prewriteValue: '（1）', intendedValue: 'old one' },
      { questionId: 'G', placeholderNumber: 2, rowNumber: 3, answerColumnNumber: 2, prewriteValue: '（2）', intendedValue: 'old two' },
    ],
    anchors: [
      { metadataId: 41, metadataKey: 'sb004', attemptToken: 'attempt', dimension: 'ROW', sheetId: 7, coordinate: 1 },
      { metadataId: 42, metadataKey: 'sb004', attemptToken: 'attempt', dimension: 'ROW', sheetId: 7, coordinate: 2 },
      { metadataId: 43, metadataKey: 'sb004', attemptToken: 'attempt', dimension: 'ROW', sheetId: 7, coordinate: 3 },
      { metadataId: 44, metadataKey: 'sb004', attemptToken: 'attempt', dimension: 'COLUMN', sheetId: 7, coordinate: 1 },
      { metadataId: 45, metadataKey: 'sb004', attemptToken: 'attempt', dimension: 'COLUMN', sheetId: 7, coordinate: 2 },
    ],
  };
  const anchors: readonly DeveloperMetadataRecord[] = manifest.anchors.map((anchor: ExportDimensionAnchor) => ({
    metadataId: anchor.metadataId,
    metadataKey: anchor.metadataKey,
    metadataValue: exportAnchorMetadataValue(anchor),
    visibility: 'PROJECT',
    locationType: anchor.dimension,
    dimension: anchor.dimension,
    sheetId: anchor.sheetId,
    coordinate: anchor.coordinate,
    endCoordinate: anchor.coordinate + 1,
  }));
  const confirmedValues = [['題號', '作答'], ['G', '答案一'], ['', '答案二']];
  const groupQuestion: readonly Question[] = [{ questionId: 'G', kind: 'GROUP', displayOrder: 1, sourceRowAtImport: 2, answerSlots: [
    { placeholderNumber: 1, sourceRowAtImport: 2 },
    { placeholderNumber: 2, sourceRowAtImport: 3 },
  ] }];

  it('accepts target-value-only edits while the confirmed header, rows, and all anchors stay in place', () => {
    const editedTargetValues = [['題號', '作答'], ['G', '老師自行修改'], ['', '另一個修改']];
    expect(() => validateConfirmedExportManifest(editedTargetValues, groupQuestion, worksheet, manifest, anchors)).not.toThrow();
  });

  it.each([
    { name: 'missing row anchor', anchors: anchors.slice(0, -1) },
    { name: 'moved row anchor', anchors: anchors.map((anchor) => anchor.metadataId === 42 ? { ...anchor, coordinate: 9 } : anchor) },
    { name: 'moved column anchor', anchors: anchors.map((anchor) => anchor.metadataId === 45 ? { ...anchor, coordinate: 3 } : anchor) },
  ])('rejects a $name on confirmed re-export', ({ anchors: changedAnchors }) => {
    expect(() => validateConfirmedExportManifest(confirmedValues, groupQuestion, worksheet, manifest, changedAnchors))
      .toThrow(expect.objectContaining({ code: 'QUESTION_TARGET_INVALID' }));
  });

  it('rejects a moved question row or a nonblank child question cell on confirmed re-export', () => {
    expect(() => validateConfirmedExportManifest([['題號', '作答'], ['', ''], ['G', '答案一'], ['', '答案二']], groupQuestion, worksheet, manifest, anchors))
      .toThrow(expect.objectContaining({ code: 'QUESTION_TARGET_INVALID' }));
    expect(() => validateConfirmedExportManifest([['題號', '作答'], ['G', '答案一'], ['unexpected child id', '答案二']], groupQuestion, worksheet, manifest, anchors))
      .toThrow(expect.objectContaining({ code: 'QUESTION_TARGET_INVALID' }));
  });
});
