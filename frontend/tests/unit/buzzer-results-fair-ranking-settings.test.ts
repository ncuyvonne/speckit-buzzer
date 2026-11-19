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

    expect(client.setFairRanking({ enabled: true, delaySeconds: 0.5 })).toBe(true);
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      type: 'buzzerResults.setFairRanking',
      requestId: 'settings-request',
      payload: { enabled: true, delaySeconds: 0.5 },
    });
    socket.receive({
      type: 'buzzerResults.fairRankingConfigured',
      requestId: 'settings-request',
      payload: { enabled: true, delaySeconds: 0.5 },
    });
    expect(client.buzzerResults.getSnapshot().fairRankingSettings)
      .toEqual({ enabled: true, delaySeconds: 0.5 });
  });

  it.each(['', '0', '-0.5', 'NaN', 'Infinity'])('shows a clear error for invalid delay %j', (value) => {
    expect(validateFairRankingDelay(value)).toBe('請輸入大於 0 的有效延遲秒數。');
  });

  it('accepts a positive decimal delay', () => {
    expect(validateFairRankingDelay('0.5')).toBeNull();
  });

  it('renders an actionable validation error and prevents starting with a blank enabled delay', () => {
    const html = renderToStaticMarkup(createElement(TeacherPanel, {
      role: 'TEACHER',
      stage: 'PREPARING',
      connected: true,
      error: null,
      onLogin: () => undefined,
      onAdvance: () => undefined,
      fairRankingSettings: { enabled: true, delaySeconds: null },
      onSetFairRanking: () => undefined,
    }));

    expect(html).toContain('請輸入大於 0 的有效延遲秒數。');
    expect(html).toContain('role="alert"');
  });
});
