// sync.js - Sincroniza resultados desde football-data.org a Firebase
const admin = require('firebase-admin');

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL;

if (!FOOTBALL_API_KEY || !FIREBASE_DATABASE_URL || !process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('❌ Faltan variables de entorno');
  process.exit(1);
}

const SERVICE_ACCOUNT = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(SERVICE_ACCOUNT),
  databaseURL: FIREBASE_DATABASE_URL
});

const COMPS = [
  { code: 'WC', path: 'wc2026' },
  { code: 'PD', path: 'laliga' },
  { code: 'CL', path: 'champions' }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

const apiFetch = (url) => fetch(url, { headers: { 'X-Auth-Token': FOOTBALL_API_KEY } });

async function fetchComp(comp) {
  const res = await apiFetch(`https://api.football-data.org/v4/competitions/${comp.code}/matches`);
  if (!res.ok) {
    console.error(`⚠️  ${comp.code} API error: ${res.status} ${(await res.text()).slice(0,200)}`);
    return { ok: false };
  }

  const data = await res.json();
  const matches = {};
  let withScore = 0;
  const penaltyIds = [];

  for (const m of data.matches || []) {
    const homeScore = m.score?.fullTime?.home;
    const awayScore = m.score?.fullTime?.away;
    const hasScore = homeScore != null && awayScore != null;

    matches[m.id] = {
      id: m.id,
      stage: m.stage || null,
      group: m.group || null,
      matchday: m.matchday || null,
      utcDate: m.utcDate,
      status: m.status,
      home: { name: m.homeTeam?.name || 'TBD', tla: m.homeTeam?.tla || null, crest: m.homeTeam?.crest || null },
      away: { name: m.awayTeam?.name || 'TBD', tla: m.awayTeam?.tla || null, crest: m.awayTeam?.crest || null },
      score: hasScore ? {
        home: homeScore, away: awayScore,
        winner: m.score?.winner || null,
        duration: m.score?.duration || 'REGULAR',
        penalties: m.score?.penalties || null,
        halfTime: m.score?.halfTime || null
      } : null
    };

    if (hasScore) withScore++;
    if (m.score?.duration === 'PENALTY_SHOOTOUT') penaltyIds.push(m.id);
  }

  // Partidos de penaltis: el endpoint bulk mete goles de penaltis en fullTime.
  // Refetch individual para obtener regularTime + extraTime (marcador real).
  for (const pid of penaltyIds) {
    await sleep(1200);
    try {
      const dr = await apiFetch(`https://api.football-data.org/v4/matches/${pid}`);
      if (!dr.ok) continue;
      const d = await dr.json();
      const rt = d.score?.regularTime;
      const et = d.score?.extraTime;
      const pen = d.score?.penalties;
      if (rt && rt.home != null) {
        const realHome = rt.home + (et?.home || 0);
        const realAway = rt.away + (et?.away || 0);
        matches[pid].score.home = realHome;
        matches[pid].score.away = realAway;
        if (pen) matches[pid].score.penalties = pen;
        console.log(`  🔄 ${pid}: penaltis corregido ${realHome}-${realAway} (pen. ${pen?.home||'?'}-${pen?.away||'?'})`);
      }
    } catch (e) {
      console.warn(`  ⚠️ Refetch ${pid}:`, e.message);
    }
  }

  const db = admin.database();
  await db.ref(`${comp.path}/matches`).set(matches);
  await db.ref(`${comp.path}/lastSync`).set(Date.now());
  await db.ref(`${comp.path}/season`).set({
    start: data.competition?.currentSeason?.startDate || null,
    end: data.competition?.currentSeason?.endDate || null,
    currentMatchday: data.competition?.currentSeason?.currentMatchday || null
  });

  console.log(`✅ ${comp.code} -> ${comp.path}: ${Object.keys(matches).length} partidos (${withScore} con resultado, ${penaltyIds.length} penaltis)`);
  return { ok: true, count: Object.keys(matches).length };
}

async function sync() {
  console.log('🔄 Iniciando sincronización...');
  let anyOk = false;

  for (let i = 0; i < COMPS.length; i++) {
    try {
      const r = await fetchComp(COMPS[i]);
      if (r.ok) anyOk = true;
    } catch (e) {
      console.error(`⚠️  Error en ${COMPS[i].code}:`, e.message);
    }
    if (i < COMPS.length - 1) await sleep(7000);
  }

  if (!anyOk) {
    console.error('❌ Ninguna competición se sincronizó');
    process.exit(1);
  }
  console.log('✅ Sincronización completada');
  process.exit(0);
}

sync().catch(e => {
  console.error('❌ Error:', e);
  process.exit(1);
});
