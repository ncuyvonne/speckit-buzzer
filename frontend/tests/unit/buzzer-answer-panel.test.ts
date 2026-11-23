import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BuzzerAnswerPanel } from '../../src/components/BuzzerAnswerPanel';
import type { BuzzerResultsViewState } from '../../src/state/buzzer-results';

function renderPanel(state: BuzzerResultsViewState, stage: 'PREPARING' | 'BUZZING' | 'ENDED' = 'BUZZING'): string {
  return renderToStaticMarkup(createElement(BuzzerAnswerPanel, {
    groupId: 'A',
    stage,
    connected: true,
    state,
    questionLayouts: [],
    onSubmit: () => undefined,
    onClearError: () => undefined,
  }));
}

describe('BuzzerAnswerPanel', () => {
  it('keeps the question selector enabled when the selected question is locked', () => {
    const state: BuzzerResultsViewState = {
      questionIds: ['1', '2'],
      ownProgress: [{ questionId: '1', submitted: true, answerText: '已送出', locked: true }],
      acceptedSubmission: { questionId: '1', answerText: '已送出' },
      error: null,
      teacherProgress: null,
      studentResults: null,
      fairRankingSettings: { enabled: false, delaySeconds: null },
      csvExport: { status: 'idle', fileName: null, message: null },
      scoreboard: null,
      submittedCount: 1,
      totalQuestionCount: 2,
    };

    const markup = renderPanel(state);
    const select = markup.match(/<select\b[^>]*>/)?.[0];
    expect(select).toBeDefined();
    expect(select).not.toContain('disabled');
  });

  it.each([
    ['AUTH_REQUIRED', '學生連線身分已失效，請重新載入頁面並重新加入組別。'],
    ['GROUP_INVALID', '目前組別無效，請重新載入頁面並選擇有效組別。'],
  ] as const)('shows student recovery guidance for %s', (code, guidance) => {
    const state: BuzzerResultsViewState = {
      questionIds: ['1'],
      ownProgress: [],
      acceptedSubmission: null,
      error: { code, message: code, questionId: null },
      teacherProgress: null,
      studentResults: null,
      fairRankingSettings: { enabled: false, delaySeconds: null },
      csvExport: { status: 'idle', fileName: null, message: null },
      scoreboard: null,
      submittedCount: 0,
      totalQuestionCount: 1,
    };

    expect(renderPanel(state)).toContain(guidance);
  });

  it('shows the exact own-group count only while BUZZING', () => {
    const state: BuzzerResultsViewState = {
      questionIds: ['1', '2', '3'],
      ownProgress: [],
      acceptedSubmission: null,
      error: null,
      teacherProgress: null,
      studentResults: null,
      fairRankingSettings: { enabled: false, delaySeconds: null },
      csvExport: { status: 'idle', fileName: null, message: null },
      scoreboard: null,
      submittedCount: 1,
      totalQuestionCount: 3,
    };
    expect(renderPanel(state)).toContain('本組已送出 1 / 3');
    expect(renderPanel(state, 'PREPARING')).not.toContain('本組已送出');
    expect(renderPanel(state, 'ENDED')).not.toContain('本組已送出');
  });
});
