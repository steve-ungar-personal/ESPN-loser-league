/**
 * Concurrency tests for RedisStore against a fake Redis that reproduces the
 * real compare-and-set semantics. No credentials or network needed.
 *
 * Run with: npm run test:redis
 */
import {
  RedisStore, ConcurrencyError, resolveRedisCredentials, type RedisLike,
} from './redisStore';
import { emptyRoom, type Room, type Drafter } from '../types';
import { applyPick, DraftError } from '../draft';
import type { Player } from '../types';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ' -- ' + detail : ''}`); }
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(label, JSON.stringify(actual) === JSON.stringify(expected),
     `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

/**
 * In-memory stand-in for Upstash. Only implements what RedisStore uses, but
 * the eval() path enforces the same version check the Lua script does, so a
 * stale writer loses here exactly as it would in production.
 */
class FakeRedis implements RedisLike {
  private data = new Map<string, string>();
  evalCalls = 0;
  casFailures = 0;
  /** Fires once after a read: models a writer landing before we mutate. */
  onAfterRead: (() => void) | null = null;
  /** Fires once before a CAS: models a writer landing after we mutate. */
  onBeforeCas: (() => void | Promise<void>) | null = null;

  async mget(...keys: string[]): Promise<unknown[]> {
    const out = keys.map((k) => (this.data.has(k) ? this.data.get(k)! : null));
    if (this.onAfterRead) {
      const hook = this.onAfterRead;
      this.onAfterRead = null; // fire once
      hook();
    }
    return out;
  }

  async eval(_script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    if (this.onBeforeCas) {
      const hook = this.onBeforeCas;
      this.onBeforeCas = null; // fire once
      await hook();
    }
    this.evalCalls++;
    const [roomKey, verKey] = keys;
    const [expected, payload, next] = args.map(String);
    const current = this.data.get(verKey) ?? '0';
    if (current !== expected) { this.casFailures++; return 0; }
    this.data.set(roomKey, payload);
    this.data.set(verKey, next);
    return 1;
  }

  /** Write directly, simulating another instance that already committed. */
  forceWrite(room: Room) {
    const v = Number(this.data.get('jpll:ver') ?? '0') + 1;
    this.data.set('jpll:room', JSON.stringify(room));
    this.data.set('jpll:ver', String(v));
  }
  raw() {
    const r = this.data.get('jpll:room');
    return r ? (JSON.parse(r) as Room) : null;
  }
}

// ---------- fixtures ----------

function mkPlayer(id: number, pos: Player['pos'], rank: number): Player {
  return { id, name: `${pos}${id}`, pos, proTeam: 'XX', bye: 9, espnRank: rank,
    adp: rank, auctionValue: 1, proj2026: 100, actual2025: 100,
    injuryStatus: 'ACTIVE', percentOwned: 50 };
}
const players: Player[] = [
  mkPlayer(1, 'RB', 1), mkPlayer(2, 'RB', 2), mkPlayer(3, 'WR', 3),
  mkPlayer(4, 'WR', 4), mkPlayer(5, 'QB', 5), mkPlayer(6, 'K', 6),
];
const byId = new Map(players.map((p) => [p.id, p]));

function activeRoom(n = 2): Room {
  const room = emptyRoom();
  room.drafters = Array.from({ length: n }, (_, i): Drafter => ({
    id: `d${i + 1}`, name: `D${i + 1}`, slot: i + 1, token: `t${i + 1}`, joinedAt: 1,
  }));
  room.commissionerId = 'd1';
  room.status = 'active';
  room.deadline = Date.now() + 90_000;
  return room;
}

