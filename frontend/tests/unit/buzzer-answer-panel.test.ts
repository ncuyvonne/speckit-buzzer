import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BuzzerAnswerPanel } from '../../src/components/BuzzerAnswerPanel';
import type { BuzzerResultsViewState } from '../../src/state/buzzer-results';

function renderPanel(state: BuzzerResultsViewState): string {
  return renderToStaticMarkup(createElement(BuzzerAnswerPanel, {
    groupId: 'A',
    stage: 'BUZZING',
    connected: true,
    state,
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
    };

    expect(renderPanel(state)).toContain(guidance);
  });
});
