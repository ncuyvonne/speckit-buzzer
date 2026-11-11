import { WebSocket } from 'ws';
import type { AppConfig } from '../config.js';
import { ActivityState } from '../domain/activity-state.js';
import { GroupRoster } from '../domain/group-roster.js';
import { isTeacherPasswordValid } from '../domain/teacher-auth.js';
import { decodeClientMessage, encodeError, type ClientMessage, type ErrorCode } from './protocol.js';

export type ConnectionRole = 'TEACHER' | 'STUDENT' | 'UNAUTHENTICATED';

interface ConnectionContext {
  readonly socket: WebSocket;
  role: ConnectionRole;
  groupId: string | null;
}

export interface RealtimeHandlerOptions {
  readonly config: AppConfig;
  readonly activity: ActivityState;
  readonly roster: GroupRoster;
}

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

export class RealtimeHub {
  readonly #config: AppConfig;
  readonly #activity: ActivityState;
  readonly #roster: GroupRoster;
  readonly #connections = new Set<ConnectionContext>();

  constructor(options: RealtimeHandlerOptions) {
    this.#config = options.config;
    this.#activity = options.activity;
    this.#roster = options.roster;
  }

  attach(socket: WebSocket): () => void {
    const context: ConnectionContext = { socket, role: 'UNAUTHENTICATED', groupId: null };
    this.#connections.add(context);

    const onMessage = (data: Buffer, isBinary: boolean) => {
      const decoded = decodeClientMessage(data, isBinary);
      if (!decoded.ok) {
        this.#sendError(context, decoded.code, decoded.requestId);
        return;
      }
      this.#handle(context, decoded.message);
    };
    const detach = () => {
      socket.off('message', onMessage);
      socket.off('close', detach);
      context.role = 'UNAUTHENTICATED';
      context.groupId = null;
      this.#connections.delete(context);
    };

    socket.on('message', onMessage);
    socket.once('close', detach);
    return detach;
  }

  #handle(context: ConnectionContext, message: ClientMessage): void {
    switch (message.type) {
      case 'teacher.authenticate': {
        if (context.role !== 'UNAUTHENTICATED') {
          this.#sendError(context, 'INVALID_MESSAGE', message.requestId);
          return;
        }
        if (!isTeacherPasswordValid(this.#config, message.payload.password)) {
          this.#sendError(context, 'AUTH_INVALID', message.requestId);
          return;
        }

        context.role = 'TEACHER';
        send(context.socket, {
          type: 'teacher.authenticated',
          requestId: message.requestId,
          payload: { ok: true },
        });
        this.#sendSnapshot(context.socket);
        return;
      }
      case 'activity.advance': {
        if (context.role !== 'TEACHER') {
          this.#sendError(context, 'AUTH_REQUIRED', message.requestId);
          return;
        }
        const result = this.#activity.advance(message.payload.from, message.payload.to);
        if (!result.accepted) {
          this.#sendError(context, 'STAGE_CONFLICT', message.requestId);
          return;
        }
        const broadcast = JSON.stringify({ type: 'activity.phaseChanged', payload: { stage: result.stage } });
        for (const connection of this.#connections) {
          if (connection.socket.readyState === WebSocket.OPEN) connection.socket.send(broadcast);
        }
        return;
      }
      case 'student.join': {
        if (context.role === 'TEACHER') {
          this.#sendError(context, 'INVALID_MESSAGE', message.requestId);
          return;
        }
        if (!this.#roster.has(message.payload.groupId)) {
          this.#sendError(context, 'GROUP_INVALID', message.requestId);
          return;
        }

        context.role = 'STUDENT';
        context.groupId = message.payload.groupId;
        send(context.socket, {
          type: 'student.joined',
          requestId: message.requestId,
          payload: { ok: true, groupId: context.groupId },
        });
        this.#sendSnapshot(context.socket);
        return;
      }
    }
  }

  #sendSnapshot(socket: WebSocket): void {
    send(socket, {
      type: 'activity.snapshot',
      payload: { stage: this.#activity.stage, groups: this.#roster.ids },
    });
  }

  #sendError(context: ConnectionContext, code: ErrorCode, requestId?: string): void {
    if (context.socket.readyState === WebSocket.OPEN) {
      context.socket.send(encodeError(code, requestId));
    }
  }
}
