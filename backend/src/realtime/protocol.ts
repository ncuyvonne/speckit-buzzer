import { MAX_MESSAGE_BYTES } from '../config.js';
import type { ActivityStage, FairRankingSettings } from '../domain/activity-state.js';
import type { StudentResults, TeacherProgress } from '../domain/buzzer-results.js';
import type { SubmitAnswerPayload } from '../guided-notes/types.js';

export type ErrorCode =
  | 'INVALID_MESSAGE'
  | 'AUTH_INVALID'
  | 'AUTH_REQUIRED'
  | 'GROUP_INVALID'
  | 'STAGE_CONFLICT'
  | 'GUIDED_NOTES_BUSY'
  | 'SHEETS_NOT_CONFIGURED'
  | 'SHEET_REFERENCE_INVALID'
  | 'SHEET_ACCESS_DENIED'
  | 'SHEET_NOT_FOUND'
  | 'SHEET_LAYOUT_INVALID'
  | 'QUESTION_IDS_INVALID'
  | 'WORKSHEET_ALREADY_EXPORTED'
  | 'SHEET_READ_FAILED'
  | 'WORKSHEET_NOT_IMPORTED'
  | 'WINNING_RESULTS_UNAVAILABLE'
  | 'QUESTION_TARGET_INVALID'
  | 'QUESTION_INVALID'
  | 'ANSWER_EMPTY'
  | 'ANSWER_LOCKED'
  | 'GROUP_ANSWER_INCOMPLETE'
  | 'GROUP_ANSWER_INVALID'
  | 'FAIR_RANKING_INVALID'
  | 'RESULTS_NOT_READY'
  | 'ANSWER_TIMED_OUT'
  | 'TIME_LIMIT_INVALID'
  | 'WINNER_NOT_FOUND'
  | 'SHEET_WRITE_FAILED'
  | 'SHEET_WRITE_UNCONFIRMED';

export type ClientMessage =
  | { type: 'teacher.authenticate'; requestId: string; payload: { password: string } }
  | { type: 'student.join'; requestId: string; payload: { groupId: string } }
  | { type: 'buzzerResults.submitAnswer'; requestId: string; payload: SubmitAnswerPayload }
  | { type: 'buzzerResults.getTeacherProgress'; requestId: string; payload: Record<string, never> }
  | { type: 'buzzerResults.getStudentResults'; requestId: string; payload: Record<string, never> }
  | { type: 'buzzerResults.setFairRanking'; requestId: string; payload: FairRankingSettings }
  | { type: 'buzzerResults.exportCsv'; requestId: string; payload: Record<string, never> }
  | { type: 'activity.advance'; requestId: string; payload: { from: ActivityStage; to: ActivityStage } }
  | { type: 'activity.setTimeLimit'; requestId: string; payload: { seconds: number } }
  | { type: 'activity.reset'; requestId: string; payload: Record<string, never> }
  | {
      type: 'buzzerResults.markCorrectness';
      requestId: string;
      payload: { questionId: string; judgement: 'CORRECT' | 'INCORRECT' | null };
    }
  | { type: 'buzzerResults.getScoreboard'; requestId: string; payload: Record<string, never> }
  | {
      type: 'guidedNotes.import';
      requestId: string;
      payload: { spreadsheetUrl: string; worksheetTitle: string };
    }
  | { type: 'guidedNotes.export'; requestId: string; payload: Record<string, never> };

export type DecodeResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: 'INVALID_MESSAGE' | 'TIME_LIMIT_INVALID'; requestId?: string };

const VALID_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VALID_STAGES = new Set<ActivityStage>(['PREPARING', 'BUZZING', 'ENDED']);

