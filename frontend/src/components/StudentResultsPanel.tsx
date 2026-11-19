import type { StudentResults } from '../realtime/messages';

function answersText(answers: readonly { readonly answerText: string }[]): string {
  return answers.map((answer) => answer.answerText).join('；');
}

export interface StudentResultsPanelProps {
  readonly results: StudentResults | null;
}

export function StudentResultsPanel({ results }: StudentResultsPanelProps) {
  return (
    <section aria-labelledby="student-results-title">
      <h3 id="student-results-title">本次搶答結果</h3>
      {results === null ? (
        <p>正在載入結果…</p>
      ) : results.questions.length === 0 ? (
        <p>本次活動沒有題目。</p>
      ) : (
        <ol>
          {results.questions.map((question) => (
            <li key={question.questionId}>
              <h4>題目 {question.questionId}</h4>
              <p>
                {question.winningGroupId === null
                  ? '本題無人作答'
                  : `勝出組別：${question.winningGroupId}；勝出答案：${question.winningAnswers
                    ? answersText(question.winningAnswers)
                    : question.winningAnswer ?? ''}`}
              </p>
              <p>
                {question.ownStatus === 'NOT_SUBMITTED'
                  ? '尚未作答'
                  : `本組答案：${question.ownAnswers
                    ? answersText(question.ownAnswers)
                    : question.ownAnswer ?? ''}`}
              </p>
              {question.ownStatus === 'SUBMITTED' && (
                <p>{question.ownGroupWon ? '本組勝出' : '本組未勝出'}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
