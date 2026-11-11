import type WebSocket from 'ws';

export interface HeartbeatSocket {
  readonly readyState: number;
  ping(): void;
  terminate(): void;
  on(event: 'pong' | 'close', listener: () => void): this;
  removeListener(event: 'pong' | 'close', listener: () => void): this;
}

export interface HeartbeatOptions {
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
}

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export function attachHeartbeat(
  socket: HeartbeatSocket | WebSocket,
  options: HeartbeatOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let stopped = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  const clearDeadline = () => {
    if (deadline !== undefined) {
      clearTimeout(deadline);
      deadline = undefined;
    }
  };
  const onPong = () => clearDeadline();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    clearDeadline();
    socket.removeListener('pong', onPong);
    socket.removeListener('close', stop);
  };
  const interval = setInterval(() => {
    if (stopped || socket.readyState !== 1) return;
    clearDeadline();
    socket.ping();
    deadline = setTimeout(() => {
      deadline = undefined;
      if (!stopped) socket.terminate();
    }, timeoutMs);
  }, intervalMs);

  socket.on('pong', onPong);
  socket.on('close', stop);
  return stop;
}