const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  INVALID_MESSAGE: '訊息格式不正確，請重新操作。',
  AUTH_INVALID: '老師密碼無效或尚未設定，請檢查輸入與本機設定。',
  AUTH_REQUIRED: '請先以老師密碼登入，再執行此操作。',
  GROUP_INVALID: '此組別目前無效，請重新選擇有效組別。',
  STAGE_CONFLICT: '活動階段已變更或操作順序無效，請依目前階段重新操作。',
  GUIDED_NOTES_BUSY: '另一項學習單操作仍在進行，請稍後再試。',
  SHEETS_NOT_CONFIGURED: 'Google Sheets 尚未完成本機設定，請檢查環境變數。',
  SHEET_REFERENCE_INVALID: '請提供有效的 Google 試算表網址與工作表分頁名稱。',
  SHEET_ACCESS_DENIED: '無法讀取此試算表，請確認已分享給系統服務帳戶。',
  SHEET_NOT_FOUND: '找不到指定的試算表或工作表分頁，請檢查網址與分頁名稱。',
  SHEET_LAYOUT_INVALID: '找不到唯一的「題號」與「作答」標題列，請檢查欄位標題。',
  QUESTION_IDS_INVALID: '題號無效，請檢查空白、重複題號及 100 題上限。',
  WORKSHEET_ALREADY_EXPORTED: '此工作表已由題組匯出；請選擇原始或未匯出的學習單再匯入。',
  SHEET_READ_FAILED: '目前無法讀取試算表，請檢查網路或存取權限後再試。',
  WORKSHEET_NOT_IMPORTED: '目前活動尚未匯入學習單，請先在準備階段匯入。',
  WINNING_RESULTS_UNAVAILABLE: '搶答結果尚未就緒，請稍後再試；目前不會寫入學習單。',
  QUESTION_TARGET_INVALID: '工作表中的活動題號無法唯一對應，請修正後再試。',
  QUESTION_INVALID: '此題目不屬於目前活動，請重新選擇題目。',
  ANSWER_EMPTY: '答案不可空白，請輸入答案後再送出。',
  ANSWER_LOCKED: '本組此題答案已送出並鎖定，無法再次修改。',
  GROUP_ANSWER_INCOMPLETE: '題組尚未填完；請補齊所有子題答案後再送出。',
  GROUP_ANSWER_INVALID: '題組答案編號與題目不符；請檢查各子題後再送出。',
  FAIR_RANKING_INVALID: '公平順位延遲必須介於 1 到 30 秒（含端點），請修正設定後再試。',
  RESULTS_NOT_READY: '活動結果尚未就緒，請稍後再試；目前不會產生 CSV。',
  ANSWER_TIMED_OUT: '作答期限已到，答案未送出。',
  TIME_LIMIT_INVALID: '搶答時限須為 0 至 3600 的整數秒，請修正後再試。',
  WINNER_NOT_FOUND: '這一題尚無成功組別，無法標記正誤。',
  SHEET_WRITE_FAILED: '試算表拒絕寫入，資料未變更；請檢查編輯權限或受保護儲存格。',
  SHEET_WRITE_UNCONFIRMED: '寫回結果未確認；批次可能已套用或仍會完成。請先檢查試算表，再決定是否重試。',
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

