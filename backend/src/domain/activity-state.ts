export const ACTIVITY_STAGES = ['PREPARING', 'BUZZING', 'ENDED'] as const;
export type ActivityStage = (typeof ACTIVITY_STAGES)[number];

const NEXT_STAGE: Readonly<Record<ActivityStage, ActivityStage | null>> = {
  PREPARING: 'BUZZING',
  BUZZING: 'ENDED',
  ENDED: null,
};

export interface TransitionResult {
  readonly accepted: boolean;
  readonly stage: ActivityStage;
}

/** Server-owned state for the one activity in this process. */
export class ActivityState {
  #stage: ActivityStage = 'PREPARING';

  get stage(): ActivityStage {
    return this.#stage;
  }

  advance(from: ActivityStage, to: ActivityStage): TransitionResult {
    if (from !== this.#stage || NEXT_STAGE[this.#stage] !== to) {
      return { accepted: false, stage: this.#stage };
    }
    this.#stage = to;
    return { accepted: true, stage: this.#stage };
  }
}
