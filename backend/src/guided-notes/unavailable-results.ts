import type { WinningResultsProvider } from './service.js';
import type { WinningResultsSnapshot } from './types.js';

/** Explicit UNAVAILABLE fallback; the production composition root injects BuzzerWinningResultsProvider by default. */
export class UnavailableWinningResultsProvider implements WinningResultsProvider {
  async getSnapshot(): Promise<WinningResultsSnapshot> {
    return { status: 'UNAVAILABLE', reason: 'NOT_READY' };
  }
}
