import type { Player, Pos } from './types';

const SEASON = Number(process.env.ESPN_SEASON ?? 2026);
const LEAGUE_ID = process.env.ESPN_LEAGUE_ID ?? '1005162176';
const HOST = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';

const LEAGUE_URL = `${HOST}/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}`;
const TEAMS_URL = `${HOST}/seasons/${SEASON}?view=proTeamSchedules_wl`;

/** ESPN defaultPositionId -> our position. Anything else (D/ST etc) is dropped. */
const POS_MAP: Record<number, Pos> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K' };

/** How many free agents to pull. Deep drafts thin the pool, and a low cap can
 *  drop an entire position off the bottom of the rank sort - 1200 returns
 *  everything ESPN has available for every league tested. */
const POOL_LIMIT = 1200;

const CACHE_MS = 15 * 60 * 1000;

type TeamInfo = { abbrev: string; bye: number | null };

let teamCache: { at: number; data: Map<number, TeamInfo> } | null = null;
let poolCache: { at: number; data: Player[] } | null = null;
let inflight: Promise<Player[]> | null = null;

async function fetchProTeams(): Promise<Map<number, TeamInfo>> {
  if (teamCache && Date.now() - teamCache.at < CACHE_MS) return teamCache.data;

  const res = await fetch(TEAMS_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ESPN proTeams ${res.status}`);
  const json = await res.json();

  const map = new Map<number, TeamInfo>();
  for (const t of json?.settings?.proTeams ?? []) {
    map.set(t.id, {
      abbrev: t.abbrev ? String(t.abbrev).toUpperCase() : 'FA',
      bye: typeof t.byeWeek === 'number' && t.byeWeek > 0 ? t.byeWeek : null,
    });
  }
  teamCache = { at: Date.now(), data: map };
  return map;
}

function statTotal(
  stats: any[],
  seasonId: number,
  statSourceId: number
): number | null {
  const row = (stats ?? []).find(
    (s) =>
      s.seasonId === seasonId &&
      s.statSourceId === statSourceId &&
      s.statSplitTypeId === 0
  );
  if (!row || typeof row.appliedTotal !== 'number') return null;
  return Math.round(row.appliedTotal * 10) / 10;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

async function fetchPool(): Promise<Player[]> {
  const teams = await fetchProTeams();

  const filter = {
    players: {
      filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
      limit: POOL_LIMIT,
      offset: 0,
      sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'PPR' },
    },
  };

  const res = await fetch(`${LEAGUE_URL}?view=kona_player_info`, {
    headers: { 'x-fantasy-filter': JSON.stringify(filter) },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`ESPN players ${res.status}`);
  const json = await res.json();

  const out: Player[] = [];
  for (const entry of json?.players ?? []) {
    const p = entry?.player;
    if (!p) continue;

    const pos = POS_MAP[p.defaultPositionId];
    if (!pos) continue; // drops D/ST and anything without a roster slot

    const team = teams.get(p.proTeamId);
    const own = p.ownership ?? {};
    const rank = p.draftRanksByRankType?.PPR?.rank;

    out.push({
      id: p.id,
      name: p.fullName ?? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim(),
      pos,
      proTeam: team?.abbrev ?? 'FA',
      bye: team?.bye ?? null,
      espnRank: num(rank),
      adp: num(own.averageDraftPosition),
      auctionValue: num(own.auctionValueAverage),
      proj2026: statTotal(p.stats, SEASON, 1),
      actual2025: statTotal(p.stats, SEASON - 1, 0),
      injuryStatus: p.injuryStatus ?? null,
      percentOwned: num(own.percentOwned),
    });
  }

  // Unranked players sort to the bottom rather than the top.
  out.sort((a, b) => (a.espnRank ?? 99999) - (b.espnRank ?? 99999));
  return out;
}

/** Cached, de-duplicated fetch of the undrafted pool. */
export async function getPlayers(force = false): Promise<Player[]> {
  if (!force && poolCache && Date.now() - poolCache.at < CACHE_MS) {
    return poolCache.data;
  }
  if (inflight) return inflight;

  inflight = fetchPool()
    .then((data) => {
      poolCache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });

  try {
    return await inflight;
  } catch (err) {
    // Serve stale data rather than breaking a live draft on a blip from ESPN.
    if (poolCache) return poolCache.data;
    throw err;
  }
}

export const espnConfig = { season: SEASON, leagueId: LEAGUE_ID, poolLimit: POOL_LIMIT };
