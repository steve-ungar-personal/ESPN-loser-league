import { getStore } from '@/lib/store';
import { getPlayers } from '@/lib/espn';
import { toPublicRoom, runAutopickIfExpired, drafterByToken } from '@/lib/draft';
import { json, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const token = req.headers.get('x-draft-token');
    const store = await getStore();

    // Any poll can trigger a lapsed autopick, so the draft never stalls on
    // someone who closed their laptop. The store lock keeps it single-shot.
    const players = await getPlayers();
    const byId = new Map(players.map((p) => [p.id, p]));
    const { room } = await store.update((r) => runAutopickIfExpired(r, players, byId));

    const me = drafterByToken(room, token);
    return json({ room: toPublicRoom(room), meId: me?.id ?? null });
  } catch (err) {
    return fail(err);
  }
}
