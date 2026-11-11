import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createRealtimeServer } from '../../src/server.js';
import type { AppConfig } from '../../src/config.js';

const ORIGIN = 'http://127.0.0.1:5173';
const messageBacklog = new WeakMap<WebSocket, unknown[]>();
const config: AppConfig = {
  teacherPassword: 'test-password',
  teacherLoginEnabled: true,
  groups: ['1', '2'],
};

function waitForMessage(socket: WebSocket, predicate: (value: unknown) => boolean) {
  const backlog = messageBacklog.get(socket) ?? [];
  const existingIndex = backlog.findIndex(predicate);
  if (existingIndex >= 0) return Promise.resolve(backlog.splice(existingIndex, 1)[0]);

  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), 2_000);
    const onMessage = (value: unknown) => {
      if (predicate(value)) {
        clearTimeout(timeout);
        socket.off('test-message', onMessage);
        const index = backlog.indexOf(value);
        if (index >= 0) backlog.splice(index, 1);
        resolve(value);
      }
    };
    socket.on('test-message', onMessage);
  });
}

async function openSocket(url: string, options: ConstructorParameters<typeof WebSocket>[1] = {}) {
  const socket = new WebSocket(url, { headers: { Origin: ORIGIN }, ...options });
  const backlog: unknown[] = [];
  messageBacklog.set(socket, backlog);
  socket.on('message', (data) => {
    const value = JSON.parse(data.toString()) as unknown;
    backlog.push(value);
    socket.emit('test-message', value);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

describe('WebSocket connection boundary', () => {
  const servers: ReturnType<typeof createRealtimeServer>[] = [];

  async function start(options: Parameters<typeof createRealtimeServer>[0] = {}) {
    const app = createRealtimeServer({ config, ...options });
    servers.push(app);
    const port = await app.listen(0);
    return { app, url: `ws://127.0.0.1:${port}/ws` };
  }

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((app) => app.close()));
  });

  it('sends an initial snapshot with the server stage and configured groups', async () => {
    const { url } = await start();
    const socket = await openSocket(url);
    const snapshot = await waitForMessage(socket, (value) => (value as { type?: string }).type === 'activity.snapshot');

    expect(snapshot).toEqual({ type: 'activity.snapshot', payload: { stage: 'PREPARING', groups: ['1', '2'] } });
    socket.close();
  });

  it('rejects missing and disallowed Origin upgrades with HTTP 403', async () => {
    const { url } = await start();

    for (const options of [{}, { headers: { Origin: 'https://example.com' } }]) {
      const socket = new WebSocket(url, options);
      const error = await new Promise<Error>((resolve) => socket.once('error', resolve));
      expect(error.message).toContain('403');
    }
  });

  it('accepts a complete message at 16 KiB and closes an oversized message with 1009', async () => {
    const { url } = await start();
    const accepted = await openSocket(url);
    const invalidMessage = ' '.repeat(16_384);
    const response = waitForMessage(accepted, (value) => (value as { type?: string }).type === 'error');
    accepted.send(invalidMessage);
    expect(await response).toMatchObject({ type: 'error', payload: { code: 'INVALID_MESSAGE' } });
    accepted.close();

    const oversized = await openSocket(url);
    const closed = new Promise<number>((resolve) => oversized.once('close', (code) => resolve(code)));
    oversized.send(' '.repeat(16_385));
    expect(await closed).toBe(1009);
  });

  it('terminates a stale socket without closing a responsive peer', async () => {
    const { url } = await start({ heartbeat: { intervalMs: 50, timeoutMs: 40 } });
    const stale = await openSocket(url, { autoPong: false });
    const peer = await openSocket(url);
    const staleClosed = new Promise<number>((resolve) => stale.once('close', (code) => resolve(code)));

    expect(await staleClosed).toBe(1006);
    expect(peer.readyState).toBe(WebSocket.OPEN);
    await waitForMessage(peer, (value) => (value as { type?: string }).type === 'activity.snapshot');
    peer.close();
  });
});
