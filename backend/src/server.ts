import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { loadConfig, MAX_MESSAGE_BYTES, type AppConfig } from './config.js';
import { ActivityState } from './domain/activity-state.js';
import { GroupRoster } from './domain/group-roster.js';
import { attachHeartbeat, type HeartbeatOptions } from './realtime/heartbeat.js';
import { RealtimeHub } from './realtime/handler.js';

export const ALLOWED_ORIGIN = 'http://127.0.0.1:5173';

export interface RealtimeServerOptions {
  readonly config?: AppConfig;
  readonly host?: string;
  readonly port?: number;
  readonly heartbeat?: HeartbeatOptions;
}

export interface RealtimeServer {
  readonly httpServer: Server;
  readonly webSocketServer: WebSocketServer;
  readonly activity: ActivityState;
  readonly roster: GroupRoster;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

export function createRealtimeServer(options: RealtimeServerOptions = {}): RealtimeServer {
  const config = options.config ?? loadConfig();
  const host = options.host ?? '127.0.0.1';
  const defaultPort = options.port ?? 3001;
  const activity = new ActivityState();
  const roster = new GroupRoster(config.groups);
  const hub = new RealtimeHub({ config, activity, roster });
  const httpServer = createServer((_request, response) => {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
  });
  const stopHeartbeat = new Map<WebSocket, () => void>();

  httpServer.on('upgrade', (request, socket, head) => {
    if (request.headers.origin !== ALLOWED_ORIGIN) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit('connection', client, request);
    });
  });

  webSocketServer.on('connection', (socket) => {
    socket.on('error', () => {
      // Transport errors can include oversized or abruptly terminated messages; never log payloads.
    });
    const stop = attachHeartbeat(socket, options.heartbeat);
    stopHeartbeat.set(socket, stop);
    socket.once('close', () => {
      stopHeartbeat.get(socket)?.();
      stopHeartbeat.delete(socket);
    });

    socket.send(JSON.stringify({
      type: 'activity.snapshot',
      payload: { stage: activity.stage, groups: roster.ids },
    }));

    hub.attach(socket);
  });

  return {
    httpServer,
    webSocketServer,
    activity,
    roster,
    listen(port = defaultPort) {
      return new Promise<number>((resolveListen, reject) => {
        const onError = (error: Error) => {
          httpServer.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          httpServer.off('error', onError);
          const address = httpServer.address() as AddressInfo;
          resolveListen(address.port);
        };
        httpServer.once('error', onError);
        httpServer.once('listening', onListening);
        httpServer.listen(port, host);
      });
    },
    async close() {
      for (const stop of stopHeartbeat.values()) stop();
      stopHeartbeat.clear();
      for (const socket of webSocketServer.clients) socket.terminate();

      if (httpServer.listening) {
        await new Promise<void>((resolveClose, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolveClose()));
        });
      }
      await new Promise<void>((resolveClose) => webSocketServer.close(() => resolveClose()));
    },
  };
}

async function main(): Promise<void> {
  const app = createRealtimeServer({ config: loadConfig() });
  const port = await app.listen();
  process.stdout.write(`課堂搶答後端已啟動：127.0.0.1:${port}\n`);

  const shutdown = () => {
    void app.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : 'unknown startup failure';
    process.stderr.write(`後端啟動失敗：${detail}\n`);
    process.exitCode = 1;
  });
}
