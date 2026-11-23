export type ActivityStage = 'PREPARING' | 'BUZZING' | 'ENDED';
export type QuestionKind = 'SINGLE' | 'GROUP';

export interface QuestionLayoutSummary {
  readonly questionId: string;
  readonly kind: QuestionKind;
  readonly answerCount: number;
}

export interface FairRankingSettings {
  readonly enabled: boolean;
  readonly delaySeconds: number | null;
}

export interface SubAnswer {
  readonly placeholderNumber: number;
  readonly answerText: string;
}

export type SubmitAnswerPayload =
  | { readonly questionId: string; readonly answerText: string; readonly subAnswers?: never }
  | { readonly questionId: string; readonly subAnswers: readonly SubAnswer[]; readonly answerText?: never };

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

export type GuidedNotesErrorCode = Extract<ErrorCode,
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
  | 'SHEET_WRITE_FAILED'
  | 'SHEET_WRITE_UNCONFIRMED'
>;

const GUIDED_NOTES_RECOVERY_MESSAGES: Readonly<Record<GuidedNotesErrorCode, string>> = {
  GUIDED_NOTES_BUSY: '另一項學習單操作仍在進行，請稍後再試。',
  SHEETS_NOT_CONFIGURED: 'Google Sheets 尚未完成本機設定，請檢查環境變數。',
  SHEET_REFERENCE_INVALID: '請提供有效的 Google 試算表網址與工作表分頁名稱。',
  SHEET_ACCESS_DENIED: '無法存取試算表，請確認已分享給系統服務帳戶並具有編輯權限。',
  SHEET_NOT_FOUND: '找不到指定的試算表或工作表分頁，請檢查網址與分頁名稱。',
  SHEET_LAYOUT_INVALID: '找不到唯一的「題號」與「作答」標題列，請檢查欄位標題。',
  QUESTION_IDS_INVALID: '題號無效，請檢查空白、重複題號及 100 題上限。',
  WORKSHEET_ALREADY_EXPORTED: '此工作表已由題組匯出；請選擇原始或未匯出的學習單再匯入。',
  SHEET_READ_FAILED: '目前無法讀取試算表，請檢查網路或存取權限後再試。',
  WORKSHEET_NOT_IMPORTED: '目前活動尚未匯入學習單；請先在準備階段匯入，再於活動結束後寫回。',
  WINNING_RESULTS_UNAVAILABLE: '搶答結果尚未就緒，請稍後再試；目前不會寫入學習單。',
  QUESTION_TARGET_INVALID: '工作表中的活動題號無法唯一對應，請修正題號後再試。',
  SHEET_WRITE_FAILED: '寫回未完成，資料未變更；請檢查編輯權限或受保護儲存格後再試。',
  SHEET_WRITE_UNCONFIRMED: '寫回結果未確認；批次可能已套用或仍會完成。請先檢查試算表，再決定是否重試。',
};

export function guidedNotesRecoveryMessage(code: GuidedNotesErrorCode, serverMessage: string): string {
  return serverMessage.trim().length > 0 ? serverMessage : GUIDED_NOTES_RECOVERY_MESSAGES[code];
}

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
      payload: { questionId: string; judgement: CorrectnessJudgement | null };
    }
  | { type: 'buzzerResults.getScoreboard'; requestId: string; payload: Record<string, never> }
  | {
      type: 'guidedNotes.import';
      requestId: string;
      payload: { spreadsheetUrl: string; worksheetTitle: string };
    }
  | { type: 'guidedNotes.export'; requestId: string; payload: Record<string, never> };

