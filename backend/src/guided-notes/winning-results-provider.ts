import type { ActivityState } from '../domain/activity-state.js';
import type { BuzzerResultsService } from '../domain/buzzer-results.js';
import type { WinningResultsProvider } from './service.js';
import type { WinningResultsSnapshot } from './types.js';

/** Adapts accepted server-side winners to the existing Feature 002 export boundary. */
export class BuzzerWinningResultsProvider implements WinningResultsProvider {
  readonly #activity: ActivityState;
  readonly #results: BuzzerResultsService;

  constructor(activity: ActivityState, results: BuzzerResultsService) {
    this.#activity = activity;
    this.#results = results;
  }

  async getSnapshot(): Promise<WinningResultsSnapshot> {
    if (this.#activity.stage !== 'ENDED' || this.#activity.questions.length === 0) {
      return { status: 'UNAVAILABLE', reason: 'NOT_READY' };
    }
    const winners = this.#activity.questions.flatMap((question) => {
      const winner = this.#results.getWinner(question.questionId);
      return winner === null ? [] : [winner];
    }).sort((left, right) => left.receivedOrder - right.receivedOrder);
    const answers = winners.map((winner) => ({
        questionId: winner.questionId,
        groupId: winner.groupId,
        ...(winner.kind === 'GROUP' ? { answers: winner.answers } : { answerText: winner.answerText }),
      }));
    return { status: 'READY', answers };
  }
}
