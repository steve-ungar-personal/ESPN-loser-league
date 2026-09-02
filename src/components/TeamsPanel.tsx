'use client';
import type { Player, Pick, PublicDrafter, SlotKey } from '@/lib/types';
import { SLOT_LIMITS, slotFor, ROSTER_SIZE } from '@/lib/roster';

/** Roster template in draft-sheet order, one entry per slot. */
const TEMPLATE: SlotKey[] = (['QB', 'RB', 'TEWR', 'K'] as SlotKey[]).flatMap((k) =>
  Array.from({ length: SLOT_LIMITS[k] }, () => k)
);

const EMPTY_LABEL: Record<SlotKey, string> = {
  QB: 'QB', RB: 'RB', TEWR: 'W/T', K: 'K',
};

export default function TeamsPanel({
  drafters, picks, byId, onClockDrafterId, meId,
}: {
  drafters: PublicDrafter[];
  picks: Pick[];
  byId: Map<number, Player>;
  onClockDrafterId: string | null;
  meId: string | null;
}) {
  // One pass over picks instead of re-scanning per drafter per slot.
  const filledBy = new Map<string, Record<SlotKey, Player[]>>();
  for (const d of drafters) filledBy.set(d.id, { QB: [], RB: [], TEWR: [], K: [] });
  for (const p of picks) {
    const player = byId.get(p.playerId);
    const bucket = filledBy.get(p.drafterId);
    if (player && bucket) bucket[slotFor(player.pos)].push(player);
  }

  return (
    <div className="panel">
      <h2>All teams ({drafters.length})</h2>
      <ul className="teams">
        {drafters.map((d) => {
          const bucket = filledBy.get(d.id)!;
          const total =
            bucket.QB.length + bucket.RB.length + bucket.TEWR.length + bucket.K.length;
          const onClock = d.id === onClockDrafterId;
          const seen: Record<SlotKey, number> = { QB: 0, RB: 0, TEWR: 0, K: 0 };

          return (
            <li key={d.id} className={onClock ? 'team onclock' : 'team'}>
              <span className="tslot">{d.slot}</span>
              <span className={d.id === meId ? 'tname me' : 'tname'}>{d.name}</span>

              <span className="strip">
                {TEMPLATE.map((key, i) => {
                  const player = bucket[key][seen[key]++];
                  return player ? (
                    <span
                      key={i}
                      className={`box ${player.pos}`}
                      title={`${player.name} (${player.pos} ${player.proTeam})`}
                    >
                      {player.pos}
                    </span>
                  ) : (
                    <span
                      key={i}
                      className={`box open s-${key}`}
                      title={`still needs ${EMPTY_LABEL[key]}`}
                    >
                      {EMPTY_LABEL[key]}
                    </span>
                  );
                })}
              </span>

              <span className={total === ROSTER_SIZE ? 'tcount done' : 'tcount'}>
                {total}/{ROSTER_SIZE}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="note legend">
        Slots: QB · RB · RB · 3× TE/WR · K — <strong>coloured = still needed</strong>, grey = drafted
      </p>
    </div>
  );
}
