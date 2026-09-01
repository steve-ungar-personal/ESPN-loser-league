import { ROSTER_SIZE } from './roster';

/**
 * Snake order. Odd rounds run slot 1..N, even rounds run N..1.
 * `index` is the zero-based overall pick number.
 */
export function slotOnClock(index: number, drafterCount: number): number {
  if (drafterCount <= 0) return 1;
  const round = Math.floor(index / drafterCount); // 0-based
  const posInRound = index % drafterCount;
  return round % 2 === 0 ? posInRound + 1 : drafterCount - posInRound;
}

export function totalPicks(drafterCount: number): number {
  return drafterCount * ROSTER_SIZE;
}

export function roundOf(index: number, drafterCount: number): number {
  if (drafterCount <= 0) return 1;
  return Math.floor(index / drafterCount) + 1;
}

export function pickInRound(index: number, drafterCount: number): number {
  if (drafterCount <= 0) return 1;
  return (index % drafterCount) + 1;
}
