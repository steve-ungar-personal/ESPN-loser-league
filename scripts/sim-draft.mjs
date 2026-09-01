/**
 * Drives a complete draft against a running dev server, always asking the
 * server whose turn it is rather than assuming the order. Verifies the snake,
 * the turn lock, roster limits and completion end to end over HTTP.
 *
 * Usage: node scripts/sim-draft.mjs [drafters]
 */
const BASE = process.env.BASE ?? 'http://localhost:3737';
const N = Number(process.argv[2] ?? 4);

const LIMITS = { QB: 1, RB: 2, TEWR: 3, K: 1 };
const slotOf = (pos) => (pos === 'WR' || pos === 'TE' ? 'TEWR' : pos);

async function post(path, payload) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, data: await res.json() };
}

async function get(path) {
  const res = await fetch(BASE + path);
  return res.json();
}

const NAMES = ['Steve', 'Juan', 'Pena', 'Rick', 'Dana', 'Mo', 'Kel', 'Bex',
  'Ari', 'Sam', 'Tor', 'Vic'];

const run = async () => {
  const { players } = await get('/api/players');
  console.log(`pool: ${players.length} players\n`);

  // Join at deliberately scattered positions to prove they get compressed.
  const tokens = {};
  for (let i = 0; i < N; i++) {
    const r = await post('/api/join', { name: NAMES[i], slot: i * 3 + 1 });
    if (r.status !== 200) {
      console.log(`join failed for ${NAMES[i]}: ${r.status} ${r.data.error}`);
      process.exit(1);
    }
    tokens[r.data.me.id] = r.data.token;
  }

  const commish = Object.values(tokens)[0];
  const started = await post('/api/start', { token: commish, pickSeconds: 60 });
  if (started.status !== 200) {
    console.log('start failed:', started.data.error);
    process.exit(1);
  }

  let room = started.data.room;
  console.log(`${room.drafters.length} drafters, ${room.totalPicks} total picks`);
  console.log('order: ' + room.drafters.map((d) => `${d.name}#${d.slot}`).join(', '));
  console.log('');

  const counts = {};
  room.drafters.forEach((d) => (counts[d.id] = { QB: 0, RB: 0, TEWR: 0, K: 0 }));
  const taken = new Set();
  const seenSlots = [];
  let guard = 0;

  while (room.status === 'active' && guard++ < 500) {
    const me = room.onClockDrafterId;
    const player = players.find(
      (p) => !taken.has(p.id) && counts[me][slotOf(p.pos)] < LIMITS[slotOf(p.pos)]
    );
    if (!player) { console.log('pool exhausted'); break; }

    const r = await post('/api/pick', { token: tokens[me], playerId: player.id });
    if (r.status !== 200) {
      console.log(`UNEXPECTED ${r.status}: ${r.data.error}`);
      process.exit(1);
    }

    taken.add(player.id);
    counts[me][slotOf(player.pos)] += 1;
    const pick = r.data.pick;
    seenSlots.push(pick.slot);

    const name = room.drafters.find((d) => d.id === me).name;
    if (pick.overall <= N * 2 || pick.overall > room.totalPicks - 2) {
      console.log(
        `  ${pick.round}.${String(pick.slot).padStart(2, '0')}  ` +
        `${name.padEnd(6)} ${player.pos.padEnd(3)} ${player.name}`
      );
    }
    if (pick.overall === N * 2 + 1) console.log('  ...');
    room = r.data.room;
  }

  const final = await get('/api/state');
  const f = final.room;

  // First two rounds must read 1..N then N..1.
  const expected = [
    ...Array.from({ length: N }, (_, i) => i + 1),
    ...Array.from({ length: N }, (_, i) => N - i),
  ];
  const actual = seenSlots.slice(0, N * 2);
  const snakeOk = JSON.stringify(actual) === JSON.stringify(expected);

  console.log('');
  console.log(`status      : ${f.status}`);
  console.log(`picks made  : ${f.picks.length} of ${f.totalPicks}`);
  console.log(`unique ids  : ${new Set(f.picks.map((p) => p.playerId)).size}`);
  console.log(`snake r1-r2 : ${actual.join(',')}  ${snakeOk ? 'OK' : 'WRONG'}`);

  let allLegal = true;
  for (const d of f.drafters) {
    const c = counts[d.id];
    const legal = c.QB === 1 && c.RB === 2 && c.TEWR === 3 && c.K === 1;
    if (!legal) allLegal = false;
    console.log(
      `  ${d.name.padEnd(6)} QB${c.QB} RB${c.RB} TE/WR${c.TEWR} K${c.K}  ` +
      `${legal ? 'legal' : 'ILLEGAL'}`
    );
  }

  const pass =
    f.status === 'complete' &&
    f.picks.length === f.totalPicks &&
    new Set(f.picks.map((p) => p.playerId)).size === f.picks.length &&
    snakeOk &&
    allLegal;

  console.log('');
  console.log(pass ? 'DRAFT SIM PASSED' : 'DRAFT SIM FAILED');
  process.exit(pass ? 0 : 1);
};

run().catch((e) => { console.error(e); process.exit(1); });
