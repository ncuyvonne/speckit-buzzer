import type { CorrectnessJudgement, ScoreboardEntry, TeacherProgress } from '../realtime/messages';

export interface TeacherScoringPanelProps {
  readonly progress: TeacherProgress | null;
  readonly scoreboard: readonly ScoreboardEntry[] | null;
  readonly onMark: (questionId: string, judgement: CorrectnessJudgement | null) => void;
}

export function TeacherScoringPanel({ progress, scoreboard, onMark }: TeacherScoringPanelProps) {
  return (
    <section aria-labelledby="teacher-scoring-title">
      <h3 id="teacher-scoring-title">正誤標記與計分板</h3>
      {progress?.questions.map((question) => question.winningGroupId !== null && (
        <article key={question.questionId}>
          <h4>題目 {question.questionId}</h4>
          <p>成功組別：{question.winningGroupId}；答案：{question.winningAnswer ?? ''}</p>
          <p>目前判定：{question.judgement === 'CORRECT' ? '對' : question.judgement === 'INCORRECT' ? '錯' : '未標記'}</p>
          <button type="button" onClick={() => onMark(question.questionId, 'CORRECT')}>標記正確：{question.questionId}</button>
          <button type="button" onClick={() => onMark(question.questionId, 'INCORRECT')}>標記錯誤：{question.questionId}</button>
          <button type="button" onClick={() => onMark(question.questionId, null)}>取消標記：{question.questionId}</button>
        </article>
      ))}
      <ScoreboardTable entries={scoreboard} />
    </section>
  );
}

export function ScoreboardTable({ entries }: { readonly entries: readonly ScoreboardEntry[] | null }) {
  return (
    <table aria-label="計分板">
      <thead><tr><th>排名</th><th>組別</th><th>得分</th><th>成功題數</th></tr></thead>
      <tbody>
        {entries?.map((entry) => (
          <tr key={entry.groupId}>
            <td>{entry.rank}</td><td>組別 {entry.groupId}</td><td>{entry.score} 分</td><td>{entry.successfulQuestionCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
