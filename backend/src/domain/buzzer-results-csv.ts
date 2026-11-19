import type { TeacherProgress } from './buzzer-results.js';
import type { SubAnswer } from '../guided-notes/types.js';

const HEADER = ['題號', '成功組別', '成功答案', '組別', '組別答案', '搶答順位'] as const;

function answersText(answers: readonly SubAnswer[]): string {
  return [...answers]
    .sort((left, right) => left.placeholderNumber - right.placeholderNumber)
    .map((answer) => `（${answer.placeholderNumber}）${answer.answerText}`)
    .join('；');
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Serializes the full teacher view; answer correctness and scoring are not part of this export. */
export function serializeBuzzerResultsCsv(progress: TeacherProgress): string {
  const records = [HEADER.join(',')];
  for (const question of progress.questions) {
    const submitted = question.groups
      .map((group, index) => ({ group, index }))
      .filter(({ group }) => group.submitted)
      .sort((left, right) => (left.group.rank ?? Number.MAX_SAFE_INTEGER)
        - (right.group.rank ?? Number.MAX_SAFE_INTEGER) || left.index - right.index);
    const unanswered = question.groups
      .map((group, index) => ({ group, index }))
      .filter(({ group }) => !group.submitted)
      .sort((left, right) => left.index - right.index);
    const orderedGroups = [...submitted, ...unanswered].map(({ group }) => group);
    const successfulAnswer = question.winningAnswers
      ? answersText(question.winningAnswers)
      : question.winningAnswer ?? '';

    for (const group of orderedGroups) {
      const groupAnswer = !group.submitted
        ? ''
        : group.answers
          ? answersText(group.answers)
          : group.answerText ?? '';
      records.push([
        question.questionId,
        question.winningGroupId ?? '',
        successfulAnswer,
        group.groupId,
        groupAnswer,
        group.submitted && group.rank !== null ? String(group.rank) : '',
      ].map(csvField).join(','));
    }
  }
  return `\uFEFF${records.join('\r\n')}`;
}