export function encodeError(code: ErrorCode, requestId?: string, customMessage = errorMessage(code)): string {
  const encoded: { type: 'error'; requestId?: string; payload: { code: ErrorCode; message: string } } = {
    type: 'error',
    payload: { code, message: customMessage },
  };
  if (isValidRequestId(requestId)) encoded.requestId = requestId;
  return JSON.stringify(encoded);
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
    case 'buzzerResults.submitAnswer':
      if (typeof payload.questionId !== 'string') break;
      if (typeof payload.answerText === 'string'
        && Object.keys(payload).every((key) => key === 'questionId' || key === 'answerText')) {
        return {
          ok: true,
          message: {
            type: parsed.type,
            requestId,
            payload: { questionId: payload.questionId, answerText: payload.answerText },
          },
        };
      }
      if (Array.isArray(payload.subAnswers)
        && Object.keys(payload).every((key) => key === 'questionId' || key === 'subAnswers')
        && payload.subAnswers.every((answer) => isRecord(answer)
          && Number.isSafeInteger(answer.placeholderNumber)
          && typeof answer.answerText === 'string'
          && Object.keys(answer).every((key) => key === 'placeholderNumber' || key === 'answerText'))) {
        return {
          ok: true,
          message: {
            type: parsed.type,
            requestId,
            payload: {
              questionId: payload.questionId,
              subAnswers: payload.subAnswers.map((answer) => ({
                placeholderNumber: answer.placeholderNumber as number,
                answerText: answer.answerText as string,
              })),
            },
          },
        };
      }
      break;
    case 'buzzerResults.getTeacherProgress':
    case 'buzzerResults.getStudentResults':
    case 'buzzerResults.exportCsv':
      if (Object.keys(payload).length !== 0) break;
      return { ok: true, message: { type: parsed.type, requestId, payload: {} } };
    case 'buzzerResults.setFairRanking':
      if (typeof payload.enabled !== 'boolean'
        || !(payload.delaySeconds === null
          || (typeof payload.delaySeconds === 'number' && Number.isFinite(payload.delaySeconds)))
        || Object.keys(payload).some((key) => key !== 'enabled' && key !== 'delaySeconds')) break;
      return {
        ok: true,
        message: {
          type: parsed.type,
          requestId,
          payload: { enabled: payload.enabled, delaySeconds: payload.delaySeconds as number | null },
        },
      };
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
    case 'activity.setTimeLimit':
      if (typeof payload.seconds !== 'number' || !Number.isFinite(payload.seconds)) break;
      if (!Number.isInteger(payload.seconds) || payload.seconds < 0 || payload.seconds > 3_600) {
        return { ok: false, code: 'TIME_LIMIT_INVALID', requestId };
      }
      if (Object.keys(payload).some((key) => key !== 'seconds')) break;
      return {
        ok: true,
        message: { type: parsed.type, requestId, payload: { seconds: payload.seconds } },
      };
    case 'activity.reset':
    case 'buzzerResults.getScoreboard':
      if (Object.keys(payload).length !== 0) break;
      return { ok: true, message: { type: parsed.type, requestId, payload: {} } };
    case 'buzzerResults.markCorrectness':
      if (
        typeof payload.questionId !== 'string'
        || !(payload.judgement === 'CORRECT' || payload.judgement === 'INCORRECT' || payload.judgement === null)
        || Object.keys(payload).some((key) => key !== 'questionId' && key !== 'judgement')
      ) break;
      return {
        ok: true,
        message: {
          type: parsed.type,
          requestId,
          payload: { questionId: payload.questionId, judgement: payload.judgement },
        },
      };
    case 'guidedNotes.import':
      if (
        typeof payload.spreadsheetUrl !== 'string'
        || payload.spreadsheetUrl.length > 8_192
        || typeof payload.worksheetTitle !== 'string'
        || payload.worksheetTitle.length > 256
      ) break;
      return {
        ok: true,
        message: {
          type: parsed.type,
          requestId,
          payload: {
            spreadsheetUrl: payload.spreadsheetUrl,
            worksheetTitle: payload.worksheetTitle,
          },
        },
      };
    case 'guidedNotes.export':
      if (Object.keys(payload).length !== 0) break;
      return {
        ok: true,
        message: { type: parsed.type, requestId, payload: {} },
      };
  }

  return { ok: false, code: 'INVALID_MESSAGE', requestId };
}

export type ServerMessage =
  | { readonly type: 'buzzerResults.fairRankingConfigured'; readonly requestId: string; readonly payload: FairRankingSettings }
  | { readonly type: 'buzzerResults.teacherProgress'; readonly requestId?: string; readonly payload: TeacherProgress }
  | { readonly type: 'buzzerResults.studentResults'; readonly requestId: string; readonly payload: StudentResults }
  | { readonly type: 'buzzerResults.csvReady'; readonly requestId: string; readonly payload: { readonly fileName: string; readonly csvText: string } }
  | { readonly type: 'error'; readonly requestId?: string; readonly payload: { readonly code: ErrorCode; readonly message: string } };
