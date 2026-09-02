# Juan Pena Memorial Loser League

A side draft run from the players still **undrafted in an ESPN fantasy football
league**. Everyone joins with a name and a draft position, then snake-drafts a
7-player roster from the ESPN free-agent pool.

## Running it

```bash
npm install
npm run dev        # http://localhost:3737
```

Port 3737 is deliberate — 3000 is used by another project on this machine.

```bash
npm test           # draft rule tests (no server needed)
npm run test:redis # RedisStore concurrency tests (fake Redis, no credentials)
npm run test:all   # both
npm run typecheck  # tsc --noEmit
node scripts/sim-draft.mjs 4   # drives a full draft against a running server
```

## Roster

1 QB · 2 RB · 3 TE/WR · 1 K = **7 rounds**.

The three TE/WR slots are a **shared pool** — 3 WR and 0 TE is legal, so is
1 TE + 2 WR. Once a position's slots are full, those players gray out and their
Draft buttons go dead. The **Hide drafted positions** checkbox next to the
position filters removes them from the list entirely instead of dimming them.

## Rules the server enforces

Validation lives on the server, so a forged request can't cheat:

- **Turn lock** — the pick route recomputes whose turn it is from the pick
  count. Picking out of turn returns 409.
- **No double-drafting** — a player already taken is rejected.
- **Roster limits** — a pick that would overflow a slot is rejected.
- **Autopick** — each pick has a deadline stored *server-side*, so browser
  clocks can't be gamed. When it lapses, the best available player who fits an
  open slot is drafted automatically. Any client's poll can trigger it, and the
  store lock makes it fire exactly once.
- **Snake order** — odd rounds run slot 1→N, even rounds N→1.

Lobby positions get **compressed on start**: if three people claim 1, 5 and 9,
they become 1, 2 and 3 in that order.

## Where the data comes from

ESPN's v3 fantasy API, unauthenticated — the source league is public, so no
cookies or tokens are involved.

| Field | Source |
|---|---|
| Undrafted pool | `kona_player_info` filtered to `FREEAGENT` + `WAIVERS` |
| ESPN rank (default sort) | `draftRanksByRankType.PPR.rank` |
| ADP, auction value, % rostered | `ownership` |
| 2026 projected points | `stats` where seasonId 2026, statSourceId 1, split 0 |
| 2025 actual points | `stats` where seasonId 2025, statSourceId 0, split 0 |
| NFL team + bye week | `proTeamSchedules_wl` |

D/ST is dropped — there's no roster slot for it. The pool is cached 15 minutes;
on an ESPN error the last good pool is served rather than breaking a live draft.

### Changing the source league

Three steps - the env var alone is not enough:

1. Change `ESPN_LEAGUE_ID` (Vercel: Settings -> Environment Variables -> Production).
2. **Redeploy.** Running functions keep the old value until a new deployment.
3. **Reset the draft room.** Picks store player ids from the old league's pool;
   against a different league those ids may not resolve, so picks render
   without names and roster counts go wrong.

Before trusting a new league, check it has a real QB slot (slot 0, not TQB
slot 1), a K slot, and enough free agents per position for your draft size.

### Source leagues (all public, no auth)

```
ESPN_LEAGUE_ID=271475       # West Hills FFL
ESPN_SEASON=2026
DRAFT_STORE=file
```

| League | Id | State | Notes |
|---|---|---|---|
| West Hills FFL | `271475` | **2026 draft complete, 215 picks** | 12 teams, standard QB/RB/WR/TE/K, PPR ranks. Best available is Malik Willis - a realistic leftovers pool. **Default.** |
| Test 2026 Claude League | `1005162176` | not drafted | Every star still available; good for checking the pool loads, useless for testing scarcity. |
| Forever 49 | `398886` | drafted | **Do not use.** Uses TQB (team quarterback), so it has zero individual QB free agents and a draft can never fill its QB slot. |

Public leagues with completed drafts are findable with
`node scripts/find-public-league.mjs 2026 8` - low league ids (under ~2000) are
almost all publicly readable.

