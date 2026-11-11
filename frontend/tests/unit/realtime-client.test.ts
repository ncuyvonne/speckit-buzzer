import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeClient } from '../../src/realtime/client';
import { StudentSelection, STUDENT_SELECTION_STORAGE_KEY } from '../../src/state/student-selection';

type TestListener = (event: unknown) => void;

class FakeWebSocket {
  readyState = 0;
  readonly sent: string[] = [];
  readonly #listeners = new Map<string, TestListener[]>();

  addEventListener(type: string, listener: TestListener): void {
    const listeners = this.#listeners.get(type) ?? [];
    listeners.push(listener);
    this.#listeners.set(type, listeners);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.#emit('close', { code: 1000 });
  }

  open(): void {
    this.readyState = 1;
    this.#emit('open', { type: 'open' });
  }

  receive(message: unknown): void {
    this.#emit('message', { data: JSON.stringify(message) });
  }

  #emit(type: string, event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

describe('RealtimeClient group binding errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves the joined student role and saved group when a rebind is rejected', () => {
    vi.stubGlobal('WebSocket', { OPEN: 1, CLOSING: 2 });
    const values = new Map<string, string>();
    const selection = new StudentSelection({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
    });
    const socket = new FakeWebSocket();
    const client = new RealtimeClient({
      studentSelection: selection,
      location: { protocol: 'http:', host: 'localhost' },
      createSocket: () => socket as unknown as WebSocket,
    });

    client.connect();
    socket.open();
    socket.receive({ type: 'student.joined', requestId: 'join-a', payload: { ok: true, groupId: 'A' } });
    expect(client.store.getSnapshot()).toMatchObject({ role: 'STUDENT', selectedGroupId: 'A' });
    expect(values.get(STUDENT_SELECTION_STORAGE_KEY)).toBe('A');

    client.join('B');
    const rebindRequestId = JSON.parse(socket.sent.at(-1)!).requestId as string;
    socket.receive({
      type: 'error',
      requestId: rebindRequestId,
      payload: { code: 'GROUP_INVALID', message: '已加入的組別不能變更，請重新連線以恢復原組別。' },
    });

    expect(client.store.getSnapshot()).toMatchObject({ role: 'STUDENT', selectedGroupId: 'A' });
    expect(selection.read()).toBe('A');
  });
});
