import { emptyRoom, type Room } from '../types';
import type { DraftStore } from './index';

/**
 * Shared store for serverless deploys (Vercel, Cloudflare, anywhere).
 *
 * The file store's mutex is in-process, which is meaningless when every
 * request may land on a different instance. This uses optimistic concurrency
 * instead: read room + version, apply the mutation, then write back ONLY if
 * the version has not moved. A loser retries against fresh state.
 *
 * That compare-and-set is what stops two people drafting the same player on
 * the same tick.
 */

const ROOM_KEY = 'jpll:room';
const VER_KEY = 'jpll:ver';
const MAX_ATTEMPTS = 8;

/**
 * Compare-and-set. Deliberately compares a plain string version rather than
 * decoding JSON in Lua - cheaper, and no cjson dependency.
 * Returns 1 on success, 0 if someone else wrote first.
 */
const CAS_SCRIPT = `
local current = redis.call('GET', KEYS[2])
if current == false then current = '0' end
if current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  redis.call('SET', KEYS[2], ARGV[3])
  return 1
end
return 0
`;

/** The slice of the Upstash client we use. Narrow, so tests can fake it. */
export interface RedisLike {
  mget(...keys: string[]): Promise<unknown[]>;
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
}

export class ConcurrencyError extends Error {
  constructor() {
    super('Draft state changed while saving. Try again.');
  }
}

/**
 * Upstash returns JSON-looking values already parsed, plain ones as strings.
 * Accept either rather than guessing.
 */
function asRoom(raw: unknown): Room | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Room;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') return raw as Room;
  return null;
}

function asVersion(raw: unknown): string {
  if (raw === null || raw === undefined) return '0';
  return String(raw);
}

export class RedisStore implements DraftStore {
  constructor(private readonly redis: RedisLike) {}

  private async load(): Promise<{ room: Room; version: string }> {
    const [rawRoom, rawVer] = await this.redis.mget(ROOM_KEY, VER_KEY);
    return {
      room: asRoom(rawRoom) ?? emptyRoom(),
      version: asVersion(rawVer),
    };
  }

  async read(): Promise<Room> {
    return (await this.load()).room;
  }

  async update<T>(fn: (room: Room) => T): Promise<{ room: Room; result: T }> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { room, version } = await this.load();

      // Fresh copy each attempt: a retried mutation must never build on the
      // half-mutated object from the losing attempt.
      const draft: Room = structuredClone(room);

      let result: T;
      try {
        result = fn(draft);
      } catch (err) {
        // The mutation rejected. That is only a real answer if we were
        // looking at current state - a stale read can produce a spurious
        // "not your turn" when someone else's pick already advanced the
        // clock. So re-check the version: if it moved, retry against the
        // truth; if it did not, the rejection stands.
        const { version: latest } = await this.load();
        if (latest !== version) continue;
        throw err;
      }

      const next = String(Number(version) + 1);
      const won = await this.redis.eval(
        CAS_SCRIPT,
        [ROOM_KEY, VER_KEY],
        [version, JSON.stringify(draft), next]
      );

      if (Number(won) === 1) return { room: draft, result };
      // Someone else wrote first; loop and rebuild against their state.
    }
    throw new ConcurrencyError();
  }
}

/** Builds the store from env. Imported lazily so local dev never needs the dep. */
export async function createRedisStore(): Promise<RedisStore> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      'DRAFT_STORE=redis needs UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN'
    );
  }
  const { Redis } = await import('@upstash/redis');
  return new RedisStore(new Redis({ url, token }) as unknown as RedisLike);
}