export type ServerMessage =
  | {
      type: 'activity.snapshot';
      payload: { stage: ActivityStage; groups: string[]; timeLimitSeconds: number; remainingSeconds: number | null };
    }
  | { type: 'buzzerResults.teacherProgress'; requestId?: string; payload: TeacherProgress }
  | { type: 'buzzerResults.studentResults'; requestId: string; payload: StudentResults }
  | { type: 'buzzerResults.fairRankingConfigured'; requestId: string; payload: FairRankingSettings }
  | { type: 'buzzerResults.csvReady'; requestId: string; payload: { fileName: string; csvText: string } }
  | { type: 'buzzerResults.questionList'; payload: { questionIds: string[]; questionLayouts?: QuestionLayoutSummary[] } }
  | {
      type: 'buzzerResults.ownProgress';
      payload: {
        questions: Array<{
          questionId: string;
          submitted: boolean;
          answerText: string | null;
          answers?: SubAnswer[] | null;
          locked: boolean;
        }>;
        submittedCount: number;
        totalQuestionCount: number;
      };
    }
  | { type: 'teacher.authenticated'; requestId: string; payload: { ok: true } }
  | { type: 'student.joined'; requestId: string; payload: { ok: true; groupId: string } }
  | {
      type: 'buzzerResults.submitted';
      requestId: string;
      payload: { questionId: string; accepted: true; locked: true };
    }
  | {
      type: 'activity.phaseChanged';
      payload: { stage: ActivityStage; timeLimitSeconds: number; remainingSeconds: number | null };
    }
  | { type: 'activity.countdown'; payload: { remainingSeconds: number } }
  | { type: 'activity.timeLimitSet'; requestId: string; payload: { seconds: number } }
  | { type: 'activity.resetCompleted'; payload: { stage: 'PREPARING'; timeLimitSeconds: 0 } }
  | {
      type: 'buzzerResults.correctnessMarked';
      requestId: string;
      payload: { questionId: string; judgement: CorrectnessJudgement | null };
    }
  | { type: 'buzzerResults.scoreboard'; requestId?: string; payload: { entries: readonly ScoreboardEntry[] } }
  | {
      type: 'guidedNotes.snapshot';
      payload: {
        worksheetTitle: string | null;
        questionIds: string[];
        questionCount: number;
        questionLayouts?: QuestionLayoutSummary[];
      };
    }
  | {
      type: 'guidedNotes.imported';
      requestId: string;
      payload: {
        worksheetTitle: string;
        questionIds: string[];
        questionCount: number;
        questionLayouts?: QuestionLayoutSummary[];
      };
    }
  | {
      type: 'guidedNotes.exported';
      requestId: string;
      payload: { writtenCellCount: number; clearedCellCount: number };
    }
  | { type: 'error'; requestId?: string; payload: { code: ErrorCode; message: string } };

export interface TeacherProgress {
  readonly questions: readonly {
    readonly questionId: string;
    readonly groups: readonly {
      readonly groupId: string;
      readonly submitted: boolean;
      readonly rank: number | null;
      readonly answerText: string | null;
      readonly answers?: readonly SubAnswer[] | null;
    }[];
    readonly winningGroupId: string | null;
    readonly winningAnswer: string | null;
    readonly winningAnswers?: readonly SubAnswer[] | null;
    readonly judgement?: CorrectnessJudgement | null;
  }[];
}

export type CorrectnessJudgement = 'CORRECT' | 'INCORRECT';
export interface ScoreboardEntry {
  readonly rank: number;
  readonly groupId: string;
  readonly score: number;
  readonly successfulQuestionCount: number;
}

export interface StudentQuestionResult {
  readonly questionId: string;
  readonly winningGroupId: string | null;
  readonly winningAnswer: string | null;
  readonly winningAnswers?: readonly SubAnswer[] | null;
  readonly ownAnswer: string | null;
  readonly ownAnswers?: readonly SubAnswer[] | null;
  readonly ownStatus: 'SUBMITTED' | 'NOT_SUBMITTED';
  readonly ownGroupWon: boolean;
  readonly groups: readonly {
    readonly groupId: string;
    readonly submitted: boolean;
    readonly rank: number | null;
  }[];
}

export interface StudentResults {
  readonly questions: readonly StudentQuestionResult[];
}
