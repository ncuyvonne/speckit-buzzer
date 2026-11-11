import { useState, type FormEvent } from 'react';
import type { ActivityStage, ErrorCode } from '../realtime/messages';
import type { BuzzerResultsViewState } from '../state/buzzer-results';

export interface BuzzerAnswerPanelProps {
  readonly groupId: string | null;
  readonly stage: ActivityStage | null;
  readonly connected: boolean;
  readonly state: BuzzerResultsViewState;
  readonly onSubmit: (questionId: string, answerText: string) => void;
  readonly onClearError: () => void;
}

const ERROR_GUIDANCE: Partial<Record<ErrorCode, string>> = {
  ANSWER_EMPTY: '請輸入答案後再送出。',
  ANSWER_LOCKED: '本組此題已鎖定，無法再次作答。',
  QUESTION_INVALID: '找不到這個題目，請重新選擇題號。',
  STAGE_CONFLICT: '目前不是搶答階段，請等待老師開始搶答。',
};

export function BuzzerAnswerPanel({ groupId, stage, connected, state, onSubmit, onClearError }: BuzzerAnswerPanelProps) {
  const [questionId, setQuestionId] = useState('');
  const [answerText, setAnswerText] = useState('');
  const selectedQuestion = questionId && state.questionIds.includes(questionId)
    ? questionId
    : state.questionIds[0] || '';
  const progress = state.ownProgress.find((item) => item.questionId === selectedQuestion);
  const locked = progress?.locked === true;
  const isBuzzing = stage === 'BUZZING';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedQuestion && !locked) onSubmit(selectedQuestion, answerText);
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
            disabled={locked || state.questionIds.length === 0}
            onChange={(event) => { setQuestionId(event.currentTarget.value); onClearError(); }}
          >
            {state.questionIds.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
          <label htmlFor="buzzer-answer">答案</label>
          <textarea
            id="buzzer-answer"
            value={locked ? (progress?.answerText ?? '') : answerText}
            disabled={!connected || !isBuzzing || locked}
            onChange={(event) => { setAnswerText(event.currentTarget.value); onClearError(); }}
          />
          <button type="submit" disabled={!connected || !isBuzzing || !selectedQuestion || locked}>
            送出答案
          </button>
        </form>
      )}
      {stage !== 'BUZZING' && <p>老師開始搶答後即可作答。</p>}
      {state.acceptedSubmission?.questionId === selectedQuestion && (
        <p role="status">答案已接受並鎖定：{state.acceptedSubmission.answerText}</p>
      )}
      {locked && state.acceptedSubmission?.questionId !== selectedQuestion && (
        <p role="status">此題已鎖定。</p>
      )}
      {state.error && (
        <p role="alert">{state.error.message || ERROR_GUIDANCE[state.error.code] || '答案未送出，請修正後重試。'}</p>
      )}
    </section>
  );
}
