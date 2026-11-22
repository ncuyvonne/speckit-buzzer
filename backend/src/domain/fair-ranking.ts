export interface RankingCandidate {
  readonly effectiveAtMs: number;
  readonly acceptedOrder: number;
}

export interface RankedValue<T> {
  readonly value: T;
  readonly rank: number;
}

/** Sorts accepted answers by effective server time, then by server acceptance order. */
export function rankAcceptedAnswers<T extends RankingCandidate>(answers: readonly T[]): readonly RankedValue<T>[] {
  return answers
    .map((value) => ({ value }))
    .sort((left, right) => left.value.effectiveAtMs - right.value.effectiveAtMs
      || left.value.acceptedOrder - right.value.acceptedOrder)
    .map(({ value }, index) => ({ value, rank: index + 1 }));
}
