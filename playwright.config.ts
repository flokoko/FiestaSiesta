// P7: Playwright-Konfiguration für die UI-Smoke-Tests.
//
// KEIN webServer-Block: der Preview-Server wird von außen gestartet
// (VITE_JOIN_CODE=TESTUI26 npm run build && npx vite preview --port 4173
// --host 127.0.0.1) und am Ende manuell beendet. Die Tests laufen gegen
// http://127.0.0.1:4173/FiestaSiesta/ (GitHub-Pages-Basispfad).
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: {
    timeout: 7_000,
  },
  // Nur EIN Worker: drei Tests teilen sich einen frisch gebauten Bundle-Stand,
  // und der Preview-Server läuft genau einmal.
  workers: 1,
  retries: 0,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    // Handy-Maße: die App ist Mobile-first, Bottom-Nav und Hub-Chips sind dort
    // im ersten Blickfeld.
    viewport: { width: 430, height: 900 },
    trace: 'off',
  },
})
