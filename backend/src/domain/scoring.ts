import type { ActivityState } from './activity-state.js';
import type { BuzzerResultsService } from './buzzer-results.js';
import type { GroupRoster } from './group-roster.js';

export type CorrectnessJudgement = 'CORRECT' | 'INCORRECT';
export interface ScoreboardEntry {
  readonly rank: number;
  readonly groupId: string;
  readonly score: number;
  readonly successfulQuestionCount: number;
}
export type MarkCorrectnessResult =
  | { readonly accepted: true; readonly questionId: string; readonly judgement: CorrectnessJudgement | null }
  | { readonly accepted: false; readonly code: 'STAGE_CONFLICT' | 'QUESTION_INVALID' | 'WINNER_NOT_FOUND' };

export interface ScoringServiceOptions {
  readonly activity: ActivityState;
  readonly roster: GroupRoster;
  readonly buzzerResults: BuzzerResultsService;
}

function compareGroupIds(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    const difference = BigInt(left) - BigInt(right);
    if (difference < 0n) return -1;
    if (difference > 0n) return 1;
    return left.localeCompare(right);
  }
  return left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' }) || left.localeCompare(right);
}

/** Stores one manual judgement per winning question and derives the current board. */
export class ScoringService {
  readonly #activity: ActivityState;
  readonly #roster: GroupRoster;
  readonly #buzzerResults: BuzzerResultsService;
  readonly #judgements = new Map<string, CorrectnessJudgement>();

  constructor(options: ScoringServiceOptions) {
    this.#activity = options.activity;
    this.#roster = options.roster;
    this.#buzzerResults = options.buzzerResults;
  }

  getJudgement(questionId: string): CorrectnessJudgement | null {
    return this.#judgements.get(questionId) ?? null;
  }

  markCorrectness(questionId: string, judgement: CorrectnessJudgement | null): MarkCorrectnessResult {
    if (this.#activity.stage !== 'ENDED') return { accepted: false, code: 'STAGE_CONFLICT' };
    if (!this.#activity.questions.some((question) => question.questionId === questionId)) {
      return { accepted: false, code: 'QUESTION_INVALID' };
    }
    if (this.#buzzerResults.getWinner(questionId) === null) {
      return { accepted: false, code: 'WINNER_NOT_FOUND' };
    }
    if (judgement === null) this.#judgements.delete(questionId);
    else this.#judgements.set(questionId, judgement);
    return { accepted: true, questionId, judgement };
  }

  clear(): void {
    this.#judgements.clear();
  }

  getScoreboard(): readonly ScoreboardEntry[] {
    const scores = new Map(this.#roster.ids.map((groupId) => [groupId, { groupId, score: 0, successfulQuestionCount: 0 }]));
    for (const question of this.#activity.questions) {
      const winner = this.#buzzerResults.getWinner(question.questionId);
      if (!winner) continue;
      const summary = scores.get(winner.groupId);
      if (!summary) continue;
      summary.successfulQuestionCount += 1;
      if (this.#judgements.get(question.questionId) === 'CORRECT') summary.score += 1;
    }
    const ordered = [...scores.values()].sort((left, right) =>
      right.score - left.score
      || right.successfulQuestionCount - left.successfulQuestionCount
      || compareGroupIds(left.groupId, right.groupId));
    return ordered.map((entry, index) => Object.freeze({ rank: index + 1, ...entry }));
  }
}
