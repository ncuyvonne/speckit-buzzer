import type { TeacherProgress } from '../realtime/messages';

export interface TeacherResultsPanelProps {
  readonly progress: TeacherProgress | null;
}

export function TeacherResultsPanel({ progress }: TeacherResultsPanelProps) {
  return (
    <section aria-labelledby="teacher-results-title">
      <h3 id="teacher-results-title">搶答進度</h3>
      {progress === null || progress.questions.length === 0 ? (
        <p>目前沒有題目。</p>
      ) : (
        <ol>
          {progress.questions.map((question) => (
            <li key={question.questionId}>
              <h4>題目 {question.questionId}</h4>
              <p>
                {question.winningGroupId === null
                  ? '目前沒有成功組別'
                  : `目前成功組別：${question.winningGroupId}；答案：${question.winningAnswer ?? ''}`}
              </p>
              <ul>
                {question.groups.map((group) => (
                  <li key={group.groupId}>
                    <span>組別 {group.groupId}：{group.submitted ? '已提交' : '尚未提交'}</span>
                    {group.submitted && <span>，答案：{group.answerText ?? ''}</span>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
