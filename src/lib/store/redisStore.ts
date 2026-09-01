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

/**
 * Credential env vars, in priority order. The names differ depending on how
 * Upstash was set up: signing up at upstash.com gives UPSTASH_*, while the
 * Vercel Marketplace integration has historically injected KV_REST_API_*.
 * Accept either rather than making the deploy depend on which one you got.
 */
const CREDENTIAL_PAIRS: [urlVar: string, tokenVar: string][] = [
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
  ['REDIS_REST_URL', 'REDIS_REST_TOKEN'],
];

export function resolveRedisCredentials(
  env: Record<string, string | undefined> = process.env
): { url: string; token: string; source: string } | null {
  for (const [urlVar, tokenVar] of CREDENTIAL_PAIRS) {
    const url = env[urlVar];
    const token = env[tokenVar];
    if (url && token) return { url, token, source: urlVar };
  }

  // Fallback: the Vercel Marketplace lets you choose ANY prefix, so the names
  // could be STORAGE_REST_API_URL, FOO_REST_URL, anything. Find a var whose
  // name ends in a REST url suffix and whose partner token exists.
  // Sorted for determinism when a project somehow has more than one.
  for (const key of Object.keys(env).sort()) {
    const suffix = ['_REST_API_URL', '_REST_URL'].find((s) => key.endsWith(s));
    if (!suffix) continue;

    const url = env[key];
    if (!url || !/^https?:\/\//i.test(url)) continue;

    // Same prefix, TOKEN instead of URL. Never the read-only token.
    const tokenKey = key.slice(0, -3) + 'TOKEN';
    const token = env[tokenKey];
    if (token) return { url, token, source: key };
  }
  return null;
}

/** Builds the store from env. Imported lazily so local dev never needs the dep. */
export async function createRedisStore(): Promise<RedisStore> {
  const creds = resolveRedisCredentials();
  if (!creds) {
    const names = CREDENTIAL_PAIRS.map(([u, t]) => `${u} + ${t}`).join(', or ');
    throw new Error(`DRAFT_STORE=redis needs one of these credential pairs: ${names}`);
  }
  // The REST URL is https://; a redis:// connection string will not work here.
  if (!/^https?:\/\//i.test(creds.url)) {
    throw new Error(
      `${creds.source} must be the Upstash REST URL (https://...), not a redis:// connection string.`
    );
  }
  const { Redis } = await import('@upstash/redis');
  return new RedisStore(new Redis({ url: creds.url, token: creds.token }) as unknown as RedisLike);
}
