import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TeacherScoringPanel } from '../../src/components/TeacherScoringPanel';

describe('TeacherScoringPanel', () => {
  it('shows mark, change, clear controls only for winner questions and an ordered scoreboard', () => {
    const markup = renderToStaticMarkup(createElement(TeacherScoringPanel, {
      progress: { questions: [
        { questionId: 'Q1', groups: [], winningGroupId: '2', winningAnswer: 'answer', judgement: 'CORRECT' },
        { questionId: 'Q2', groups: [], winningGroupId: null, winningAnswer: null, judgement: null },
      ] },
      scoreboard: [{ rank: 1, groupId: '2', score: 1, successfulQuestionCount: 1 }],
      onMark: vi.fn(),
    }));
    expect(markup).toContain('標記正確');
    expect(markup).toContain('標記錯誤');
    expect(markup).toContain('取消標記');
    expect(markup).toContain('組別 2');
    expect(markup.match(/取消標記/g)).toHaveLength(1);
  });
});
