import { getStore } from '@/lib/store';
import { toPublicRoom, drafterByToken, DraftError } from '@/lib/draft';
import { MIN_PICK_SECONDS, MAX_PICK_SECONDS } from '@/lib/roster';
import { json, fail, body } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    // pickSeconds arrives as a number normally, but an emptied number input
    // sends '' - accept both so the check below can reject it properly.
    const { token, pickSeconds } = await body<{
      token?: string;
      pickSeconds?: number | string;
    }>(req);
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

      // Reject an out-of-range timer rather than silently keeping the default -
      // entering 5 and getting 1:30 with no explanation is worse than an error.
      if (pickSeconds !== undefined && pickSeconds !== null && pickSeconds !== '') {
        const secs = Number(pickSeconds);
        if (!Number.isFinite(secs) || secs < MIN_PICK_SECONDS || secs > MAX_PICK_SECONDS) {
          throw new DraftError(
            `Seconds per pick must be between ${MIN_PICK_SECONDS} and ${MAX_PICK_SECONDS}.`
          );
        }
        r.pickSeconds = Math.round(secs);
      }

      // People claim any position they like in the lobby (1, 4, 9...), but
      // snake order needs a contiguous 1..N. Compress, preserving their order.
      r.drafters.sort((a, b) => a.slot - b.slot);
      r.drafters.forEach((d, i) => {
        d.slot = i + 1;
      });

      r.status = 'active';
      r.paused = false;
      r.startedAt = Date.now();
      r.deadline = Date.now() + r.pickSeconds * 1000;
      return null;
    });

    return json({ room: toPublicRoom(room) });
  } catch (err) {
    return fail(err);
  }
}
