// sync.js - Sincroniza resultados de varias competiciones desde football-data.org a Firebase
// Se ejecuta automáticamente vía GitHub Actions
// Competiciones: Mundial (WC), La Liga (PD), Champions League (CL)

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

// Competiciones a sincronizar: código API -> nodo Firebase
const COMPS = [
  { code: 'WC', path: 'wc2026' },   // Mundial 2026
  { code: 'PD', path: 'laliga' },   // La Liga (Primera División)
  { code: 'CL', path: 'champions' } // Champions League
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchComp(comp) {
  const res = await fetch(`https://api.football-data.org/v4/competitions/${comp.code}/matches`, {
    headers: { 'X-Auth-Token': FOOTBALL_API_KEY }
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`⚠️  ${comp.code} API error: ${res.status} ${text.slice(0,200)}`);
    return { ok: false };
  }

  const data = await res.json();
  const matches = {};
  let withScore = 0;

  for (const m of data.matches || []) {
    const homeScore = m.score?.fullTime?.home;
    const awayScore = m.score?.fullTime?.away;
    const hasScore = homeScore != null && awayScore != null;

    matches[m.id] = {
      id: m.id,
      stage: m.stage || null,
      group: m.group || null,
      matchday: m.matchday || null,   // jornada (ligas)
      utcDate: m.utcDate,
      status: m.status,
      home: { name: m.homeTeam?.name || 'TBD', tla: m.homeTeam?.tla || null, crest: m.homeTeam?.crest || null },
      away: { name: m.awayTeam?.name || 'TBD', tla: m.awayTeam?.tla || null, crest: m.awayTeam?.crest || null },
      score: hasScore ? { home: homeScore, away: awayScore } : null
    };

    if (hasScore) withScore++;
  }

  const db = admin.database();
  await db.ref(`${comp.path}/matches`).set(matches);
  await db.ref(`${comp.path}/lastSync`).set(Date.now());
  await db.ref(`${comp.path}/season`).set({
    start: data.competition?.currentSeason?.startDate || null,
    end: data.competition?.currentSeason?.endDate || null,
    currentMatchday: data.competition?.currentSeason?.currentMatchday || null
  });

  console.log(`✅ ${comp.code} -> ${comp.path}: ${Object.keys(matches).length} partidos (${withScore} con resultado)`);
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
    // Respeta el límite de 10 req/min: espera 7s entre competiciones
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
