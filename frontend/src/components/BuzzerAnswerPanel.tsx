import { useState, type FormEvent } from 'react';
import type { ActivityStage, ErrorCode, QuestionLayoutSummary, SubAnswer } from '../realtime/messages';
import type { BuzzerResultsViewState } from '../state/buzzer-results';

export interface BuzzerAnswerPanelProps {
  readonly groupId: string | null;
  readonly stage: ActivityStage | null;
  readonly connected: boolean;
  readonly state: BuzzerResultsViewState;
  readonly questionLayouts: readonly QuestionLayoutSummary[];
  readonly onSubmit: (questionId: string, answer: string | readonly SubAnswer[]) => boolean | void;
  readonly onClearError: () => void;
}

const ERROR_GUIDANCE: Partial<Record<ErrorCode, string>> = {
  AUTH_REQUIRED: '學生連線身分已失效，請重新載入頁面並重新加入組別。',
  GROUP_INVALID: '目前組別無效，請重新載入頁面並選擇有效組別。',
  ANSWER_EMPTY: '請輸入答案後再送出。',
  ANSWER_LOCKED: '本組此題已鎖定，無法再次作答。',
  GROUP_ANSWER_INCOMPLETE: '題組尚未填完，請補齊所有子題答案後再送出。',
  GROUP_ANSWER_INVALID: '題組子題編號與題目不符，請檢查各子題後再送出。',
  QUESTION_INVALID: '找不到這個題目，請重新選擇題號。',
  STAGE_CONFLICT: '目前不是搶答階段，請等待老師開始搶答。',
};

function answersText(answers: readonly SubAnswer[]): string {
  return answers.map((answer) => answer.answerText).join('；');
}

export function BuzzerAnswerPanel({
  groupId,
  stage,
  connected,
  state,
  questionLayouts,
  onSubmit,
  onClearError,
}: BuzzerAnswerPanelProps) {
  const [questionId, setQuestionId] = useState('');
  const [drafts, setDrafts] = useState<Readonly<Record<string, Readonly<Record<number, string>>>>>({});
  const selectedQuestion = questionId && state.questionIds.includes(questionId)
    ? questionId
    : state.questionIds[0] || '';
  const layout = questionLayouts.find((item) => item.questionId === selectedQuestion);
  const answerCount = layout?.kind === 'GROUP' ? layout.answerCount : 1;
  const progress = state.ownProgress.find((item) => item.questionId === selectedQuestion);
  const locked = progress?.locked === true;
  const isBuzzing = stage === 'BUZZING';
  const accepted = state.acceptedSubmission?.questionId === selectedQuestion
    ? state.acceptedSubmission
    : null;

  function draftValue(slot: number): string {
    if (locked && progress) {
      if (layout?.kind === 'GROUP') {
        return progress.answers?.find((answer) => answer.placeholderNumber === slot)?.answerText
          ?? drafts[selectedQuestion]?.[slot]
          ?? '';
      }
      return progress.answerText ?? drafts[selectedQuestion]?.[slot] ?? '';
    }
    return drafts[selectedQuestion]?.[slot] ?? '';
  }

  function changeDraft(slot: number, value: string): void {
    setDrafts((current) => ({
      ...current,
      [selectedQuestion]: { ...current[selectedQuestion], [slot]: value },
    }));
    onClearError();
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!selectedQuestion || locked) return;
    if (layout?.kind === 'GROUP') {
      const subAnswers = Array.from({ length: answerCount }, (_, index) => ({
        placeholderNumber: index + 1,
        answerText: drafts[selectedQuestion]?.[index + 1] ?? '',
      }));
      onSubmit(selectedQuestion, subAnswers);
      return;
    }
    onSubmit(selectedQuestion, drafts[selectedQuestion]?.[1] ?? '');
  }

  return (
    <section aria-labelledby="buzzer-answer-title">
      <h2 id="buzzer-answer-title">學生搶答</h2>
      <p>目前組別：{groupId ?? '尚未加入'}</p>
      {state.questionIds.length === 0 ? (
        <p>目前沒有可作答的題目，請老師先匯入題號。</p>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="buzzer-question">題目</label>
          <select
            id="buzzer-question"
            value={selectedQuestion}
            disabled={state.questionIds.length === 0}
            onChange={(event) => { setQuestionId(event.currentTarget.value); onClearError(); }}
          >
            {state.questionIds.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
          {Array.from({ length: answerCount }, (_, index) => {
            const slot = index + 1;
            const label = layout?.kind === 'GROUP' ? `子題 ${slot} 答案` : '答案';
            const id = layout?.kind === 'GROUP' ? `buzzer-answer-${slot}` : 'buzzer-answer';
            return (
              <div key={id}>
                <label htmlFor={id}>{label}</label>
                <textarea
                  id={id}
                  value={draftValue(slot)}
                  disabled={!connected || !isBuzzing || locked}
                  onChange={(event) => changeDraft(slot, event.currentTarget.value)}
                />
              </div>
            );
          })}
          <button type="submit" disabled={!connected || !isBuzzing || !selectedQuestion || locked}>
            送出答案
          </button>
        </form>
      )}
      {stage !== 'BUZZING' && <p>老師開始搶答後即可作答。</p>}
      {accepted && (
        <p role="status">
          {'subAnswers' in accepted
            ? `答案已接受並鎖定：${answersText(accepted.subAnswers ?? [])}`
            : `答案已接受並鎖定：${accepted.answerText}`}
        </p>
      )}
      {locked && accepted === null && <p role="status">此題已鎖定。</p>}
      {state.error && (
        <p role="alert">{state.error.code === 'GROUP_ANSWER_INCOMPLETE' || state.error.code === 'GROUP_ANSWER_INVALID'
          || state.error.code === 'INVALID_MESSAGE'
          ? state.error.message || ERROR_GUIDANCE[state.error.code] || '答案未送出，請修正後重試。'
          : ERROR_GUIDANCE[state.error.code] || state.error.message || '答案未送出，請修正後重試。'}</p>
      )}
    </section>
  );
}
