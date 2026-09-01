'use client';
import { useMemo, useState } from 'react';
import type { Player, Pos } from '@/lib/types';
import { hasRoomFor, type SlotCounts } from '@/lib/roster';

type SortKey =
  | 'espnRank' | 'name' | 'pos' | 'proTeam' | 'bye'
  | 'adp' | 'auctionValue' | 'proj2026' | 'actual2025' | 'percentOwned';

const COLS: { key: SortKey; label: string; left?: boolean; title?: string }[] = [
  { key: 'espnRank', label: 'Rk', title: 'ESPN PPR draft rank' },
  { key: 'pos', label: 'Pos', left: true },
  { key: 'name', label: 'Player', left: true },
  { key: 'proTeam', label: 'Tm', left: true },
  { key: 'bye', label: 'Bye', title: 'Bye week' },
  { key: 'adp', label: 'ADP', title: 'Average draft position across ESPN' },
  { key: 'auctionValue', label: '$', title: 'Average auction value' },
  { key: 'proj2026', label: 'Proj', title: 'Projected 2026 fantasy points' },
  { key: 'actual2025', label: '2025', title: 'Actual 2025 fantasy points' },
  { key: 'percentOwned', label: 'Own%', title: 'Percent rostered across ESPN' },
];

const FILTERS: (Pos | 'ALL' | 'FLEX')[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'FLEX'];

// Ranks read best smallest-first; points and money read best largest-first.
const ASC_BY_DEFAULT = new Set<SortKey>(['espnRank', 'adp', 'name', 'pos', 'proTeam', 'bye']);

function fmt(v: number | null, digits = 1): string {
  if (v === null) return '—';
  return digits === 0 ? String(Math.round(v)) : v.toFixed(digits);
}

function slotNameFor(pos: Pos): string {
  return pos === 'WR' || pos === 'TE' ? 'TE/WR' : pos;
}

export default function PlayerTable({
  players, counts, isMyTurn, onDraft, busyId,
}: {
  players: Player[];
  counts: SlotCounts;
  isMyTurn: boolean;
  onDraft: (id: number) => void;
  busyId: number | null;
}) {
  const [filter, setFilter] = useState<Pos | 'ALL' | 'FLEX'>('ALL');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('espnRank');
  const [asc, setAsc] = useState(true);
  const [hideFilled, setHideFilled] = useState(false);

  const rows = useMemo(() => {
    let out = players;

    if (filter === 'FLEX') out = out.filter((p) => p.pos === 'WR' || p.pos === 'TE');
    else if (filter !== 'ALL') out = out.filter((p) => p.pos === filter);

    // Drop anyone whose roster slot is already full, rather than dimming them.
    if (hideFilled) out = out.filter((p) => hasRoomFor(p.pos, counts));

    const needle = q.trim().toLowerCase();
    if (needle) {
      out = out.filter(
        (p) => p.name.toLowerCase().includes(needle) || p.proTeam.toLowerCase().includes(needle)
      );
    }

    const dir = asc ? 1 : -1;
    return [...out].sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
      }
      // Missing values always sink to the bottom, whichever way we sort.
      const an = av === null ? Infinity : av;
      const bn = bv === null ? Infinity : bv;
      if (an === bn) return (a.espnRank ?? 99999) - (b.espnRank ?? 99999);
      return (an < bn ? -1 : 1) * dir;
    });
  }, [players, filter, q, sort, asc, hideFilled, counts]);

  function toggleSort(key: SortKey) {
    if (key === sort) { setAsc(!asc); return; }
    setSort(key);
    setAsc(ASC_BY_DEFAULT.has(key));
  }

  const sortLabel = COLS.find((c) => c.key === sort)?.label ?? '';
  const hiddenCount = hideFilled
    ? players.filter((p) => !hasRoomFor(p.pos, counts)).length
    : 0;

  return (
    <div className="stack">
      <div className="spread">
        <div className="row">
          <div className="tabs">
            {FILTERS.map((f) => (
              <button
                key={f}
                className={filter === f ? 'sm on' : 'sm'}
                onClick={() => setFilter(f)}
              >
                {f === 'FLEX' ? 'TE/WR' : f}
              </button>
            ))}
          </div>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={hideFilled}
              onChange={(e) => setHideFilled(e.target.checked)}
            />
            Hide drafted positions
          </label>
        </div>

        <input
          className="search"
          placeholder="Search player or team..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <p className="note" style={{ margin: 0 }}>
        {rows.length} available
        {filter !== 'ALL' ? ` at ${filter === 'FLEX' ? 'TE/WR' : filter}` : ''}
        {' · '}sorted by {sortLabel} {asc ? '↑' : '↓'}
        {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
      </p>

      <div className="tablewrap" style={{ maxHeight: '62vh' }}>
        <table>
          <thead>
            <tr>
              <th className="act l" />
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={c.left ? 'l' : undefined}
                  title={c.title}
                  onClick={() => toggleSort(c.key)}
                >
                  {c.label}{sort === c.key ? (asc ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const fits = hasRoomFor(p.pos, counts);
              const hurt = p.injuryStatus && p.injuryStatus !== 'ACTIVE';
              return (
                <tr key={p.id} className={fits ? undefined : 'blocked'}>
                  <td className="act l">
                    <button
                      className="sm primary"
                      disabled={!isMyTurn || !fits || busyId !== null}
                      title={
                        !fits
                          ? `Your ${slotNameFor(p.pos)} slots are full`
                          : !isMyTurn
                            ? 'Not your turn'
                            : undefined
                      }
                      onClick={() => onDraft(p.id)}
                    >
                      {busyId === p.id ? '...' : 'Draft'}
                    </button>
                  </td>
                  <td>{p.espnRank ?? '—'}</td>
                  <td className="l"><span className={`pos ${p.pos}`}>{p.pos}</span></td>
                  <td className="l name">
                    {p.name}
                    {hurt && (
                      <span className={`inj ${p.injuryStatus}`}>
                        {p.injuryStatus!.replace(/_/g, ' ')}
                      </span>
                    )}
                  </td>
                  <td className="l">{p.proTeam}</td>
                  <td>{p.bye ?? '—'}</td>
                  <td>{fmt(p.adp)}</td>
                  <td>{p.auctionValue === null ? '—' : `$${fmt(p.auctionValue, 0)}`}</td>
                  <td>{fmt(p.proj2026)}</td>
                  <td>{fmt(p.actual2025)}</td>
                  <td>{fmt(p.percentOwned, 0)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', color: 'var(--dim)', padding: 24 }}>
                  {hideFilled && hiddenCount > 0
                    ? 'Every player here fills a slot you have already drafted.'
                    : 'No players match.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
