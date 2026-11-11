import type { WinningResultsProvider } from '../../src/guided-notes/service.js';
import type { WinningResultsSnapshot } from '../../src/guided-notes/types.js';

export class FakeWinningResultsProvider implements WinningResultsProvider {
  callCount = 0;

  constructor(public snapshot: WinningResultsSnapshot = { status: 'UNAVAILABLE', reason: 'NOT_READY' }) {}

  async getSnapshot(): Promise<WinningResultsSnapshot> {
    this.callCount += 1;
    return structuredClone(this.snapshot);
  }
}
