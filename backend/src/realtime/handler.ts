import { WebSocket } from 'ws';
import type { AppConfig } from '../config.js';
import { ActivityState } from '../domain/activity-state.js';
import { BuzzerResultsQueryError, BuzzerResultsService } from '../domain/buzzer-results.js';
import { GroupRoster } from '../domain/group-roster.js';
import { GuidedNotesService, GuidedNotesServiceError } from '../guided-notes/service.js';
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
  readonly guidedNotes: GuidedNotesService;
  readonly buzzerResults: BuzzerResultsService;
}

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

export class RealtimeHub {
  readonly #config: AppConfig;
  readonly #activity: ActivityState;
  readonly #roster: GroupRoster;
  readonly #guidedNotes: GuidedNotesService;
  readonly #buzzerResults: BuzzerResultsService;
  readonly #connections = new Set<ConnectionContext>();

  constructor(options: RealtimeHandlerOptions) {
    this.#config = options.config;
    this.#activity = options.activity;
    this.#roster = options.roster;
    this.#guidedNotes = options.guidedNotes;
    this.#buzzerResults = options.buzzerResults;
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
      void this.#handle(context, decoded.message);
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

  async #handle(context: ConnectionContext, message: ClientMessage): Promise<void> {
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
        this.#sendSnapshot(context);
        this.#sendTeacherProgress(context);
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
        this.#sendSnapshot(context);
        this.#sendStudentQuestionList(context);
        if (this.#activity.stage === 'BUZZING') this.#sendOwnProgress(context);
        return;
      }
      case 'buzzerResults.submitAnswer': {
        if (context.role !== 'STUDENT') {
          this.#sendError(context, 'AUTH_REQUIRED', message.requestId);
          return;
        }
        if (context.groupId === null || !this.#roster.has(context.groupId)) {
          this.#sendError(context, 'GROUP_INVALID', message.requestId);
          return;
        }

        const result = this.#buzzerResults.submitAnswer(
          context.groupId,
          message.payload.questionId,
          message.payload.answerText,
        );
        if (!result.accepted) {
          this.#sendError(context, result.code, message.requestId);
          return;
        }
        send(context.socket, {
          type: 'buzzerResults.submitted',
          requestId: message.requestId,
          payload: { questionId: message.payload.questionId, accepted: true, locked: true },
        });
        this.#broadcastTeacherProgress();
        return;
      }
      case 'buzzerResults.getTeacherProgress': {
        if (context.role !== 'TEACHER') {
          this.#sendError(context, 'AUTH_REQUIRED', message.requestId);
          return;
        }
        this.#sendTeacherProgress(context, message.requestId);
        return;
      }
      case 'buzzerResults.getStudentResults': {
        if (context.role !== 'STUDENT') {
          this.#sendError(context, 'AUTH_REQUIRED', message.requestId);
          return;
        }
        if (context.groupId === null || !this.#roster.has(context.groupId)) {
          this.#sendError(context, 'GROUP_INVALID', message.requestId);
          return;
        }
        try {
          send(context.socket, {
            type: 'buzzerResults.studentResults',
            requestId: message.requestId,
            payload: this.#buzzerResults.getStudentResults(context.groupId),
          });
        } catch (error) {
          if (error instanceof BuzzerResultsQueryError) this.#sendError(context, error.code, message.requestId);
          else this.#sendError(context, 'INVALID_MESSAGE', message.requestId);
        }
        return;
      }
      case 'guidedNotes.import': {
        if (context.role !== 'TEACHER') {
          this.#sendError(context, 'AUTH_REQUIRED', message.requestId);
          return;
        }
        if (this.#activity.stage !== 'PREPARING') {
          this.#sendError(context, 'STAGE_CONFLICT', message.requestId);
          return;
        }

        try {
          const result = await this.#guidedNotes.importWorksheet(message.payload);
          send(context.socket, {
            type: 'guidedNotes.imported',
            requestId: message.requestId,
            payload: result,
          });
          this.#broadcastStudentQuestionLists();
        } catch (error) {
          if (error instanceof GuidedNotesServiceError) {
            this.#sendError(context, error.code, message.requestId, error.message);
          } else {
            this.#sendError(context, 'SHEET_READ_FAILED', message.requestId);
          }
        }
        return;
      }
      case 'guidedNotes.export': {
        if (context.role !== 'TEACHER') {
          this.#sendError(context, 'AUTH_REQUIRED', message.requestId);
          return;
        }
        if (this.#activity.stage !== 'ENDED') {
          this.#sendError(context, 'STAGE_CONFLICT', message.requestId);
          return;
        }

        try {
          const result = await this.#guidedNotes.exportAnswers();
          send(context.socket, {
            type: 'guidedNotes.exported',
            requestId: message.requestId,
            payload: result,
          });
        } catch (error) {
          if (error instanceof GuidedNotesServiceError) {
            this.#sendError(context, error.code, message.requestId, error.message);
          } else {
            this.#sendError(context, 'SHEET_WRITE_FAILED', message.requestId);
          }
        }
        return;
      }
    }
  }

  #sendSnapshot(context: ConnectionContext): void {
    send(context.socket, {
      type: 'activity.snapshot',
      payload: { stage: this.#activity.stage, groups: this.#roster.ids },
    });
    if (context.role === 'TEACHER') {
      send(context.socket, {
        type: 'guidedNotes.snapshot',
        payload: {
          worksheetTitle: this.#activity.worksheet?.worksheetTitle ?? null,
          questionIds: this.#activity.questions.map((question) => question.questionId),
          questionCount: this.#activity.questionCount,
        },
      });
    }
  }

  #sendStudentQuestionList(context: ConnectionContext): void {
    if (context.role !== 'STUDENT') return;
    send(context.socket, {
      type: 'buzzerResults.questionList',
      payload: { questionIds: this.#activity.questions.map((question) => question.questionId) },
    });
  }

  #sendOwnProgress(context: ConnectionContext): void {
    if (context.role !== 'STUDENT' || context.groupId === null) return;
    try {
      send(context.socket, {
        type: 'buzzerResults.ownProgress',
        payload: this.#buzzerResults.getOwnProgress(context.groupId),
      });
    } catch {
      this.#sendError(context, 'GROUP_INVALID');
    }
  }

  #sendTeacherProgress(context: ConnectionContext, requestId?: string): void {
    if (context.role !== 'TEACHER') return;
    send(context.socket, {
      type: 'buzzerResults.teacherProgress',
      ...(requestId ? { requestId } : {}),
      payload: this.#buzzerResults.getTeacherProgress(),
    });
  }

  #broadcastTeacherProgress(): void {
    for (const connection of this.#connections) {
      if (connection.role === 'TEACHER') this.#sendTeacherProgress(connection);
    }
  }

  #broadcastStudentQuestionLists(): void {
    for (const connection of this.#connections) {
      if (connection.role === 'STUDENT') this.#sendStudentQuestionList(connection);
    }
  }

  #sendError(context: ConnectionContext, code: ErrorCode, requestId?: string, message?: string): void {
    if (context.socket.readyState === WebSocket.OPEN) {
      context.socket.send(encodeError(code, requestId, message));
    }
  }
}
