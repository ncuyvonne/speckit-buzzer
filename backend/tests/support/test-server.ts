import { loadConfig } from '../../src/config.js';
import { createRealtimeServer } from '../../src/server.js';

export interface TestServerOptions {
  readonly port?: number;
  readonly teacherPassword?: string | null;
  readonly groupIds?: string;
}

export interface TestServerHandle {
  readonly port: number;
  readonly url: string;
  disconnectClients(): void;
  disconnectFirstClient(): void;
  close(): Promise<void>;
}

/** Starts a fresh activity with explicitly injected test values; it never reads repository .env. */
export async function startTestServer(options: TestServerOptions = {}): Promise<TestServerHandle> {
  const env: Record<string, string | undefined> = {
    GROUP_IDS: options.groupIds ?? '1,2,3',
  };
  const password = options.teacherPassword === undefined ? 'e2e-teacher-password' : options.teacherPassword;
  if (password !== null) env.TEACHER_PASSWORD = password;

  const app = createRealtimeServer({
    config: loadConfig(env),
    host: '127.0.0.1',
    port: options.port ?? 3001,
  });
  const port = await app.listen(options.port ?? 3001);

  return {
    port,
    url: `ws://127.0.0.1:${port}/ws`,
    disconnectClients: () => {
      for (const socket of app.webSocketServer.clients) socket.close(1012, 'test reconnect');
    },
    disconnectFirstClient: () => {
      const first = app.webSocketServer.clients.values().next().value;
      if (first) first.close(1012, 'test reconnect');
    },
    close: () => app.close(),
  };
}
