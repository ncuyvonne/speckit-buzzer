import { MAX_MESSAGE_BYTES } from '../config.js';
import type { ActivityStage } from '../domain/activity-state.js';

export type ErrorCode = 'INVALID_MESSAGE' | 'AUTH_INVALID' | 'AUTH_REQUIRED' | 'GROUP_INVALID' | 'STAGE_CONFLICT';

export type ClientMessage =
  | { type: 'teacher.authenticate'; requestId: string; payload: { password: string } }
  | { type: 'student.join'; requestId: string; payload: { groupId: string } }
  | { type: 'activity.advance'; requestId: string; payload: { from: ActivityStage; to: ActivityStage } };

export type DecodeResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: 'INVALID_MESSAGE'; requestId?: string };

const VALID_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VALID_STAGES = new Set<ActivityStage>(['PREPARING', 'BUZZING', 'ENDED']);

const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  INVALID_MESSAGE: '訊息格式不正確，請重新操作。',
  AUTH_INVALID: '老師密碼無效或尚未設定，請檢查輸入與本機設定。',
  AUTH_REQUIRED: '請先以老師密碼登入，再執行此操作。',
  GROUP_INVALID: '此組別目前無效，請重新選擇有效組別。',
  STAGE_CONFLICT: '活動階段已變更或操作順序無效，請依目前階段重新操作。',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rawBytes(data: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && VALID_REQUEST_ID.test(value);
}

export function errorMessage(code: ErrorCode): string {
  return ERROR_MESSAGES[code];
}

export function encodeError(code: ErrorCode, requestId?: string): string {
  const message: { type: 'error'; requestId?: string; payload: { code: ErrorCode; message: string } } = {
    type: 'error',
    payload: { code, message: errorMessage(code) },
  };
  if (isValidRequestId(requestId)) message.requestId = requestId;
  return JSON.stringify(message);
}

export function decodeClientMessage(data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean): DecodeResult {
  if (isBinary) return { ok: false, code: 'INVALID_MESSAGE' };
  const bytes = rawBytes(data);
  if (bytes.byteLength > MAX_MESSAGE_BYTES) return { ok: false, code: 'INVALID_MESSAGE' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    return { ok: false, code: 'INVALID_MESSAGE' };
  }

  if (!isRecord(parsed)) return { ok: false, code: 'INVALID_MESSAGE' };
  const requestId = isValidRequestId(parsed.requestId) ? parsed.requestId : undefined;
  if (!requestId || !isRecord(parsed.payload) || typeof parsed.type !== 'string') {
    return { ok: false, code: 'INVALID_MESSAGE', ...(requestId ? { requestId } : {}) };
  }

  const payload = parsed.payload;
  switch (parsed.type) {
    case 'teacher.authenticate':
      if (typeof payload.password !== 'string') break;
      return { ok: true, message: { type: parsed.type, requestId, payload: { password: payload.password } } };
    case 'student.join':
      if (typeof payload.groupId !== 'string') break;
      return { ok: true, message: { type: parsed.type, requestId, payload: { groupId: payload.groupId } } };
    case 'activity.advance':
      if (
        typeof payload.from !== 'string' || !VALID_STAGES.has(payload.from as ActivityStage) ||
        typeof payload.to !== 'string' || !VALID_STAGES.has(payload.to as ActivityStage)
      ) break;
      return {
        ok: true,
        message: {
          type: parsed.type,
          requestId,
          payload: { from: payload.from as ActivityStage, to: payload.to as ActivityStage },
        },
      };
  }

  return { ok: false, code: 'INVALID_MESSAGE', requestId };
}
