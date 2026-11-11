import { describe, expect, it } from 'vitest';
import { GuidedNotesService } from '../../../src/guided-notes/service.js';
import { FakeGoogleSheetsAdapter } from '../../support/fake-google-sheets.js';
import { FakeWinningResultsProvider } from '../../support/fake-winning-results.js';

describe('GuidedNotesService operation coordinator', () => {
  it('rejects a concurrent external operation and releases the lock when work finishes', async () => {
    const service = new GuidedNotesService({
      activity: { stage: 'PREPARING' },
      sheets: new FakeGoogleSheetsAdapter(),
      winningResultsProvider: new FakeWinningResultsProvider(),
    });
    let finish!: (value: string) => void;
    const firstOperation = service.runExclusive('IMPORT', () => new Promise<string>((resolve) => {
      finish = resolve;
    }));

    expect(service.activeOperation).toBe('IMPORT');
    await expect(service.runExclusive('EXPORT', async () => 'should not run'))
      .rejects.toMatchObject({ code: 'GUIDED_NOTES_BUSY' });

    finish('import complete');
    await expect(firstOperation).resolves.toBe('import complete');
    expect(service.activeOperation).toBeNull();
    await expect(service.runExclusive('EXPORT', async () => 'export complete'))
      .resolves.toBe('export complete');
  });
});
