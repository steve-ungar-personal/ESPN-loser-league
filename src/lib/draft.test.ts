/**
 * Rule tests for the draft engine. Pure logic, no server or network.
 * Run with: npm test
 */
import { emptyRoom, type Player, type Room, type Drafter } from './types';
import { slotOnClock, totalPicks } from './snake';
import { countRoster, hasRoomFor, ROSTER_SIZE, START_DELAY_SECONDS } from './roster';
import { applyPick, runAutopickIfExpired, onClockDrafter, DraftError } from './draft';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ' -- ' + detail : ''}`);
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(label, a === e, `got ${a}, expected ${e}`);
}

function throws(label: string, fn: () => void, expectMatch?: RegExp) {
  try {
    fn();
    failed++;
    console.log(`  FAIL  ${label} -- expected a throw, got none`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (expectMatch && !expectMatch.test(msg)) {
      failed++;
      console.log(`  FAIL  ${label} -- threw "${msg}", expected /${expectMatch.source}/`);
    } else {
      passed++;
      console.log(`  PASS  ${label} (${msg})`);
    }
  }
}

// ---------- fixtures ----------

function mkPlayer(id: number, pos: Player['pos'], rank: number): Player {
  return {
    id, name: `${pos}${id}`, pos, proTeam: 'XX', bye: 9,
    espnRank: rank, adp: rank, auctionValue: 1,
    proj2026: 100, actual2025: 100, injuryStatus: 'ACTIVE', percentOwned: 50,
  };
}

// Deep pool so autopick always has something legal at every position.
const players: Player[] = [];
let pid = 1;
let rank = 1;
for (let i = 0; i < 12; i++) {
  players.push(mkPlayer(pid++, 'QB', rank++));
  players.push(mkPlayer(pid++, 'RB', rank++));
  players.push(mkPlayer(pid++, 'WR', rank++));
  players.push(mkPlayer(pid++, 'TE', rank++));
  players.push(mkPlayer(pid++, 'K', rank++));
}
players.sort((a, b) => (a.espnRank ?? 0) - (b.espnRank ?? 0));
const byId = new Map(players.map((p) => [p.id, p]));

function mkRoom(n: number): Room {
  const room = emptyRoom();
  room.drafters = Array.from({ length: n }, (_, i): Drafter => ({
    id: `d${i + 1}`, name: `Drafter ${i + 1}`, slot: i + 1,
    token: `t${i + 1}`, joinedAt: Date.now(),
  }));
  room.commissionerId = 'd1';
  room.status = 'active';
  room.startedAt = Date.now();
  room.deadline = Date.now() + 90_000;
  return room;
}

/** First available player of a position that is not yet taken. */
function pickIdFor(room: Room, pos: Player['pos']): number {
  const taken = new Set(room.picks.map((p) => p.playerId));
  const p = players.find((x) => x.pos === pos && !taken.has(x.id));
  if (!p) throw new Error(`fixture exhausted for ${pos}`);
  return p.id;
}

// ---------- snake order ----------

console.log('\nsnake order');
{
  const n = 3;
  const seq = Array.from({ length: 9 }, (_, i) => slotOnClock(i, n));
  eq('3 drafters, first 9 picks snake 1-2-3-3-2-1-1-2-3', seq, [1, 2, 3, 3, 2, 1, 1, 2, 3]);
  eq('10 drafters -> 70 total picks', totalPicks(10), 70);
  eq('roster size is 7', ROSTER_SIZE, 7);
  eq('round 2 reverses for 10 drafters', slotOnClock(10, 10), 10);
  eq('round 3 restarts at slot 1', slotOnClock(20, 10), 1);
}

// ---------- turn enforcement ----------

console.log('\nturn enforcement');
{
  const room = mkRoom(3);
  eq('slot 1 is on the clock first', onClockDrafter(room)?.id, 'd1');

  throws(
    'drafter 2 cannot pick on drafter 1 turn',
    () => applyPick(room, 'd2', pickIdFor(room, 'RB'), byId, false),
    /not your turn/i
  );

  applyPick(room, 'd1', pickIdFor(room, 'RB'), byId, false);
  eq('after pick 1, slot 2 is up', onClockDrafter(room)?.id, 'd2');

  throws(
    'unknown drafter is rejected',
    () => applyPick(room, 'ghost', pickIdFor(room, 'RB'), byId, false),
    /unknown drafter/i
  );

  const dupe = room.picks[0].playerId;
  applyPick(room, 'd2', pickIdFor(room, 'WR'), byId, false);
  throws(
    'a drafted player cannot be taken again',
    () => applyPick(room, 'd3', dupe, byId, false),
    /already drafted/i
  );

  throws(
    'a player outside the pool is rejected',
    () => applyPick(room, 'd3', 999999, byId, false),
    /not in the available pool/i
  );
}

// ---------- roster limits ----------

console.log('\nroster limits (1 QB / 2 RB / 3 TE-WR / 1 K)');
{
  const room = mkRoom(1); // solo room makes it always this drafter's turn
  const me = 'd1';

  applyPick(room, me, pickIdFor(room, 'RB'), byId, false);
  applyPick(room, me, pickIdFor(room, 'RB'), byId, false);
  throws(
    'third RB is blocked (limit 2)',
    () => applyPick(room, me, pickIdFor(room, 'RB'), byId, false),
    /RB slots are already full/i
  );

  applyPick(room, me, pickIdFor(room, 'QB'), byId, false);
  throws(
    'second QB is blocked (limit 1)',
    () => applyPick(room, me, pickIdFor(room, 'QB'), byId, false),
    /QB slots are already full/i
  );

  // WR and TE share one 3-slot pool.
  applyPick(room, me, pickIdFor(room, 'WR'), byId, false);
  applyPick(room, me, pickIdFor(room, 'TE'), byId, false);
  applyPick(room, me, pickIdFor(room, 'WR'), byId, false);

  const counts = countRoster(room.picks, me, byId);
  eq('TE and WR both consumed the shared pool', counts.TEWR, 3);
  ok('a 4th WR no longer fits', !hasRoomFor('WR', counts));
  ok('a 4th TE no longer fits either', !hasRoomFor('TE', counts));
  ok('K still fits', hasRoomFor('K', counts));

  // Six legal picks so far (the two rejected ones never counted). The kicker
  // is the 7th and last slot, so completion should trip exactly here.
  eq('still active with one slot open', room.status, 'active');
  applyPick(room, me, pickIdFor(room, 'K'), byId, false);

  eq('room completed after 7 picks', room.status, 'complete');
  eq('deadline cleared on completion', room.deadline, null);
  throws(
    'no picks accepted once complete',
    () => applyPick(room, me, pickIdFor(room, 'K'), byId, false),
    /not running/i
  );
}

// ---------- autopick ----------

console.log('\nopening grace period');
{
  const room = mkRoom(3);
  // Exactly what the start route does.
  room.startsAt = Date.now() + START_DELAY_SECONDS * 1000;
  room.deadline = room.startsAt + room.pickSeconds * 1000;

  eq('grace is 10 seconds', START_DELAY_SECONDS, 10);

  throws(
    'the first drafter cannot pick during the grace period',
    () => applyPick(room, 'd1', pickIdFor(room, 'RB'), byId, false),
    /starts in \d+s/i
  );

  eq('autopick cannot fire during the grace period',
    runAutopickIfExpired(room, players, byId), null);

  ok('the first clock is a full pick length after the grace, not shortened',
    room.deadline - room.startsAt === room.pickSeconds * 1000);

  // Grace elapsed.
  room.startsAt = Date.now() - 1;
  const pick = applyPick(room, 'd1', pickIdFor(room, 'RB'), byId, false);
  eq('drafting works once the grace has passed', pick.overall, 1);
  eq('and it is still slot 1 on the clock', pick.slot, 1);
}

console.log('\npause');
{
  const room = mkRoom(3);

  // Pausing is modelled the way the route does it: flag set, clock cleared.
  room.paused = true;
  room.deadline = null;

  throws(
    'nobody can draft while paused',
    () => applyPick(room, 'd1', pickIdFor(room, 'RB'), byId, false),
    /paused/i
  );

  eq('autopick never fires while paused',
    runAutopickIfExpired(room, players, byId), null);

  // Even with an expired deadline left behind, a paused room must not autopick.
  room.deadline = Date.now() - 5000;
  eq('an expired clock cannot autopick a paused draft',
    runAutopickIfExpired(room, players, byId), null);
  eq('no picks were made while paused', room.picks.length, 0);

  // Unpausing restores a FULL clock, not whatever was left.
  room.paused = false;
  room.deadline = Date.now() + room.pickSeconds * 1000;
  const remaining = Math.round((room.deadline - Date.now()) / 1000);
  eq('unpause resets the clock to the maximum', remaining, room.pickSeconds);

  const pick = applyPick(room, 'd1', pickIdFor(room, 'RB'), byId, false);
  eq('drafting works again after unpause', pick.overall, 1);
  eq('the clock still belonged to slot 1', pick.slot, 1);
}

console.log('\nautopick');
{
  const room = mkRoom(3);

  eq('no autopick while the clock is still running',
    runAutopickIfExpired(room, players, byId), null);

  room.deadline = Date.now() - 1;
  const auto = runAutopickIfExpired(room, players, byId);
  ok('autopick fired once the clock expired', auto !== null);
  eq('autopick was charged to the drafter on the clock', auto?.drafterId, 'd1');
  ok('autopick is flagged as automatic', auto?.auto === true);
  eq('autopick took the best-ranked player', auto?.playerId, players[0].id);
  ok('a fresh deadline was set for the next drafter',
    room.deadline !== null && room.deadline > Date.now());

  eq('clock moved on to slot 2', onClockDrafter(room)?.id, 'd2');
}

// ---------- autopick respects roster limits ----------

console.log('\nautopick respects roster limits');
{
  const room = mkRoom(1);
  const me = 'd1';
  // Fill both RB slots so autopick must skip every remaining RB.
  applyPick(room, me, pickIdFor(room, 'RB'), byId, false);
  applyPick(room, me, pickIdFor(room, 'RB'), byId, false);

  room.deadline = Date.now() - 1;
  const auto = runAutopickIfExpired(room, players, byId);
  ok('autopick made a pick', auto !== null);
  const chosen = byId.get(auto!.playerId)!;
  ok(`autopick skipped RB and took a ${chosen.pos}`, chosen.pos !== 'RB');
}

// ---------- full draft ----------

console.log('\nfull draft to completion');
{
  const room = mkRoom(4);
  const want = totalPicks(4); // 4 x 7 = 28
  let guard = 0;
  while (room.status === 'active' && guard++ < 200) {
    room.deadline = Date.now() - 1;
    if (!runAutopickIfExpired(room, players, byId)) break;
  }
  eq('every pick was made', room.picks.length, want);
  eq('draft reports complete', room.status, 'complete');

  const ids = room.picks.map((p) => p.playerId);
  eq('no player was drafted twice', new Set(ids).size, ids.length);

  for (const d of room.drafters) {
    const c = countRoster(room.picks, d.id, byId);
    eq(`${d.name} roster is legal`, [c.QB, c.RB, c.TEWR, c.K], [1, 2, 3, 1]);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
