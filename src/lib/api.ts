import { DraftError } from './draft';

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export function fail(err: unknown) {
  if (err instanceof DraftError) return json({ error: err.message }, err.status);
  const message = err instanceof Error ? err.message : 'Unexpected error';
  return json({ error: message }, 500);
}

export async function body<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
