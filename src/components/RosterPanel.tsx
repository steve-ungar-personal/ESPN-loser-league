'use client';
import type { Player, Pick, SlotKey } from '@/lib/types';
import { SLOT_LIMITS, SLOT_LABELS, slotFor, type SlotCounts } from '@/lib/roster';

export default function RosterPanel({
  title, picks, byId, counts,
}: {
  title: string;
  picks: Pick[];
  byId: Map<number, Player>;
  counts: SlotCounts;
}) {
  const order: SlotKey[] = ['QB', 'RB', 'TEWR', 'K'];

  // Bucket each drafted player under the roster slot they consumed.
  const filled: Record<SlotKey, Player[]> = { QB: [], RB: [], TEWR: [], K: [] };
  for (const p of picks) {
    const pl = byId.get(p.playerId);
    if (pl) filled[slotFor(pl.pos)].push(pl);
  }

  const total = SLOT_LIMITS.QB + SLOT_LIMITS.RB + SLOT_LIMITS.TEWR + SLOT_LIMITS.K;
  const used = counts.QB + counts.RB + counts.TEWR + counts.K;

  return (
    <div className="panel">
      <h2>{title}</h2>
      <div className="slotgrid">
        {order.flatMap((key) =>
          Array.from({ length: SLOT_LIMITS[key] }, (_, i) => {
            const pl = filled[key][i];
            return [
              <div className="slotlabel" key={`l-${key}-${i}`}>{SLOT_LABELS[key]}</div>,
              <div className={pl ? 'slotval' : 'slotval empty'} key={`v-${key}-${i}`}>
                {pl ? (
                  <>
                    <span className={`pos ${pl.pos}`}>{pl.pos}</span>{' '}
                    {pl.name} <span className="note">{pl.proTeam}</span>
                  </>
                ) : 'empty'}
              </div>,
            ];
          })
        )}
      </div>
      <p className="note" style={{ marginTop: 10, marginBottom: 0 }}>
        {used} of {total} filled
      </p>
    </div>
  );
}
