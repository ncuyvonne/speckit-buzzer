import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TeacherPanel } from '../../src/components/TeacherPanel';

function renderTeacher(stage: 'PREPARING' | 'BUZZING' | 'ENDED', timeLimitSeconds = 0, remainingSeconds: number | null = null) {
  return renderToStaticMarkup(createElement(TeacherPanel, {
    role: 'TEACHER',
    stage,
    connected: true,
    error: null,
    timeLimitSeconds,
    remainingSeconds,
    onLogin: () => undefined,
    onAdvance: () => undefined,
    onSetTimeLimit: vi.fn(),
  }));
}

describe('TeacherPanel timer controls', () => {
  it('shows an integer-seconds setting from 0 through 3600 only while preparing', () => {
    const markup = renderTeacher('PREPARING');
    expect(markup).toContain('搶答時限（秒）');
    expect(markup).toMatch(/type="number"[^>]*min="0"[^>]*max="3600"[^>]*step="1"/);
    expect(markup).toContain('value="0"');
    expect(renderTeacher('BUZZING', 2, 1)).not.toContain('搶答時限（秒）');
  });

  it('shows unlimited instead of a countdown for a zero limit and shows the server countdown otherwise', () => {
    expect(renderTeacher('BUZZING', 0, null)).toContain('不限時');
    expect(renderTeacher('BUZZING', 30, 7)).toContain('剩餘時間：7 秒');
    expect(renderTeacher('ENDED', 30, null)).not.toContain('剩餘時間');
  });
});
