import { WebSocket } from 'ws';
import type { AppConfig } from '../config.js';
import { ActivityState } from '../domain/activity-state.js';
import { ActivityTimer } from '../domain/activity-timer.js';
import { BuzzerResultsQueryError, BuzzerResultsService } from '../domain/buzzer-results.js';
import { formatBuzzerResultsLocalTimestamp, serializeBuzzerResultsCsv } from '../domain/buzzer-results-csv.js';
import { ScoringService } from '../domain/scoring.js';
import { GroupRoster } from '../domain/group-roster.js';
import { GuidedNotesService, GuidedNotesServiceError } from '../guided-notes/service.js';
import type { Question, QuestionLayoutSummary } from '../guided-notes/types.js';
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
  readonly activityTimer: ActivityTimer;
  readonly roster: GroupRoster;
  readonly guidedNotes: GuidedNotesService;
  readonly buzzerResults: BuzzerResultsService;
  readonly scoring: ScoringService;
}

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function questionLayoutSummary(question: Question): QuestionLayoutSummary {
  return {
    questionId: question.questionId,
    kind: question.kind ?? 'SINGLE',
    answerCount: question.kind === 'GROUP' ? question.answerSlots.length : 1,
  };
}

export class RealtimeHub {
  readonly #config: AppConfig;
  readonly #activity: ActivityState;
  readonly #activityTimer: ActivityTimer;
  readonly #roster: GroupRoster;
  readonly #guidedNotes: GuidedNotesService;
  readonly #buzzerResults: BuzzerResultsService;
  readonly #scoring: ScoringService;
  readonly #connections = new Set<ConnectionContext>();

