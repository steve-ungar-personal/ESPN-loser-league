'use client';
import { useState } from 'react';
import type { PublicRoom } from '@/lib/types';
import { ROSTER_SIZE, MIN_PICK_SECONDS, MAX_PICK_SECONDS } from '@/lib/roster';

export default function Lobby({
  room, meId, onStart, busy, error,
}: {
  room: PublicRoom;
  meId: string | null;
  onStart: (pickSeconds: number) => void;
  busy: boolean;
  error: string | null;
}) {
  const [secs, setSecs] = useState(room.pickSeconds);
  const isCommish = meId !== null && room.commissionerId === meId;
  const enough = room.drafters.length >= 2;

  return (
    <div className="panel stack" style={{ maxWidth: 520, margin: '48px auto' }}>
      <h1>Waiting to start</h1>
      <p className="note">
        {room.drafters.length} drafter{room.drafters.length === 1 ? '' : 's'} in.
        {' '}Each drafts {ROSTER_SIZE} players ({room.drafters.length * ROSTER_SIZE} picks total).
      </p>

      <ul className="picks">
        {room.drafters.map((d) => (
          <li key={d.id}>
            <span>
              {d.name}
              {d.id === meId && <span className="note"> — you</span>}
              {d.id === room.commissionerId && <span className="note"> · commissioner</span>}
            </span>
            <span className="pickno">#{d.slot}</span>
          </li>
        ))}
      </ul>

      {error && <div className="err">{error}</div>}

      {isCommish ? (
        <>
          <label className="field">
            Seconds per pick — {MIN_PICK_SECONDS}–{MAX_PICK_SECONDS} (autopick takes over at zero)
            <input
              type="number" min={MIN_PICK_SECONDS} max={MAX_PICK_SECONDS} value={secs}
              onChange={(e) => setSecs(Number(e.target.value))}
            />
          </label>
          <button className="primary" disabled={busy || !enough} onClick={() => onStart(secs)}>
            {enough ? 'Start draft' : 'Need at least 2 drafters'}
          </button>
        </>
      ) : (
        <p className="note">Waiting for the commissioner to start the draft.</p>
      )}
    </div>
  );
}
