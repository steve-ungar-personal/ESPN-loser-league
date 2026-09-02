import type { Player, Pick, Room, PublicRoom, Drafter } from './types';
import { countRoster, hasRoomFor, ROSTER_SIZE } from './roster';
import { slotOnClock, totalPicks, roundOf, pickInRound } from './snake';

export class DraftError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function drafterByToken(room: Room, token: string | null): Drafter | null {
  if (!token) return null;
  return room.drafters.find((d) => d.token === token) ?? null;
}

export function onClockSlot(room: Room): number | null {
  if (room.status !== 'active') return null;
  const n = room.drafters.length;
  if (room.picks.length >= totalPicks(n)) return null;
  return slotOnClock(room.picks.length, n);
}

export function onClockDrafter(room: Room): Drafter | null {
  const slot = onClockSlot(room);
  if (slot === null) return null;
  return room.drafters.find((d) => d.slot === slot) ?? null;
}

export function toPublicRoom(room: Room): PublicRoom {
  const n = room.drafters.length;
  const slot = onClockSlot(room);
  const onClock = onClockDrafter(room);
  return {
    status: room.status,
    paused: room.paused,
    startsAt: room.startsAt,
    pickSeconds: room.pickSeconds,
    deadline: room.deadline,
    commissionerId: room.commissionerId,
    drafters: room.drafters
      .map(({ token, ...rest }) => rest)
      .sort((a, b) => a.slot - b.slot),
    picks: room.picks,
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    onClockSlot: slot,
    onClockDrafterId: onClock?.id ?? null,
    currentRound: roundOf(room.picks.length, n),
    currentPickInRound: pickInRound(room.picks.length, n),
    totalPicks: totalPicks(n),
    serverNow: Date.now(),
  };
}

/**
 * Records a pick after checking every rule. Throws DraftError on any
 * violation, so a forged request cannot jump the turn order or double-draft.
 */
export function applyPick(
  room: Room,
  drafterId: string,
  playerId: number,
  byId: Map<number, Player>,
  auto: boolean
): Pick {
  if (room.status !== 'active') {
    throw new DraftError('Draft is not running.');
  }
  if (room.paused) {
    throw new DraftError('The draft is paused.');
  }
  if (room.startsAt !== null && Date.now() < room.startsAt) {
    const secs = Math.ceil((room.startsAt - Date.now()) / 1000);
    throw new DraftError(`The draft starts in ${secs}s.`);
  }

  const n = room.drafters.length;
  const index = room.picks.length;
  if (index >= totalPicks(n)) {
    throw new DraftError('Draft is already complete.');
  }

  const expectedSlot = slotOnClock(index, n);
  const drafter = room.drafters.find((d) => d.id === drafterId);
  if (!drafter) throw new DraftError('Unknown drafter.', 403);
  if (drafter.slot !== expectedSlot) {
    throw new DraftError('It is not your turn.', 409);
  }

  if (room.picks.some((p) => p.playerId === playerId)) {
    throw new DraftError('That player is already drafted.', 409);
  }

  const player = byId.get(playerId);
  if (!player) throw new DraftError('Player is not in the available pool.');

  const counts = countRoster(room.picks, drafterId, byId);
  if (!hasRoomFor(player.pos, counts)) {
    throw new DraftError(`Your ${player.pos} slots are already full.`);
  }

  const pick: Pick = {
    overall: index + 1,
    round: roundOf(index, n),
    slot: expectedSlot,
    drafterId,
    playerId,
    auto,
    at: Date.now(),
  };
  room.picks.push(pick);

  if (room.picks.length >= totalPicks(n)) {
    room.status = 'complete';
    room.deadline = null;
  } else {
    room.deadline = Date.now() + room.pickSeconds * 1000;
  }
  return pick;
}

/** Best available player who fits an open slot for the drafter on the clock. */
export function bestAvailableFor(
  room: Room,
  drafterId: string,
  players: Player[],
  byId: Map<number, Player>
): Player | null {
  const taken = new Set(room.picks.map((p) => p.playerId));
  const counts = countRoster(room.picks, drafterId, byId);
  for (const p of players) {
    if (taken.has(p.id)) continue;
    if (!hasRoomFor(p.pos, counts)) continue;
    return p; // players arrive pre-sorted by ESPN rank
  }
  return null;
}

/**
 * Makes the pick for whoever ran out of clock. Safe to call from any client
 * polling the state - it no-ops unless the deadline has genuinely passed.
 */
export function runAutopickIfExpired(
  room: Room,
  players: Player[],
  byId: Map<number, Player>
): Pick | null {
  if (room.status !== 'active') return null;
  // A paused draft must never auto-draft for the person on the clock.
  if (room.paused) return null;
  // Nor may the opening grace period be auto-drafted through.
  if (room.startsAt !== null && Date.now() < room.startsAt) return null;
  if (room.deadline === null || Date.now() < room.deadline) return null;

  const drafter = onClockDrafter(room);
  if (!drafter) return null;

  const player = bestAvailableFor(room, drafter.id, players, byId);
  if (!player) return null;

  return applyPick(room, drafter.id, player.id, byId, true);
}

export { ROSTER_SIZE };
