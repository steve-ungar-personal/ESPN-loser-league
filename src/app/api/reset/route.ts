import { getStore } from '@/lib/store';
import { toPublicRoom, drafterByToken, DraftError } from '@/lib/draft';
import { json, fail, body } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { token, clearDrafters } = await body<{
      token?: string;
      clearDrafters?: boolean;
    }>(req);
    const store = await getStore();

    const { room } = await store.update((r) => {
      const me = drafterByToken(r, token ?? null);
      if (!me) throw new DraftError('Unknown drafter.', 403);
      if (r.commissionerId !== me.id) {
        throw new DraftError('Only the commissioner can reset the draft.', 403);
      }

      r.picks = [];
      r.status = 'lobby';
      r.paused = false;
      r.startsAt = null;
      r.deadline = null;
      r.startedAt = null;
      if (clearDrafters) {
        r.drafters = [];
        r.commissionerId = null;
      }
      return null;
    });

    return json({ room: toPublicRoom(room) });
  } catch (err) {
    return fail(err);
  }
}
