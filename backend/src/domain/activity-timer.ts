import type { ActivityState } from './activity-state.js';

export interface ActivityTimerOptions {
  readonly activity: ActivityState;
  readonly now?: () => number;
  readonly schedule?: (callback: () => void, delayMs: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
  readonly onCountdown: (remainingSeconds: number) => void;
  readonly onEnded: () => void;
}

/** Runs the server-owned countdown and invalidates callbacks from older timer generations. */
export class ActivityTimer {
  readonly #activity: ActivityState;
  readonly #now: () => number;
  readonly #schedule: (callback: () => void, delayMs: number) => unknown;
  readonly #cancel: (handle: unknown) => void;
  readonly #onCountdown: (remainingSeconds: number) => void;
  readonly #onEnded: () => void;
  #generation = 0;
  #handle: unknown | null = null;

  constructor(options: ActivityTimerOptions) {
    this.#activity = options.activity;
    this.#now = options.now ?? Date.now;
    this.#schedule = options.schedule ?? ((callback, delayMs) => setInterval(callback, delayMs));
    this.#cancel = options.cancel ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
    this.#onCountdown = options.onCountdown;
    this.#onEnded = options.onEnded;
  }

  start(): boolean {
    this.stop();
    if (this.#activity.stage !== 'BUZZING') return false;
    const deadlineAt = this.#activity.startCountdown(this.#now());
    if (deadlineAt === null) return true;

    const generation = this.#generation;
    this.#onCountdown(this.#activity.getRemainingSeconds(this.#now()) ?? 0);
    this.#handle = this.#schedule(() => this.#tick(generation, deadlineAt), 1_000);
    return true;
  }

  stop(): void {
    this.#generation += 1;
    if (this.#handle !== null) this.#cancel(this.#handle);
    this.#handle = null;
    this.#activity.clearDeadline();
  }

  #tick(generation: number, deadlineAt: number): void {
    if (
      generation !== this.#generation
      || this.#activity.stage !== 'BUZZING'
      || this.#activity.deadlineAt !== deadlineAt
    ) return;

    const remainingMs = deadlineAt - this.#now();
    if (remainingMs <= 0) {
      this.#onCountdown(0);
      const result = this.#activity.advance('BUZZING', 'ENDED');
      this.stop();
      if (result.accepted) this.#onEnded();
      return;
    }
    this.#onCountdown(Math.ceil(remainingMs / 1_000));
  }
}
