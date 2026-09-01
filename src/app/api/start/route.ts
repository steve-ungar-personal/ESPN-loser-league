import { getStore } from '@/lib/store';
import { toPublicRoom, drafterByToken, DraftError } from '@/lib/draft';
import { json, fail, body } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { token, pickSeconds } = await body<{ token?: string; pickSeconds?: number }>(req);
    const store = await getStore();

    const { room } = await store.update((r) => {
      const me = drafterByToken(r, token ?? null);
      if (!me) throw new DraftError('Unknown drafter.', 403);
      if (r.commissionerId !== me.id) {
        throw new DraftError('Only the commissioner can start the draft.', 403);
      }
      if (r.status !== 'lobby') throw new DraftError('Draft already started.', 409);
      if (r.drafters.length < 2) {
        throw new DraftError('Need at least 2 drafters to start.');
      }

      const secs = Number(pickSeconds);
      if (Number.isFinite(secs) && secs >= 15 && secs <= 600) {
        r.pickSeconds = Math.round(secs);
      }

      // People claim any position they like in the lobby (1, 4, 9...), but
      // snake order needs a contiguous 1..N. Compress, preserving their order.
      r.drafters.sort((a, b) => a.slot - b.slot);
      r.drafters.forEach((d, i) => {
        d.slot = i + 1;
      });

      r.status = 'active';
      r.startedAt = Date.now();
      r.deadline = Date.now() + r.pickSeconds * 1000;
      return null;
    });

    return json({ room: toPublicRoom(room) });
  } catch (err) {
    return fail(err);
  }
}
