import { describe, expect, it } from 'vitest';
import { ActivityState } from '../../src/domain/activity-state.js';
import { ActivityTimer } from '../../src/domain/activity-timer.js';

function createTimer(limitSeconds: number) {
  let now = 10_000;
  const callbacks: Array<() => void> = [];
  const cancelled = new Set<number>();
  const countdown: number[] = [];
  let endCount = 0;
  const activity = new ActivityState();
  activity.setTimeLimitSeconds(limitSeconds);
  activity.advance('PREPARING', 'BUZZING');
  const timer = new ActivityTimer({
    activity,
    now: () => now,
    schedule: (callback, delayMs) => {
      expect(delayMs).toBe(1_000);
      callbacks.push(callback);
      return callbacks.length - 1;
    },
    cancel: (handle) => { cancelled.add(handle as number); },
    onCountdown: (seconds) => countdown.push(seconds),
    onEnded: () => { endCount += 1; },
  });
  return {
    activity,
    timer,
    callbacks,
    cancelled,
    countdown,
    get endCount() { return endCount; },
    setNow(value: number) { now = value; },
  };
}

describe('ActivityTimer', () => {
  it('publishes remaining seconds and ends exactly once at the server deadline', () => {
    const harness = createTimer(2);
    harness.timer.start();
    expect(harness.activity.deadlineAt).toBe(12_000);
    expect(harness.countdown).toEqual([2]);

    harness.setNow(11_000);
    harness.callbacks[0]!();
    expect(harness.countdown).toEqual([2, 1]);
    expect(harness.activity.stage).toBe('BUZZING');

    harness.setNow(12_000);
    harness.callbacks[0]!();
    harness.callbacks[0]!();
    expect(harness.activity.stage).toBe('ENDED');
    expect(harness.endCount).toBe(1);
    expect(harness.countdown.at(-1)).toBe(0);
  });

  it('does not schedule a timer or countdown for unlimited rounds', () => {
    const harness = createTimer(0);
    harness.timer.start();
    expect(harness.callbacks).toHaveLength(0);
    expect(harness.countdown).toEqual([]);
    expect(harness.activity.deadlineAt).toBeNull();
  });

  it('cancels after manual end and ignores an already queued callback after timer restart', () => {
    const manual = createTimer(2);
    manual.timer.start();
    const manualCallback = manual.callbacks[0]!;
    expect(manual.activity.advance('BUZZING', 'ENDED').accepted).toBe(true);
    manual.timer.stop();
    expect(manual.cancelled.has(0)).toBe(true);
    manualCallback();
    expect(manual.activity.stage).toBe('ENDED');
    expect(manual.endCount).toBe(0);

    const restarted = createTimer(2);
    restarted.timer.start();
    const staleCallback = restarted.callbacks[0]!;
    restarted.timer.stop();
    restarted.setNow(11_000);
    restarted.timer.start();
    const currentCallback = restarted.callbacks[1]!;
    staleCallback();
    expect(restarted.activity.stage).toBe('BUZZING');
    expect(restarted.endCount).toBe(0);
    restarted.setNow(13_000);
    currentCallback();
    expect(restarted.activity.stage).toBe('ENDED');
    expect(restarted.endCount).toBe(1);
  });
});
