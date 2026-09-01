import type { Room } from '../types';
import { FileStore } from './fileStore';

/**
 * Everything the draft needs from storage. Swapping backends means
 * implementing these two methods, nothing else.
 *
 * `update` must be atomic: read, mutate, persist, with no interleaving.
 * That is what stops two people drafting the same player on the same tick.
 * FileStore does it with an in-process mutex (single dev process);
 * RedisStore does it with a compare-and-set (many serverless instances).
 */
export interface DraftStore {
  read(): Promise<Room>;
  update<T>(fn: (room: Room) => T): Promise<{ room: Room; result: T }>;
}

let store: DraftStore | null = null;
let pending: Promise<DraftStore> | null = null;

async function build(): Promise<DraftStore> {
  const kind = (process.env.DRAFT_STORE ?? 'file').toLowerCase();
  if (kind === 'redis') {
    const { createRedisStore } = await import('./redisStore');
    return createRedisStore();
  }
  return new FileStore();
}

export async function getStore(): Promise<DraftStore> {
  if (store) return store;
  // De-duplicate concurrent cold-start calls so we build exactly one client.
  if (!pending) {
    pending = build().then((s) => {
      store = s;
      pending = null;
      return s;
    });
  }
  return pending;
}