  constructor(options: RealtimeHandlerOptions) {
    this.#config = options.config;
    this.#activity = options.activity;
    this.#activityTimer = options.activityTimer;
    this.#roster = options.roster;
    this.#guidedNotes = options.guidedNotes;
    this.#buzzerResults = options.buzzerResults;
    this.#scoring = options.scoring;
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
        this.#sendFairRankingSettings(context, message.requestId);
        this.#sendTeacherProgress(context);
        if (this.#activity.stage === 'ENDED') this.#sendScoreboard(context);
        return;
      }
      case 'activity.advance': {
        if (context.role !== 'TEACHER') {
          this.#sendError(context, 'AUTH_REQUIRED', message.requestId);
          return;
        }
        if (message.payload.to === 'BUZZING' && !this.#activity.fairRankingConfigurationValid) {
          this.#sendError(context, 'FAIR_RANKING_INVALID', message.requestId);
          return;
        }
        const result = this.#activity.advance(message.payload.from, message.payload.to);
        if (!result.accepted) {
          this.#sendError(context, 'STAGE_CONFLICT', message.requestId);
          return;
        }
        if (result.stage === 'BUZZING') this.#activityTimer.start();
        else if (result.stage === 'ENDED') this.#activityTimer.stop();
        this.broadcastPhaseChanged();
        if (result.stage === 'BUZZING') this.#broadcastOwnProgressToStudents();
        return;
      }
      case 'activity.setTimeLimit': {
        if (context.role !== 'TEACHER') {
          this.#sendError(context, 'AUTH_REQUIRED', message.requestId);
          return;
        }
        try {
          if (!this.#activity.setTimeLimitSeconds(message.payload.seconds)) {
            this.#sendError(context, 'STAGE_CONFLICT', message.requestId);
            return;
          }
        } catch {
          this.#sendError(context, 'TIME_LIMIT_INVALID', message.requestId);
          return;
        }
        send(context.socket, {
          type: 'activity.timeLimitSet',
          requestId: message.requestId,
          payload: { seconds: message.payload.seconds },
        });
        return;
      }
      case 'activity.reset': {
        if (context.role !== 'TEACHER') {
          this.#sendError(context, 'AUTH_REQUIRED', message.requestId);
          return;
        }
        if (!this.#activity.reset()) {
          this.#sendError(context, 'STAGE_CONFLICT', message.requestId);
          return;
        }
        this.#activityTimer.stop();
        this.#buzzerResults.clearSession();
        this.#scoring.clear();
        this.#broadcast({ type: 'activity.resetCompleted', payload: { stage: 'PREPARING', timeLimitSeconds: 0 } });
        this.#broadcastPhase();
        this.#broadcastTeacherProgress();
        return;
      }
      case 'buzzerResults.markCorrectness': {
        if (context.role !== 'TEACHER') {
          this.#sendError(context, 'AUTH_REQUIRED', message.requestId);
          return;
        }
        const result = this.#scoring.markCorrectness(message.payload.questionId, message.payload.judgement);
        if (!result.accepted) {
          this.#sendError(context, result.code, message.requestId);
          return;
        }
        send(context.socket, {
          type: 'buzzerResults.correctnessMarked',
          requestId: message.requestId,
          payload: { questionId: result.questionId, judgement: result.judgement },
        });
        this.#broadcastTeacherProgress();
        this.#broadcastScoreboard();
        return;
      }
      case 'buzzerResults.getScoreboard': {
        if (context.role !== 'TEACHER' && context.role !== 'STUDENT') {
          this.#sendError(context, 'AUTH_REQUIRED', message.requestId);
          return;
        }
        if (this.#activity.stage !== 'ENDED') {
          this.#sendError(context, 'STAGE_CONFLICT', message.requestId);
          return;
        }
        this.#sendScoreboard(context, message.requestId);
        return;
      }
      case 'buzzerResults.setFairRanking': {
        if (context.role !== 'TEACHER') {
          this.#sendError(context, 'AUTH_REQUIRED', message.requestId);
          return;
        }
        const result = this.#buzzerResults.setFairRankingSettings(message.payload);
        if (!result.accepted) {
          this.#sendError(context, result.code, message.requestId);
          return;
        }
        send(context.socket, {
          type: 'buzzerResults.fairRankingConfigured',
          requestId: message.requestId,
          payload: result.settings,
        });
        return;
      }
      case 'student.join': {
        if (context.role === 'TEACHER') {
          this.#sendError(context, 'INVALID_MESSAGE', message.requestId);
          return;
        }
        if (context.role === 'STUDENT' && context.groupId !== message.payload.groupId) {
          this.#sendError(
            context,
            'GROUP_INVALID',
            message.requestId,
            '已加入的組別不能變更，請重新連線以恢復原組別。',
          );
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
          typeof message.payload.answerText === 'string'
            ? message.payload.answerText
            : message.payload.subAnswers ?? [],
        );
        if (!result.accepted) {
          this.#sendError(context, result.code, message.requestId, result.message);
          return;
        }
        send(context.socket, {
          type: 'buzzerResults.submitted',
          requestId: message.requestId,
          payload: { questionId: message.payload.questionId, accepted: true, locked: true },
        });
        this.#broadcastOwnProgress(context.groupId);
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
      case 'buzzerResults.exportCsv': {
        if (context.role !== 'TEACHER') {
          this.#sendError(context, 'AUTH_REQUIRED', message.requestId);
          return;
        }
        if (this.#activity.stage !== 'ENDED') {
          this.#sendError(context, 'STAGE_CONFLICT', message.requestId);
          return;
        }
        const csvQuestions = this.#buzzerResults.getCsvExportData();
        if (this.#activity.questionCount === 0 || csvQuestions.length === 0) {
          this.#sendError(context, 'RESULTS_NOT_READY', message.requestId);
          return;
        }
        const fileTimestamp = formatBuzzerResultsLocalTimestamp(Date.now()).replace(' ', 'T').replaceAll(':', '-').replace('.', '-');
        const fileName = `buzzer-results-${fileTimestamp}.csv`;
        send(context.socket, {
          type: 'buzzerResults.csvReady',
          requestId: message.requestId,
          payload: { fileName, csvText: serializeBuzzerResultsCsv(csvQuestions) },
        });
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
          this.#broadcastTeacherProgress();
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
      payload: this.#activityPayload({ groups: this.#roster.ids }),
    });
    if (context.role === 'TEACHER') {
      send(context.socket, {
        type: 'guidedNotes.snapshot',
        payload: {
          worksheetTitle: this.#activity.worksheet?.worksheetTitle ?? null,
          questionIds: this.#activity.questions.map((question) => question.questionId),
          questionCount: this.#activity.questionCount,
          questionLayouts: this.#activity.questions.map(questionLayoutSummary),
        },
      });
    }
  }

  broadcastCountdown(remainingSeconds: number): void {
    this.#broadcast({ type: 'activity.countdown', payload: { remainingSeconds } });
  }

  broadcastPhaseChanged(): void {
    this.#broadcast({ type: 'activity.phaseChanged', payload: this.#activityPayload() });
  }

  #broadcastPhase(): void {
    this.broadcastPhaseChanged();
  }

  #activityPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      stage: this.#activity.stage,
      timeLimitSeconds: this.#activity.timeLimitSeconds,
      remainingSeconds: this.#activity.getRemainingSeconds(),
      ...extra,
    };
  }

  #broadcast(message: unknown): void {
    const broadcast = JSON.stringify(message);
    for (const connection of this.#connections) {
      if (connection.socket.readyState === WebSocket.OPEN) connection.socket.send(broadcast);
    }
  }

  #sendStudentQuestionList(context: ConnectionContext): void {
    if (context.role !== 'STUDENT') return;
    send(context.socket, {
      type: 'buzzerResults.questionList',
      payload: {
        questionIds: this.#activity.questions.map((question) => question.questionId),
        questionLayouts: this.#activity.questions.map(questionLayoutSummary),
      },
    });
  }

  #sendOwnProgress(context: ConnectionContext): void {
    if (context.role !== 'STUDENT' || context.groupId === null || this.#activity.stage !== 'BUZZING') return;
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
    const progress = this.#buzzerResults.getTeacherProgress();
    send(context.socket, {
      type: 'buzzerResults.teacherProgress',
      ...(requestId ? { requestId } : {}),
      payload: {
        questions: progress.questions.map((question) => ({
          ...question,
          judgement: this.#scoring.getJudgement(question.questionId),
        })),
      },
    });
  }

  #sendScoreboard(context: ConnectionContext, requestId?: string): void {
    if (context.role !== 'TEACHER' && context.role !== 'STUDENT') return;
    send(context.socket, {
      type: 'buzzerResults.scoreboard',
      ...(requestId ? { requestId } : {}),
      payload: { entries: this.#scoring.getScoreboard() },
    });
  }

  #sendFairRankingSettings(context: ConnectionContext, requestId: string): void {
    if (context.role !== 'TEACHER') return;
    send(context.socket, {
      type: 'buzzerResults.fairRankingConfigured',
      requestId,
      payload: this.#buzzerResults.getFairRankingSettings(),
    });
  }

  #broadcastTeacherProgress(): void {
    for (const connection of this.#connections) {
      if (connection.role === 'TEACHER') this.#sendTeacherProgress(connection);
    }
  }

  #broadcastScoreboard(): void {
    if (this.#activity.stage !== 'ENDED') return;
    for (const connection of this.#connections) {
      if (connection.role === 'TEACHER' || connection.role === 'STUDENT') this.#sendScoreboard(connection);
    }
  }

  #broadcastOwnProgressToStudents(): void {
    for (const connection of this.#connections) {
      if (connection.role === 'STUDENT') this.#sendOwnProgress(connection);
    }
  }

  #broadcastOwnProgress(groupId: string): void {
    if (this.#activity.stage !== 'BUZZING') return;
    for (const connection of this.#connections) {
      if (connection.role === 'STUDENT' && connection.groupId === groupId) this.#sendOwnProgress(connection);
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
