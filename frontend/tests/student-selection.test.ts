import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeClient } from '../src/realtime/client';
import { StudentSelection } from '../src/state/student-selection';

describe('student selection storage fallback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the client usable when accessing window.sessionStorage throws', () => {
    const fakeWindow = Object.defineProperty({ location: { protocol: 'http:', host: 'localhost' } }, 'sessionStorage', {
      get() { throw new Error('storage is unavailable'); },
    });
    vi.stubGlobal('window', fakeWindow);

    expect(() => new RealtimeClient()).not.toThrow();

    const selection = new StudentSelection();
    expect(selection.read()).toBeNull();
    expect(() => selection.save('1')).not.toThrow();
    expect(() => selection.clear()).not.toThrow();
  });
});
