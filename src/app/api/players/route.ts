import { getPlayers, espnConfig } from '@/lib/espn';
import { json, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get('refresh') === '1';
    const players = await getPlayers(force);
    return json({ players, config: espnConfig });
  } catch (err) {
    return fail(err);
  }
}
