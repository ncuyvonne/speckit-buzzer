import type { WinningResultsProvider } from './service.js';
import type { WinningResultsSnapshot } from './types.js';

/** Safe default until Feature 003 provides authoritative buzzer results. */
export class UnavailableWinningResultsProvider implements WinningResultsProvider {
  async getSnapshot(): Promise<WinningResultsSnapshot> {
    return { status: 'UNAVAILABLE', reason: 'NOT_READY' };
  }
}
