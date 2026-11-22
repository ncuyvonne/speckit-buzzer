import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RealtimeClient } from '../../src/realtime/client';
import { BuzzerResultsStore, validateFairRankingDelay } from '../../src/state/buzzer-results';
import { StudentSelection } from '../../src/state/student-selection';
import { TeacherPanel } from '../../src/components/TeacherPanel';

class FakeWebSocket {
  readyState = 0;
  readonly sent: string[] = [];
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.#listeners.get(type) ?? [];
    listeners.push(listener);
    this.#listeners.set(type, listeners);
  }

  send(data: string): void { this.sent.push(data); }

  open(): void {
    this.readyState = 1;
    for (const listener of this.#listeners.get('open') ?? []) listener({ type: 'open' });
  }

  receive(message: unknown): void {
    for (const listener of this.#listeners.get('message') ?? []) listener({ data: JSON.stringify(message) });
  }
}

describe('fair-ranking frontend settings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('starts with fairness disabled and no delay', () => {
    expect(new BuzzerResultsStore().getSnapshot().fairRankingSettings)
      .toEqual({ enabled: false, delaySeconds: null });
  });

  it('sends a typed fair-ranking request and applies the server acknowledgement', () => {
    vi.stubGlobal('WebSocket', { OPEN: 1, CLOSING: 2 });
    vi.stubGlobal('crypto', { randomUUID: () => 'settings-request' });
    const socket = new FakeWebSocket();
    const client = new RealtimeClient({
      studentSelection: new StudentSelection({ getItem: () => null, setItem: () => undefined, removeItem: () => undefined }),
      location: { protocol: 'http:', host: 'localhost' },
      createSocket: () => socket as unknown as WebSocket,
    });
    client.connect();
    socket.open();
    socket.receive({ type: 'teacher.authenticated', requestId: 'auth', payload: { ok: true } });

    expect(client.setFairRanking({ enabled: true, delaySeconds: 1.5 })).toBe(true);
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      type: 'buzzerResults.setFairRanking',
      requestId: 'settings-request',
      payload: { enabled: true, delaySeconds: 1.5 },
    });
    socket.receive({
      type: 'buzzerResults.fairRankingConfigured',
      requestId: 'settings-request',
      payload: { enabled: true, delaySeconds: 1.5 },
    });
    expect(client.buzzerResults.getSnapshot().fairRankingSettings)
      .toEqual({ enabled: true, delaySeconds: 1.5 });
  });

  it.each(['', '0', '0.99', '-0.5', '30.01', 'NaN', 'Infinity'])('shows a clear error for invalid delay %j', (value) => {
    expect(validateFairRankingDelay(value)).toBe('請輸入 1 到 30 秒之間的有效延遲。');
  });

  it.each(['1', '3', '30', '1.5'])('accepts a delay within the inclusive range (%s)', (value) => {
    expect(validateFairRankingDelay(value)).toBeNull();
  });

  it('shows the default three-second value and constrains the number input', () => {
    const html = renderToStaticMarkup(createElement(TeacherPanel, {
      role: 'TEACHER',
      stage: 'PREPARING',
      connected: true,
      error: null,
      onLogin: () => undefined,
      onAdvance: () => undefined,
      onSetFairRanking: () => undefined,
    }));

    expect(html).toContain('value="3"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="30"');
  });

  it('renders an actionable validation error for an enabled out-of-range delay', () => {
    const html = renderToStaticMarkup(createElement(TeacherPanel, {
      role: 'TEACHER',
      stage: 'PREPARING',
      connected: true,
      error: null,
      onLogin: () => undefined,
      onAdvance: () => undefined,
      fairRankingSettings: { enabled: true, delaySeconds: 31 },
      onSetFairRanking: () => undefined,
    }));

    expect(html).toContain('請輸入 1 到 30 秒之間的有效延遲。');
    expect(html).toContain('role="alert"');
  });

  it('warns teachers that live rank and winner may change when fairness is enabled', () => {
    const html = renderToStaticMarkup(createElement(TeacherPanel, {
      role: 'TEACHER',
      stage: 'BUZZING',
      connected: true,
      error: null,
      onLogin: () => undefined,
      onAdvance: () => undefined,
      fairRankingSettings: { enabled: true, delaySeconds: 3 },
      resultsProgress: {
        questions: [{
          questionId: '1',
          groups: [{ groupId: 'A', submitted: true, rank: 1, answerText: 'answer' }],
          winningGroupId: 'A',
          winningAnswer: 'answer',
        }],
      },
    }));

    expect(html).toContain('公平順位啟用中；後續提交可能使目前成功組別與順位改變。');
  });
});
