// APP_VERSION und BUILD_ID werden beim Build per define eingefügt
// (vite.config.ts, APP_DEFINE — wird auch von vitest.config.ts importiert):
// APP_VERSION kommt aus package.json, BUILD_ID ist ein 8-Zeichen-Hash über die
// Build-Dateinamen — derselbe, der im Service-Worker-CACHE_NAME steckt. Beim
// Dev-Server und in den Tests trägt BUILD_ID den Platzhalter '__BUILD_ID__';
// der echte Hash wird erst in die gebauten Chunks geschrieben
// (build-version-plugin). Kein manuelles Bumpen, keine Sync-Notiz mehr nötig.
export const APP_VERSION = __APP_VERSION__
export const BUILD_ID = __BUILD_ID__
