/**
 * Probes ESPN league IDs for ones that are publicly readable AND have a
 * completed draft, so the free-agent pool is a genuine subset of all players.
 *
 * Usage: node scripts/find-public-league.mjs [season] [count]
 */
const SEASON = Number(process.argv[2] ?? 2025);
const WANT = Number(process.argv[3] ?? 6);
const HOST = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';

const CONCURRENCY = 8;
const TIMEOUT_MS = 8000;

async function probe(id) {
  const url = `${HOST}/seasons/${SEASON}/segments/0/leagues/${id}?view=mDraftDetail&view=mSettings`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (res.status !== 200) return { id, ok: false, status: res.status };
    const j = await res.json();
    const picks = (j?.draftDetail?.picks ?? []).filter((p) => p.playerId > 0);
    return {
      id,
      ok: true,
      name: j?.settings?.name ?? '(no name)',
      size: j?.settings?.size ?? null,
      drafted: !!j?.draftDetail?.drafted,
      realPicks: picks.length,
      scoring: j?.settings?.scoringSettings?.scoringType ?? null,
    };
  } catch {
    return { id, ok: false, status: 'err' };
  } finally {
    clearTimeout(t);
  }
}

async function pool(ids, onHit) {
  let i = 0;
  const hits = [];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (i < ids.length && hits.length < WANT) {
      const id = ids[i++];
      const r = await probe(id);
      if (r.ok && r.realPicks > 0) {
        hits.push(r);
        onHit(r);
      }
    }
  });
  await Promise.all(workers);
  return hits;
}

// Sample across several magnitude bands - ESPN ids are not uniformly used.
const bands = [
  [1, 2000],
  [10_000, 60_000],
  [100_000, 400_000],
  [1_000_000, 2_000_000],
  [10_000_000, 40_000_000],
];

const ids = [];
for (const [lo, hi] of bands) {
  for (let n = 0; n < 90; n++) {
    ids.push(lo + Math.floor(Math.random() * (hi - lo)));
  }
}

console.log(`probing ${ids.length} league ids for season ${SEASON}...\n`);
const hits = await pool(ids, (r) => {
  console.log(
    `HIT ${String(r.id).padEnd(10)} picks=${String(r.realPicks).padEnd(4)} ` +
    `teams=${String(r.size).padEnd(3)} ${r.scoring ?? '?'}  ${r.name}`
  );
});

console.log(`\n${hits.length} public drafted leagues found`);
if (hits.length) {
  const best = hits.sort((a, b) => b.realPicks - a.realPicks)[0];
  console.log(`best: leagueId=${best.id} (${best.realPicks} picks, ${best.size} teams)`);
}
