// migrate-slots.js — Migración única: reasigna predicciones al nuevo mapeo de slots
// Ejecutar UNA SOLA VEZ después de desplegar v34.
//
// Uso:
//   FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}' \
//   FIREBASE_DATABASE_URL='https://porra-mundial-2026-5d9fc-default-rtdb.europe-west1.firebasedatabase.app' \
//   node migrate-slots.js
//
// O bien: añade las vars como secretos de GitHub Actions y ejecútalo como un job puntual.

const admin = require('firebase-admin');

const SERVICE_ACCOUNT = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL;

admin.initializeApp({
  credential: admin.credential.cert(SERVICE_ACCOUNT),
  databaseURL: DATABASE_URL
});

// Permutación completa: old_slot → new_slot
// Calculada comparando orden-por-fecha (v32) vs orden-por-id (v33+)
const SLOT_MAP = {
  // LAST_32: 13 cambios
  'k32_0':  'k32_2',
  'k32_1':  'k32_8',
  'k32_2':  'k32_0',
  'k32_4':  'k32_9',
  'k32_5':  'k32_1',
  'k32_6':  'k32_10',
  'k32_7':  'k32_11',
  'k32_8':  'k32_7',
  'k32_9':  'k32_6',
  'k32_10': 'k32_5',
  'k32_11': 'k32_4',
  'k32_12': 'k32_14',
  'k32_14': 'k32_12',
  // LAST_16: 2 cambios
  'k16_0':  'k16_1',
  'k16_1':  'k16_0'
};

async function migrate() {
  const db = admin.database();

  // Comprobar si ya se ejecutó
  const flag = await db.ref('_migrations/v34_slots').get();
  if (flag.exists()) {
    console.log('⚠️  Esta migración ya se ejecutó el', flag.val());
    console.log('Si necesitas re-ejecutarla, borra el nodo _migrations/v34_slots en Firebase.');
    process.exit(0);
  }

  // Leer todas las porras
  const porrasSnap = await db.ref('porras').get();
  if (!porrasSnap.exists()) {
    console.log('No hay porras en la base de datos.');
    process.exit(0);
  }

  const porras = porrasSnap.val();
  let totalUsers = 0, totalMoved = 0, totalOverrides = 0;

  for (const [code, porra] of Object.entries(porras)) {

    // ── 1) Migrar predicciones ──
    const preds = porra.predictions;
    if (preds) {
      for (const [pid, userPreds] of Object.entries(preds)) {
        if (!userPreds || typeof userPreds !== 'object') continue;

        const keysToMove = Object.keys(userPreds).filter(k => SLOT_MAP[k]);
        if (!keysToMove.length) continue;

        totalUsers++;

        const newPreds = { ...userPreds };
        const moving = {};
        for (const oldKey of keysToMove) {
          moving[oldKey] = newPreds[oldKey];
          delete newPreds[oldKey];
        }
        for (const [oldKey, value] of Object.entries(moving)) {
          newPreds[SLOT_MAP[oldKey]] = value;
          totalMoved++;
        }

        await db.ref(`porras/${code}/predictions/${pid}`).set(newPreds);
        const name = porra.participants?.[pid]?.name || pid.slice(0, 8);
        console.log(`  ✅ ${code} / ${name}: ${keysToMove.length} predicciones reasignadas`);
      }
    }

    // ── 2) Migrar overrides (correcciones manuales de marcador) ──
    const overrides = porra.overrides;
    if (overrides) {
      const ovKeys = Object.keys(overrides).filter(k => SLOT_MAP[k]);
      if (ovKeys.length) {
        const newOv = { ...overrides };
        const movingOv = {};
        for (const oldKey of ovKeys) {
          movingOv[oldKey] = newOv[oldKey];
          delete newOv[oldKey];
        }
        for (const [oldKey, value] of Object.entries(movingOv)) {
          newOv[SLOT_MAP[oldKey]] = value;
          totalOverrides++;
        }
        await db.ref(`porras/${code}/overrides`).set(newOv);
        console.log(`  ✅ ${code}: ${ovKeys.length} overrides reasignados`);
      }
    }
  }

  // Marcar como ejecutada
  await db.ref('_migrations/v34_slots').set(new Date().toISOString());

  console.log(`\n🏁 Migración completada: ${totalUsers} usuarios, ${totalMoved} predicciones, ${totalOverrides} overrides movidos.`);
  process.exit(0);
}

migrate().catch(e => {
  console.error('❌ Error:', e);
  process.exit(1);
});
