// sync.js - Sincroniza resultados del Mundial 2026 desde football-data.org a Firebase
// Se ejecuta automáticamente cada 10 minutos vía GitHub Actions

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

async function sync() {
  console.log('🔄 Iniciando sincronización...');
  
  const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
    headers: { 'X-Auth-Token': FOOTBALL_API_KEY }
  });
  
  if (!res.ok) {
    const text = await res.text();
    console.error('❌ Football API error:', res.status, text);
    process.exit(1);
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
      stage: m.stage,
      group: m.group || null,
      utcDate: m.utcDate,
      status: m.status,
      home: { name: m.homeTeam?.name || 'TBD' },
      away: { name: m.awayTeam?.name || 'TBD' },
      score: hasScore ? { home: homeScore, away: awayScore } : null
    };
    
    if (hasScore) withScore++;
  }
  
  const db = admin.database();
  await db.ref('wc2026/matches').set(matches);
  await db.ref('wc2026/lastSync').set(Date.now());
  
  console.log(`✅ Sincronizados ${Object.keys(matches).length} partidos (${withScore} con resultado)`);
  process.exit(0);
}

sync().catch(e => {
  console.error('❌ Error:', e);
  process.exit(1);
});