const run = async () => {
  console.log('\nbasic read/write');
  {
    const fake = new FakeRedis();
    const store = new RedisStore(fake);

    const fresh = await store.read();
    eq('empty backend reads as a fresh lobby', fresh.status, 'lobby');
    eq('...with no drafters', fresh.drafters.length, 0);

    await store.update((r) => { r.pickSeconds = 45; });
    eq('write persisted', (await store.read()).pickSeconds, 45);

    const { result } = await store.update((r) => r.pickSeconds * 2);
    eq('update returns the callback result', result, 90);
  }

  console.log('\nmutation isolation');
  {
    const fake = new FakeRedis();
    const store = new RedisStore(fake);
    await store.update((r) => { Object.assign(r, activeRoom()); });

    // A throwing mutation must not be persisted.
    const before = JSON.stringify(await store.read());
    try {
      await store.update((r) => {
        r.pickSeconds = 999;
        throw new DraftError('nope');
      });
    } catch { /* expected */ }
    eq('a throwing mutation writes nothing', JSON.stringify(await store.read()), before);
  }

  console.log('\ncompare-and-set under conflict');
  {
    const fake = new FakeRedis();
    const store = new RedisStore(fake);
    await store.update((r) => { Object.assign(r, activeRoom()); });

    // After we mutate but before we commit, another instance takes player 1.
    fake.onBeforeCas = () => {
      const theirs = fake.raw()!;
      applyPick(theirs, 'd1', 1, byId, false);
      fake.forceWrite(theirs);
    };

    // d1 (whose turn it is on our stale copy) also grabs player 1. Our CAS
    // must lose, and the retry must then reject us.
    let error: string | null = null;
    try {
      await store.update((r) => applyPick(r, 'd1', 1, byId, false));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    ok('the stale write lost the CAS', fake.casFailures === 1,
       `casFailures=${fake.casFailures}`);
    ok('the duplicate was rejected on retry',
       error !== null && /(already drafted|not your turn)/i.test(error),
       `error=${error}`);

    const final = await store.read();
    eq('exactly one pick was committed', final.picks.length, 1);
    eq('no player drafted twice', new Set(final.picks.map((p) => p.playerId)).size, 1);
  }

  console.log('\nstale read must not produce a spurious rejection');
  {
    const fake = new FakeRedis();
    const store = new RedisStore(fake);
    await store.update((r) => { Object.assign(r, activeRoom()); });

    // d1 commits BETWEEN our read and our mutation. Our stale copy still says
    // it is d1's turn, so a d2 pick looks illegal - but against real state it
    // is perfectly legal, and must succeed after the retry.
    fake.onAfterRead = () => {
      const theirs = fake.raw()!;
      applyPick(theirs, 'd1', 1, byId, false);
      fake.forceWrite(theirs);
    };

    await store.update((r) => applyPick(r, 'd2', 3, byId, false));

    const final = await store.read();
    eq('both picks landed', final.picks.length, 2);
    eq('order is d1 then d2', final.picks.map((p) => p.drafterId), ['d1', 'd2']);
    eq('overall numbers are sequential', final.picks.map((p) => p.overall), [1, 2]);
  }

  console.log('\ngenuine rejection still propagates');
  {
    const fake = new FakeRedis();
    const store = new RedisStore(fake);
    await store.update((r) => { Object.assign(r, activeRoom()); });
    await store.update((r) => applyPick(r, 'd1', 1, byId, false));

    // No interference this time: d2 going after a taken player is simply wrong.
    let error: string | null = null;
    try {
      await store.update((r) => applyPick(r, 'd2', 1, byId, false));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    ok('duplicate pick rejected with the real reason',
       error !== null && /already drafted/i.test(error), `error=${error}`);
    eq('nothing extra was written', (await store.read()).picks.length, 1);
  }

  console.log('\ngives up rather than spinning forever');
  {
    const fake = new FakeRedis();
    const store = new RedisStore(fake);
    await store.update((r) => { r.pickSeconds = 30; });

    // Bump the version before every single CAS: the writer can never win.
    const original = fake.eval.bind(fake);
    fake.eval = async (s, k, a) => {
      fake.forceWrite(fake.raw() ?? emptyRoom());
      return original(s, k, a);
    };

    let threw: unknown = null;
    try { await store.update((r) => { r.pickSeconds = 31; }); }
    catch (e) { threw = e; }
    ok('throws ConcurrencyError after max attempts', threw instanceof ConcurrencyError);
  }

  console.log('\ncredential resolution');
  {
    eq('picks up the upstash.com names',
      resolveRedisCredentials({
        UPSTASH_REDIS_REST_URL: 'https://a.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't',
      })?.source, 'UPSTASH_REDIS_REST_URL');

    eq('picks up the Vercel Marketplace KV names',
      resolveRedisCredentials({
        KV_REST_API_URL: 'https://b.upstash.io', KV_REST_API_TOKEN: 't',
      })?.source, 'KV_REST_API_URL');

    eq('prefers UPSTASH_* when both are present',
      resolveRedisCredentials({
        UPSTASH_REDIS_REST_URL: 'https://a.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't',
        KV_REST_API_URL: 'https://b.upstash.io', KV_REST_API_TOKEN: 't',
      })?.source, 'UPSTASH_REDIS_REST_URL');

    eq('nothing set resolves to null', resolveRedisCredentials({}), null);
    eq('a url with no token is not enough',
      resolveRedisCredentials({ UPSTASH_REDIS_REST_URL: 'https://a.upstash.io' }), null);

    // The Vercel Marketplace lets you pick any prefix, so discovery must not
    // depend on knowing the name up front.
    eq('discovers an arbitrary custom prefix',
      resolveRedisCredentials({
        STORAGE_REST_API_URL: 'https://c.upstash.io', STORAGE_REST_API_TOKEN: 't',
      })?.source, 'STORAGE_REST_API_URL');

    eq('discovers a shorter _REST_URL variant',
      resolveRedisCredentials({
        LOSER_REST_URL: 'https://d.upstash.io', LOSER_REST_TOKEN: 't',
      })?.source, 'LOSER_REST_URL');

    // A redis:// connection string sits alongside the REST pair; ignore it.
    eq('ignores the redis:// connection string var',
      resolveRedisCredentials({
        STORAGE_URL: 'redis://default:pw@c.upstash.io:6379',
        STORAGE_REST_API_URL: 'https://c.upstash.io',
        STORAGE_REST_API_TOKEN: 't',
      })?.source, 'STORAGE_REST_API_URL');

    eq('does not settle for only a read-only token',
      resolveRedisCredentials({
        STORAGE_REST_API_URL: 'https://c.upstash.io',
        STORAGE_REST_API_READ_ONLY_TOKEN: 'ro',
      }), null);

    eq('explicit names still win over discovery',
      resolveRedisCredentials({
        STORAGE_REST_API_URL: 'https://c.upstash.io', STORAGE_REST_API_TOKEN: 't',
        UPSTASH_REDIS_REST_URL: 'https://a.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't',
      })?.source, 'UPSTASH_REDIS_REST_URL');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
};

run().catch((e) => { console.error(e); process.exit(1); });