Two things to check before trusting a new source league: its `lineupSlotCounts`
must include real QB (slot 0, not TQB slot 1) and K, and the free-agent pool
must have enough depth per position for your draft.

To point at your own league (84508) it must first be made readable — either
turn on *Make League Viewable to Public* in ESPN's LM tools, or add
`espn_s2` / `SWID` cookie auth to `src/lib/espn.ts`.

## Storage

State sits behind `DraftStore` (`src/lib/store/index.ts`) — two methods,
`read` and an atomic `update`. That atomicity is what stops two people
drafting the same player on the same tick.

`FileStore` writes `.data/room.json` and is **local-dev only**. It is correct
only because `next dev` is a single process; its lock is in-process. It will
not work on serverless (read-only filesystem, many instances).

> Note: the file store keeps the room in memory. Deleting `room.json` while the
> server is running does nothing — reset through the UI, or restart the server.

`RedisStore` (`src/lib/store/redisStore.ts`) is the deployed backend. It cannot
use an in-process lock, so it uses **optimistic concurrency**: read room +
version, mutate, then write back through a Lua compare-and-set that only
commits if the version has not moved. A loser retries against fresh state.

Two subtleties it handles, both caught by tests:

- A rejected mutation is only final if we were looking at current state. A
  stale read can produce a spurious "not your turn" when someone else's pick
  already advanced the clock, so on rejection it re-checks the version and
  retries if the state moved.
- Retries always re-clone from fresh state, never build on the half-mutated
  object from a losing attempt.

After `MAX_ATTEMPTS` it throws `ConcurrencyError` rather than spinning.

## Push-to-deploy (without linking GitHub to Vercel)

Vercel allows only ONE Vercel account per GitHub account, and connecting a
second one silently unlinks the first - breaking its deployments. So this repo
deploys through a GitHub Action instead: Vercel only ever sees a deploy token
and never learns the GitHub account exists.

`.github/workflows/deploy.yml` runs typecheck + both test suites, then deploys.
A red build never ships.

Add three repository secrets (Settings -> Secrets and variables -> Actions):

