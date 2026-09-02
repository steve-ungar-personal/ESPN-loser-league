import type { Pos, SlotKey, Player, Pick } from './types';

/** Roster: 1 QB, 2 RB, 3 combined TE/WR, 1 K = 7 rounds. */
export const SLOT_LIMITS: Record<SlotKey, number> = {
  QB: 1,
  RB: 2,
  TEWR: 3,
  K: 1,
};

export const ROSTER_SIZE = Object.values(SLOT_LIMITS).reduce((a, b) => a + b, 0);

export const SLOT_LABELS: Record<SlotKey, string> = {
  QB: 'QB',
  RB: 'RB',
  TEWR: 'TE/WR',
  K: 'K',
};

/** Which roster bucket a position consumes. WR and TE share one pool. */
export function slotFor(pos: Pos): SlotKey {
  if (pos === 'QB') return 'QB';
  if (pos === 'RB') return 'RB';
  if (pos === 'K') return 'K';
  return 'TEWR'; // WR | TE
}

export type SlotCounts = Record<SlotKey, number>;

export function emptyCounts(): SlotCounts {
  return { QB: 0, RB: 0, TEWR: 0, K: 0 };
}

/** Count how many of each roster bucket a drafter has already filled. */
export function countRoster(
  picks: Pick[],
  drafterId: string,
  byId: Map<number, Player>
): SlotCounts {
  const counts = emptyCounts();
  for (const p of picks) {
    if (p.drafterId !== drafterId) continue;
    const player = byId.get(p.playerId);
    if (!player) continue;
    counts[slotFor(player.pos)] += 1;
  }
  return counts;
}

/** True if this drafter still has an open slot for that position. */
export function hasRoomFor(pos: Pos, counts: SlotCounts): boolean {
  const key = slotFor(pos);
  return counts[key] < SLOT_LIMITS[key];
}

export function rosterComplete(counts: SlotCounts): boolean {
  return (Object.keys(SLOT_LIMITS) as SlotKey[]).every(
    (k) => counts[k] >= SLOT_LIMITS[k]
  );
}

/**
 * Pick-clock bounds. 5s is deliberately low - some groups want a rapid-fire
 * draft - but below that the poll interval cannot keep up with the clock.
 */
export const MIN_PICK_SECONDS = 5;
export const MAX_PICK_SECONDS = 600;

/** Seconds between hitting Start and the first pick clock running. */
export const START_DELAY_SECONDS = 10;
