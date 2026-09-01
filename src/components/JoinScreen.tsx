'use client';
import { useState } from 'react';
import type { PublicRoom } from '@/lib/types';

export default function JoinScreen({
  room, onJoin, busy, error,
}: {
  room: PublicRoom | null;
  onJoin: (name: string, slot: number) => void;
  busy: boolean;
  error: string | null;
}) {
  const [name, setName] = useState('');
  const [slot, setSlot] = useState(1);

  const taken = new Set((room?.drafters ?? []).map((d) => d.slot));
  const started = room?.status !== 'lobby';

  return (
    <div className="panel stack" style={{ maxWidth: 460, margin: '48px auto' }}>
      <h1>Juan Pena Memorial Loser League</h1>
      <p className="note">
        Draft from the players still undrafted in the ESPN league.
        Enter your name and the draft position you want.
      </p>

      {started ? (
        <div className="err">
          The draft has already started, so no new drafters can join.
        </div>
      ) : (
        <>
          <label className="field">
            Your name
            <input
              value={name}
              maxLength={24}
              placeholder="e.g. Steve"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onJoin(name, slot); }}
            />
          </label>

          <label className="field">
            Draft position
            <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
              {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n} disabled={taken.has(n)}>
                  {n}{taken.has(n) ? ' — taken' : ''}
                </option>
              ))}
            </select>
          </label>

          <p className="note">
            Gaps get closed when the draft starts — if only 3 people join at
            positions 1, 5 and 9, they become 1, 2 and 3 in that order.
          </p>

          {error && <div className="err">{error}</div>}

          <button className="primary" disabled={busy || !name.trim()} onClick={() => onJoin(name, slot)}>
            {busy ? 'Joining…' : 'Join draft'}
          </button>
        </>
      )}

      {room && room.drafters.length > 0 && (
        <div>
          <h2>In the lobby ({room.drafters.length})</h2>
          <ul className="picks">
            {room.drafters.map((d) => (
              <li key={d.id}><span>{d.name}</span><span className="pickno">#{d.slot}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
