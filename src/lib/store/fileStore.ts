import { promises as fs } from 'fs';
import path from 'path';
import { emptyRoom, type Room } from '../types';
import type { DraftStore } from './index';

const DATA_DIR = path.join(process.cwd(), '.data');
const FILE = path.join(DATA_DIR, 'room.json');
const TMP = path.join(DATA_DIR, 'room.tmp.json');

/**
 * JSON-file backed store for local dev.
 *
 * Correct only because `next dev` is a single process: the mutex below is
 * in-process. On serverless this class does not work at all (read-only fs,
 * many instances) - that is what the Redis adapter is for.
 */
export class FileStore implements DraftStore {
  private queue: Promise<unknown> = Promise.resolve();
  private cached: Room | null = null;

  private async load(): Promise<Room> {
    if (this.cached) return this.cached;
    try {
      const raw = await fs.readFile(FILE, 'utf8');
      this.cached = JSON.parse(raw) as Room;
    } catch {
      this.cached = emptyRoom();
    }
    return this.cached;
  }

  private async persist(room: Room): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    // Write-then-rename so a crash mid-write cannot leave a truncated file.
    await fs.writeFile(TMP, JSON.stringify(room, null, 2), 'utf8');
    await fs.rename(TMP, FILE);
    this.cached = room;
  }

  async read(): Promise<Room> {
    return this.load();
  }

  /** Serializes every mutation through a single promise chain. */
  async update<T>(fn: (room: Room) => T): Promise<{ room: Room; result: T }> {
    const run = this.queue.then(async () => {
      const room = await this.load();
      const result = fn(room);
      await this.persist(room);
      return { room, result };
    });
    // Keep the chain alive even if this mutation throws.
    this.queue = run.catch(() => undefined);
    return run;
  }
}
