import { describe, expect, it } from 'vitest';
import { serializeBuzzerResultsCsv } from '../../src/domain/buzzer-results-csv.js';
import type { TeacherProgress } from '../../src/domain/buzzer-results.js';

describe('buzzer results CSV', () => {
  it('writes all question/group rows, order, escaping, CRLF, and UTF-8 BOM', () => {
    const progress: TeacherProgress = { questions: [
      {
        questionId: '1', winningGroupId: 'B', winningAnswer: 'say "yes", go',
        winningAnswers: null,
        groups: [
          { groupId: 'A', submitted: true, rank: 2, answerText: null, answers: [
            { placeholderNumber: 1, answerText: '第一格, "引號"\r\n第二行' },
            { placeholderNumber: 2, answerText: '第二格' },
          ] },
          { groupId: 'B', submitted: true, rank: 1, answerText: 'say "yes", go', answers: null },
          { groupId: 'C', submitted: false, rank: null, answerText: null, answers: null },
        ],
      },
      {
        questionId: '2', winningGroupId: null, winningAnswer: null,
        groups: [
          { groupId: 'A', submitted: false, rank: null, answerText: null },
          { groupId: 'B', submitted: false, rank: null, answerText: null },
          { groupId: 'C', submitted: false, rank: null, answerText: null },
        ],
      },
    ] };

    const csv = serializeBuzzerResultsCsv(progress);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.slice(1)).toBe([
      '題號,成功組別,成功答案,組別,組別答案,搶答順位',
      '1,B,"say ""yes"", go",B,"say ""yes"", go",1',
      '1,B,"say ""yes"", go",A,"（1）第一格, ""引號""\r\n第二行；（2）第二格",2',
      '1,B,"say ""yes"", go",C,,',
      '2,,,A,,',
      '2,,,B,,',
      '2,,,C,,',
    ].join('\r\n'));
    expect(new TextEncoder().encode(csv).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
  });
});
