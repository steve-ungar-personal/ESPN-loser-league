import { getStore } from '@/lib/store';
import { getPlayers } from '@/lib/espn';
import { json, fail } from '@/lib/api';
import { slotFor, SLOT_LIMITS, ROSTER_SIZE } from '@/lib/roster';
import type { SlotKey, Player, Room } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** RFC 4180: wrap in quotes and double any embedded quote. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

/** Every pick in draft order, with the full stat line for each player. */
function picksCsv(room: Room, byId: Map<number, Player>): string {
  const header = [
    'overall', 'round', 'draft_slot', 'drafter', 'auto_picked',
    'player', 'position', 'roster_slot', 'nfl_team', 'bye',
    'espn_rank', 'adp', 'auction_value', 'proj_2026', 'actual_2025',
    'percent_owned', 'injury_status', 'player_id', 'picked_at_utc',
  ];
  const rows = room.picks.map((p) => {
    const pl = byId.get(p.playerId);
    const who = room.drafters.find((d) => d.id === p.drafterId);
    return [
      p.overall, p.round, p.slot, who?.name ?? '', p.auto ? 'yes' : 'no',
      pl?.name ?? '', pl?.pos ?? '', pl ? slotFor(pl.pos) : '',
      pl?.proTeam ?? '', pl?.bye ?? '',
      pl?.espnRank ?? '', pl?.adp ?? '', pl?.auctionValue ?? '',
      pl?.proj2026 ?? '', pl?.actual2025 ?? '',
      pl?.percentOwned ?? '', pl?.injuryStatus ?? '',
      p.playerId, new Date(p.at).toISOString(),
    ];
  });
  return toCsv([header, ...rows]);
}

/** One row per team, one column per roster slot - the final rosters. */
function rostersCsv(room: Room, byId: Map<number, Player>): string {
  const template: SlotKey[] = (['QB', 'RB', 'TEWR', 'K'] as SlotKey[]).flatMap((k) =>
    Array.from({ length: SLOT_LIMITS[k] }, () => k)
  );
  const header = [
    'draft_slot', 'drafter', 'filled',
    ...template.map((k, i) => `${k === 'TEWR' ? 'TE_WR' : k}_${
      template.slice(0, i).filter((x) => x === k).length + 1
    }`),
    'total_proj_2026',
  ];

  const rows = room.drafters
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map((d) => {
      const buckets: Record<SlotKey, Player[]> = { QB: [], RB: [], TEWR: [], K: [] };
      for (const p of room.picks) {
        if (p.drafterId !== d.id) continue;
        const pl = byId.get(p.playerId);
        if (pl) buckets[slotFor(pl.pos)].push(pl);
      }
      const seen: Record<SlotKey, number> = { QB: 0, RB: 0, TEWR: 0, K: 0 };
      const cells = template.map((k) => {
        const pl = buckets[k][seen[k]++];
        return pl ? `${pl.name} (${pl.pos} ${pl.proTeam})` : '';
      });
      const filled = buckets.QB.length + buckets.RB.length + buckets.TEWR.length + buckets.K.length;
      const proj = [...buckets.QB, ...buckets.RB, ...buckets.TEWR, ...buckets.K]
        .reduce((sum, p) => sum + (p.proj2026 ?? 0), 0);
      return [d.slot, d.name, `${filled}/${ROSTER_SIZE}`, ...cells, Math.round(proj * 10) / 10];
    });

  return toCsv([header, ...rows]);
}

export async function GET(req: Request) {
  try {
    const format = (new URL(req.url).searchParams.get('format') ?? 'json').toLowerCase();

    const store = await getStore();
    const room = await store.read();
    const players = await getPlayers();
    const byId = new Map(players.map((p) => [p.id, p]));

    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv' || format === 'picks') {
      return new Response(picksCsv(room, byId), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="draft-picks-${stamp}.csv"`,
          'cache-control': 'no-store',
        },
      });
    }

    if (format === 'rosters') {
      return new Response(rostersCsv(room, byId), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="draft-rosters-${stamp}.csv"`,
          'cache-control': 'no-store',
        },
      });
    }

    // Full structured dump: everything, with players resolved inline.
    const payload = {
      exportedAt: new Date().toISOString(),
      status: room.status,
      rosterFormat: SLOT_LIMITS,
      drafters: room.drafters
        .map(({ token, ...rest }) => rest)
        .sort((a, b) => a.slot - b.slot),
      picks: room.picks.map((p) => {
        const pl = byId.get(p.playerId);
        const who = room.drafters.find((d) => d.id === p.drafterId);
        return {
          overall: p.overall, round: p.round, draftSlot: p.slot,
          drafter: who?.name ?? null, auto: p.auto,
          pickedAt: new Date(p.at).toISOString(),
          player: pl ?? { id: p.playerId, name: null },
        };
      }),
    };

    return json(payload);
  } catch (err) {
    return fail(err);
  }
}
