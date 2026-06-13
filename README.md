# Porra Mundial26 - Sync

Script automático que sincroniza los resultados del Mundial 2026 desde football-data.org a Firebase cada 10 minutos.

## Configuración

Necesita 3 secretos configurados en GitHub:

- `FOOTBALL_API_KEY` - API key de football-data.org
- `FIREBASE_DATABASE_URL` - URL de Firebase Realtime Database
- `FIREBASE_SERVICE_ACCOUNT` - JSON completo del Service Account de Firebase

## Ejecución

Automática cada 10 minutos vía GitHub Actions.
También se puede ejecutar manualmente desde la pestaña Actions del repositorio.
