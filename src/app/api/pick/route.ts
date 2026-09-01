import { getStore } from '@/lib/store';
import { getPlayers } from '@/lib/espn';
import {
  applyPick,
  toPublicRoom,
  drafterByToken,
  runAutopickIfExpired,
  DraftError,
} from '@/lib/draft';
import { json, fail, body } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { token, playerId } = await body<{ token?: string; playerId?: number }>(req);
    const id = Number(playerId);
    if (!Number.isInteger(id)) throw new DraftError('Missing playerId.');

    const players = await getPlayers();
    const byId = new Map(players.map((p) => [p.id, p]));
    const store = await getStore();

    const { room, result } = await store.update((r) => {
      const me = drafterByToken(r, token ?? null);
      if (!me) throw new DraftError('Unknown drafter.', 403);

      // Settle any lapsed clock first, so a stale tab cannot pick into a turn
      // that has already been auto-drafted away.
      runAutopickIfExpired(r, players, byId);

      return applyPick(r, me.id, id, byId, false);
    });

    return json({ pick: result, room: toPublicRoom(room) });
  } catch (err) {
    return fail(err);
  }
}
