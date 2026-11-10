import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachHeartbeat } from '../../src/realtime/heartbeat.js';

class MockSocket extends EventEmitter {
  readyState = 1;
  pingCount = 0;
  terminated = false;

  ping() {
    this.pingCount += 1;
  }

  terminate() {
    this.terminated = true;
    this.readyState = 3;
    this.emit('close');
  }
}

describe('heartbeat lifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('pings every 30 seconds and terminates when pong misses the 10-second deadline', () => {
    vi.useFakeTimers();
    const socket = new MockSocket();
    attachHeartbeat(socket as never);

    vi.advanceTimersByTime(30_000);
    expect(socket.pingCount).toBe(1);
    vi.advanceTimersByTime(9_999);
    expect(socket.terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(socket.terminated).toBe(true);
  });

  it('clears the pong deadline when pong arrives and continues scheduling pings', () => {
    vi.useFakeTimers();
    const socket = new MockSocket();
    attachHeartbeat(socket as never);

    vi.advanceTimersByTime(30_000);
    socket.emit('pong');
    vi.advanceTimersByTime(10_000);
    expect(socket.terminated).toBe(false);
    vi.advanceTimersByTime(20_000);
    expect(socket.pingCount).toBe(2);
  });

  it('clears the interval and pending deadline when the socket closes', () => {
    vi.useFakeTimers();
    const socket = new MockSocket();
    const stop = attachHeartbeat(socket as never);

    vi.advanceTimersByTime(30_000);
    expect(vi.getTimerCount()).toBe(2);
    socket.emit('close');
    expect(vi.getTimerCount()).toBe(0);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(socket.pingCount).toBe(1);
  });
});
