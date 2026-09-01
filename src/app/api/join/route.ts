import { randomUUID } from 'crypto';
import { getStore } from '@/lib/store';
import { toPublicRoom, DraftError } from '@/lib/draft';
import { json, fail, body } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { name, slot } = await body<{ name?: string; slot?: number }>(req);
    const clean = (name ?? '').trim();

    if (clean.length < 1 || clean.length > 24) {
      throw new DraftError('Name must be 1-24 characters.');
    }
    const wanted = Number(slot);
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > 32) {
      throw new DraftError('Pick a draft position between 1 and 32.');
    }

    const store = await getStore();
    const { result } = await store.update((room) => {
      if (room.status !== 'lobby') {
        throw new DraftError('The draft has already started.', 409);
      }
      if (room.drafters.some((d) => d.name.toLowerCase() === clean.toLowerCase())) {
        throw new DraftError('That name is taken.', 409);
      }
      if (room.drafters.some((d) => d.slot === wanted)) {
        throw new DraftError(`Draft position ${wanted} is taken.`, 409);
      }

      const drafter = {
        id: randomUUID(),
        name: clean,
        slot: wanted,
        token: randomUUID(),
        joinedAt: Date.now(),
      };
      room.drafters.push(drafter);
      // First person through the door runs the draft.
      if (!room.commissionerId) room.commissionerId = drafter.id;
      return drafter;
    });

    const room = await store.read();
    return json({
      token: result.token,
      me: { id: result.id, name: result.name, slot: result.slot },
      room: toPublicRoom(room),
    });
  } catch (err) {
    return fail(err);
  }
}