| Secret | Where it comes from |
|---|---|
| `VERCEL_TOKEN` | vercel.com -> Account Settings -> Tokens -> Create |
| `VERCEL_ORG_ID` | `.vercel/project.json` -> `orgId` |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` -> `projectId` |

`.vercel/` is gitignored, so read those two ids locally rather than expecting
them in the repo. After that, `git push` to `main` deploys to production, and
the Actions tab has a manual "Run workflow" button.

## Getting the data out

Once the draft finishes, three export links appear in the header. They also
work any time via URL:

| URL | What you get |
|---|---|
| `/api/export?format=rosters` | One row per team, one column per roster slot, plus `total_proj_2026`. The human-readable result. |
| `/api/export?format=picks` | One row per pick in draft order with the full stat line (rank, ADP, auction value, projection, 2025 actual, bye, injury). |
| `/api/export?format=json` | Everything structured, players resolved inline. |

Both CSVs send `Content-Disposition: attachment`, so they download with a
dated filename. Drafter tokens are stripped from every export.

Sample `rosters` output:

```
draft_slot,drafter,filled,QB_1,RB_1,RB_2,TE_WR_1,TE_WR_2,TE_WR_3,K_1,total_proj_2026
1,Steve,7/7,Kyler Murray (QB MIN),Jaylen Wright (RB MIA),...,Nick Folk (K ATL),826.6
```

The draft state also lives in `.data/room.json` locally (or the `jpll:room`
key in Redis when deployed), but the export endpoint is the supported way to
read it - it resolves player ids to names and stats.

## Deploying (free)

**Vercel Hobby limits are per-account, not per-project** - 100 GB transfer,
1M invocations, 1M edge requests and 4 CPU-hours of Fluid Active CPU are
shared by every project on the account. To keep this off another project's
allowance entirely, deploy from a **separate Vercel account** (different
email), which gets its own full quota.

ESPN's API serves datacenter IPs fine (verified from a non-residential host),
so unlike some sources this needs no residential egress.

1. Create the new Vercel account and a free Upstash Redis database.
2. Push this repo to GitHub, import it into the new Vercel account.
3. Set environment variables: `ESPN_LEAGUE_ID`, `ESPN_SEASON`,
   `DRAFT_STORE=redis`, and the Upstash REST credentials. Both namings are
   accepted - `UPSTASH_REDIS_REST_URL`/`_TOKEN` from an upstash.com signup, or
   `KV_REST_API_URL`/`_TOKEN` from the Vercel Marketplace integration - so it
   works whichever way Upstash was added.
4. Deploy. Free `*.vercel.app` domain.

### Measured cost

CPU per request, measured against a real production build (`next build` +
`next start`), not estimated:

| Route | CPU | Payload |
|---|---|---|
| `/api/state` | **6.46 ms** | 6.7 KB |
| `/api/players` | 3.91 ms | 154 KB (cached 15 min) |
| page load | 2.73 ms | - |

Dev mode costs ~40 ms/request; ignore it, production is 6x cheaper.

One full draft (10 drafters, 90 minutes, all tabs open the whole time):

| | Usage | Free allowance | |
|---|---|---|---|
| Invocations | ~27,000 | 1,000,000 / mo | 2.7% |
| Active CPU | ~0.05 CPU-hr | 4 CPU-hr / mo | **1.2%** |
| Bandwidth | ~186 MB | 100 GB / mo | 0.2% |
| Redis commands | ~27,000 | 500,000 / mo | 5% |

### Why polling is gated

An idle open tab, not the draft, is the thing that could actually burn the
allowance. One tab left open for a month at 2s polling would be ~1.3M requests
and ~2.3 CPU-hours - over the invocation limit and 58% of the CPU allowance,
for a draft nobody is even running.

So `src/app/page.tsx` gates polling three ways:

- **nothing at all** while `document.hidden`
- **nothing at all** once the draft is `complete` - every roster is full, so
  the state cannot change on its own
- 2s while `active`, 10s in the lobby
- immediate refresh on `visibilitychange`, so returning to a tab feels instant

Verified in a browser: 0 requests in 12s hidden, 7 in 12s visible, and 0 in
14s on a completed draft with the page visible.

One consequence worth knowing: because a finished draft stops polling, if the
commissioner hits Reset afterwards, other browsers will not notice until
someone reloads. Cloudflare Workers is a viable
alternative (100k req/day free, and `@opennextjs/cloudflare` supports Next
16.3.3+) if you would rather not run two Vercel accounts.

## Layout

```
src/lib/espn.ts        ESPN fetch + normalize, 15-min cache
src/lib/draft.ts       turn lock, pick validation, autopick
src/lib/roster.ts      slot limits, TE/WR shared pool
src/lib/snake.ts       snake order math
src/lib/store/         DraftStore interface + FileStore (dev) and RedisStore (deployed)
src/app/api/           players, state, join, start, pick, reset
src/components/        JoinScreen, Lobby, RosterPanel, TeamsPanel, PlayerTable
```

## UI notes

- **Responsive down to phones.** Panels stack under 1100px, the roster/teams
  pair goes single-column under 640px, and the stats table scrolls sideways
  with the **Draft button pinned to the left edge** so it stays reachable.
- Inputs are 16px so iOS does not zoom on focus.
- **All teams** sits beside your roster and highlights whoever is on the clock.
- **Recent picks** shows 5 rows, then scrolls.

## Known gaps

- **Identity is a name in `localStorage`.** No password. Anyone can claim any
  free name, and clearing browser data loses your seat. Fine for a trusted
  group; add a PIN if that changes.
- **Polling every 2s**, not websockets. Fine at this scale.
- **The ESPN pool is a snapshot.** If the real ESPN draft runs while this app
  is live, newly-drafted players leave the pool within 15 minutes.
