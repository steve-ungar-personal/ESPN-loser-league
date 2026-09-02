import { getStore } from '@/lib/store';
import { toPublicRoom, drafterByToken, DraftError } from '@/lib/draft';
import { json, fail, body } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { token, paused } = await body<{ token?: string; paused?: boolean }>(req);
    if (typeof paused !== 'boolean') {
      throw new DraftError('paused must be true or false.');
    }

    const store = await getStore();
    const { room } = await store.update((r) => {
      const me = drafterByToken(r, token ?? null);
      if (!me) throw new DraftError('Unknown drafter.', 403);
      if (r.commissionerId !== me.id) {
        throw new DraftError('Only the commissioner can pause the draft.', 403);
      }
      if (r.status !== 'active') {
        throw new DraftError('Only a running draft can be paused.');
      }

      r.paused = paused;
      // Clearing the deadline is what actually stops the clock: autopick only
      // fires on an elapsed deadline, so a null deadline can never lapse.
      // Unpausing gives whoever is on the clock a full fresh timer.
      r.deadline = paused ? null : Date.now() + r.pickSeconds * 1000;
      return null;
    });

    return json({ room: toPublicRoom(room) });
  } catch (err) {
    return fail(err);
  }
}
