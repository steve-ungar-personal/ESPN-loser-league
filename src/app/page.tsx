'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Player, PublicRoom } from '@/lib/types';
import { countRoster, emptyCounts, ROSTER_SIZE } from '@/lib/roster';
import JoinScreen from '@/components/JoinScreen';
import Lobby from '@/components/Lobby';
import RosterPanel from '@/components/RosterPanel';
import TeamsPanel from '@/components/TeamsPanel';
import PlayerTable from '@/components/PlayerTable';

const IDENTITY_KEY = 'jpll-identity-v1';
const POLL_MS = 2000;
/** Lobby and finished drafts do not need a 2s heartbeat. */
const IDLE_POLL_MS = 10000;

type Identity = { token: string; id: string; name: string; slot: number };

function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

export default function Page() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [ready, setReady] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  // Server clock minus browser clock, so the countdown can't be gamed or drift.
  const skew = useRef(0);

  useEffect(() => {
    setIdentity(loadIdentity());
    setReady(true);
  }, []);

  // Player pool: fetched once, it barely changes before the ESPN draft.
  useEffect(() => {
    fetch('/api/players')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setPlayers(d.players ?? []);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/state', {
        headers: identity ? { 'x-draft-token': identity.token } : {},
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.room) {
        skew.current = data.room.serverNow - Date.now();
        setRoom(data.room);
      }
    } catch {
      // A dropped poll is not worth showing; the next one in 2s will recover.
    }
  }, [identity]);

  // Poll fast only while a draft is actually live, slowly in the lobby or
  // once it is done, and not at all while the tab is hidden. A forgotten open
  // tab polling every 2s costs far more over a month than the draft itself.
  const roomStatus = room?.status ?? 'lobby';
  useEffect(() => {
    // Every roster is full - the state can no longer change on its own, so
    // stop entirely rather than heartbeating at a finished draft forever.
    if (roomStatus === 'complete') return;

    const period = roomStatus === 'active' ? POLL_MS : IDLE_POLL_MS;
    const tick = () => {
      if (!document.hidden) refresh();
    };
    tick();
    const timer = setInterval(tick, period);
    // Coming back to the tab should feel instant, not wait for the next tick.
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, roomStatus]);

  // Drives the visible countdown once per second.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const takenIds = useMemo(
    () => new Set((room?.picks ?? []).map((p) => p.playerId)),
    [room]
  );

  const available = useMemo(
    () => players.filter((p) => !takenIds.has(p.id)),
    [players, takenIds]
  );

  const myPicks = useMemo(
    () => (room && identity ? room.picks.filter((p) => p.drafterId === identity.id) : []),
    [room, identity]
  );

  const myCounts = useMemo(
    () => (room && identity ? countRoster(room.picks, identity.id, byId) : emptyCounts()),
    [room, identity, byId]
  );

  const onTheClock =
    !!room && !!identity && room.status === 'active' && room.onClockDrafterId === identity.id;
  // Paused means nobody can draft, including whoever holds the clock.
  const isMyTurn = onTheClock && !room?.paused;

  const secondsLeft = useMemo(() => {
    void tick;
    if (!room?.deadline) return null;
    return Math.max(0, Math.ceil((room.deadline - (Date.now() + skew.current)) / 1000));
  }, [room, tick]);

  async function post(url: string, payload: Record<string, unknown>) {
    setError(null);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Request failed');
    return data;
  }

  async function join(name: string, slot: number) {
    setBusy(true);
    try {
      const data = await post('/api/join', { name, slot });
      const next: Identity = {
        token: data.token,
        id: data.me.id,
        name: data.me.name,
        slot: data.me.slot,
      };
      localStorage.setItem(IDENTITY_KEY, JSON.stringify(next));
      setIdentity(next);
      setRoom(data.room);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function start(pickSeconds: number) {
    if (!identity) return;
    setBusy(true);
    try {
      const data = await post('/api/start', { token: identity.token, pickSeconds });
      setRoom(data.room);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function draft(playerId: number) {
    if (!identity) return;
    setBusyId(playerId);
    try {
      const data = await post('/api/pick', { token: identity.token, playerId });
      setRoom(data.room);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function togglePause(next: boolean) {
    if (!identity) return;
    setBusy(true);
    try {
      const data = await post('/api/pause', { token: identity.token, paused: next });
      setRoom(data.room);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reset(clearDrafters: boolean) {
    if (!identity) return;
    const msg = clearDrafters
      ? 'Wipe all picks AND remove every drafter?'
      : 'Wipe all picks and go back to the lobby?';
    if (!confirm(msg)) return;
    try {
      const data = await post('/api/reset', { token: identity.token, clearDrafters });
      setRoom(data.room);
      if (clearDrafters) {
        localStorage.removeItem(IDENTITY_KEY);
        setIdentity(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function leave() {
    localStorage.removeItem(IDENTITY_KEY);
    setIdentity(null);
  }

  if (!ready) return <div className="wrap"><p className="note">Loading…</p></div>;

  // The room forgot us (reset with drafters cleared, or a stale browser).
  const known = !!identity && !!room && room.drafters.some((d) => d.id === identity.id);

  if (!identity || (room && !known)) {
    return (
      <div className="wrap">
        <JoinScreen room={room} onJoin={join} busy={busy} error={error} />
      </div>
    );
  }

  if (!room) return <div className="wrap"><p className="note">Loading draft…</p></div>;

  if (room.status === 'lobby') {
    return (
      <div className="wrap">
        <Lobby room={room} meId={identity.id} onStart={start} busy={busy} error={error} />
        <p className="note" style={{ textAlign: 'center' }}>
          <button className="sm" onClick={leave}>Leave / change name</button>
        </p>
      </div>
    );
  }

  const onClock = room.drafters.find((d) => d.id === room.onClockDrafterId);
  const isCommish = room.commissionerId === identity.id;
  const done = room.status === 'complete';

  return (
    <div className="wrap stack">
      <div className="topbar">
        <div className="brand">
          <h1>Juan Pena Memorial Loser League</h1>
          <p className="note" style={{ margin: 0 }}>
            {identity.name} · pick #{identity.slot} · {available.length} available
          </p>
        </div>

        <div className={room.paused ? 'clockbox pausedbox' : isMyTurn ? 'clockbox turn' : 'clockbox'}>
          {done ? (
            <strong>Draft complete — {room.picks.length} picks made.</strong>
          ) : (
            <>
              <div className="clockmeta">
                <div className="note">
                  R{room.currentRound}/{ROSTER_SIZE} · pick {room.currentPickInRound}/
                  {room.drafters.length} · overall {room.picks.length + 1}/{room.totalPicks}
                </div>
                <strong className="onclockname">
                  {room.paused
                    ? `Paused — ${onClock?.name ?? '—'} is on the clock`
                    : isMyTurn
                      ? 'You are on the clock'
                      : `On the clock: ${onClock?.name ?? '—'}`}
                </strong>
              </div>
              <div
                className={
                  room.paused
                    ? 'clock paused'
                    : secondsLeft !== null && secondsLeft <= 10
                      ? 'clock low'
                      : 'clock'
                }
              >
                {room.paused
                  ? 'PAUSED'
                  : secondsLeft === null
                    ? '—'
                    : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`}
              </div>
            </>
          )}
        </div>

        {isCommish && (
          <div className="row adminrow">
            {room.status === 'active' && (
              <button
                className={room.paused ? 'sm primary' : 'sm'}
                disabled={busy}
                onClick={() => togglePause(!room.paused)}
              >
                {room.paused ? '▶ Unpause' : '❚❚ Pause'}
              </button>
            )}
            {!done && (
              <button className="sm danger" onClick={() => reset(false)}>Reset picks</button>
            )}
            <button className="sm danger" onClick={() => reset(true)}>Reset all</button>
          </div>
        )}
      </div>

      {error && <div className="err">{error}</div>}

      {/* Everyone gets the downloads, not just the commissioner. */}
      {done && (
        <div className="panel donepanel">
          <div>
            <h2 style={{ margin: 0 }}>Draft results</h2>
            <p className="note" style={{ margin: '4px 0 0' }}>
              Saved on the server too — these links work any time, for everyone.
            </p>
          </div>
          <div className="row exports">
            <a className="dl primary-dl" href="/api/export?format=rosters">
              ⬇ Rosters CSV
            </a>
            <a className="dl" href="/api/export?format=picks">⬇ Picks CSV</a>
            <a className="dl" href="/api/export?format=json" target="_blank" rel="noreferrer">
              View JSON
            </a>
          </div>
        </div>
      )}

      <div className="board">
        <div className="stack sidebar">
          <div className="sidecols">
            <RosterPanel title="Your roster" picks={myPicks} byId={byId} counts={myCounts} />
            <TeamsPanel
              drafters={room.drafters}
              picks={room.picks}
              byId={byId}
              onClockDrafterId={room.onClockDrafterId}
              meId={identity.id}
            />
          </div>

          <div className="panel">
            <h2>Recent picks</h2>
            {room.picks.length === 0 ? (
              <p className="note" style={{ margin: 0 }}>Nothing drafted yet.</p>
            ) : (
              <ul className="picks scroll5">
                {[...room.picks].reverse().map((p) => {
                  const pl = byId.get(p.playerId);
                  const who = room.drafters.find((d) => d.id === p.drafterId);
                  return (
                    <li key={p.overall}>
                      <span>
                        <span className="pickno">{p.round}.{String(p.slot).padStart(2, '0')}</span>{' '}
                        {pl ? <span className={`pos ${pl.pos}`}>{pl.pos}</span> : null}{' '}
                        {pl?.name ?? `#${p.playerId}`}
                        {p.auto && <span className="note"> · auto</span>}
                      </span>
                      <span className="note">{who?.name ?? '—'}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <PlayerTable
          players={available}
          counts={myCounts}
          isMyTurn={isMyTurn && !done}
          onDraft={draft}
          busyId={busyId}
        />
      </div>
    </div>
  );
}
