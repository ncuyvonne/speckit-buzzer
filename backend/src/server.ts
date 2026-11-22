import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import {
  loadConfig,
  MAX_MESSAGE_BYTES,
  parseGoogleServiceAccountCredentials,
  type AppConfig,
} from './config.js';
import { ActivityState } from './domain/activity-state.js';
import { ActivityTimer } from './domain/activity-timer.js';
import { BuzzerResultsService } from './domain/buzzer-results.js';
import { ScoringService } from './domain/scoring.js';
import { GroupRoster } from './domain/group-roster.js';
import { createGoogleSheetsAdapter } from './integrations/google-sheets/adapter.js';
import type { GoogleSheetsAdapter } from './integrations/google-sheets/types.js';
import { GuidedNotesService, type WinningResultsProvider } from './guided-notes/service.js';
import { BuzzerWinningResultsProvider } from './guided-notes/winning-results-provider.js';
import { attachHeartbeat, type HeartbeatOptions } from './realtime/heartbeat.js';
import { RealtimeHub } from './realtime/handler.js';

export const ALLOWED_ORIGIN = 'http://127.0.0.1:5173';

export interface RealtimeServerOptions {
  readonly config?: AppConfig;
  readonly host?: string;
  readonly port?: number;
  readonly allowedOrigin?: string;
  readonly heartbeat?: HeartbeatOptions;
  readonly guidedNotes?: {
    readonly sheetsAdapter?: GoogleSheetsAdapter;
    readonly winningResultsProvider?: WinningResultsProvider;
  };
}

export interface RealtimeServer {
  readonly httpServer: Server;
  readonly webSocketServer: WebSocketServer;
  readonly activity: ActivityState;
  readonly roster: GroupRoster;
  readonly guidedNotes: GuidedNotesService;
  readonly buzzerResults: BuzzerResultsService;
  readonly scoring: ScoringService;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

export function createRealtimeServer(options: RealtimeServerOptions = {}): RealtimeServer {
  const config = options.config ?? loadConfig();
  const host = options.host ?? '127.0.0.1';
  const allowedOrigin = options.allowedOrigin ?? ALLOWED_ORIGIN;
  const defaultPort = options.port ?? 3001;
  const activity = new ActivityState();
  const roster = new GroupRoster(config.groups);
  const buzzerResults = new BuzzerResultsService({ activity, roster });
  const scoring = new ScoringService({ activity, roster, buzzerResults });
  let hub: RealtimeHub | null = null;
  const activityTimer = new ActivityTimer({
    activity,
    onCountdown: (remainingSeconds) => hub?.broadcastCountdown(remainingSeconds),
    onEnded: () => hub?.broadcastPhaseChanged(),
  });
  let sheetsAdapter = options.guidedNotes?.sheetsAdapter;
  if (!sheetsAdapter) {
    let credentials = null;
    try {
      credentials = parseGoogleServiceAccountCredentials(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch {
      // Missing or malformed optional Sheets credentials must not disable Feature 001 login.
    }
    sheetsAdapter = createGoogleSheetsAdapter(credentials);
  }
  const winningResultsProvider = options.guidedNotes?.winningResultsProvider
    ?? new BuzzerWinningResultsProvider(activity, buzzerResults);
  const guidedNotes = new GuidedNotesService({
    activity,
    sheets: sheetsAdapter,
    winningResultsProvider,
    onImportCommitted: () => {
      activityTimer.stop();
      buzzerResults.clearSession();
      scoring.clear();
    },
  });
  hub = new RealtimeHub({ config, activity, activityTimer, roster, guidedNotes, buzzerResults, scoring });
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
    if (request.headers.origin !== allowedOrigin) {
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
      payload: {
        stage: activity.stage,
        groups: roster.ids,
        timeLimitSeconds: activity.timeLimitSeconds,
        remainingSeconds: activity.getRemainingSeconds(),
      },
    }));

    hub?.attach(socket);
  });

  return {
    httpServer,
    webSocketServer,
    activity,
    roster,
    guidedNotes,
    buzzerResults,
    scoring,
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
      activityTimer.stop();
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
