// P7: UI-Smoke-Tests gegen den Preview-Build (vite preview, Port 4173).
//
// Die App läuft mit TESTUI26-Join-Code, aber ALLE Supabase-Calls werden hier
// auf Netzwerk-Ebene beantwortet (`page.route`) — es fließt kein einziges Byte
// zur echten Datenbank. Login (rpc login_participant), Listen-Abruf und alle
// Tabellen lesen sind gefälscht, der Realtime-WebSocket wird bewusst totgelegt
// (der Screen fällt auf die Fetch-Wahrheit zurück — genau wie offline).
import { expect, test, type Page } from '@playwright/test'

const PAGE_PATH = '/FiestaSiesta/'

const LIST = {
  id: 'smoke-list',
  name: 'UI-Test',
  join_code: 'TESTUI26',
  admin_password: null,
  created_at: '2026-01-01T00:00:00Z',
}

// Antwort von POST /rest/v1/rpc/login_participant (LoginResult aus lib/supabase.ts)
const LOGIN_RESULT = {
  list_id: LIST.id,
  list_name: LIST.name,
  join_code: LIST.join_code,
  participant_id: 'smoke-participant',
  participant_name: 'Flo',
  is_admin: false,
}

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

/** Supabase komplett auf Netzebene faken; Rückgabe: keine Aktion nötig. */
async function mockBackend(page: Page) {
  await page.addInitScript(() => {
    // Realtime-WebSocket totstellen: page.route erreicht WebSocket-Verbindungen
    // nicht, deshalb ersetzt diese Init-Script den Konstruktor. Ohne Verbindung
    // warnt lib/realtimeBus nur „Kanal nicht abonniert“ — die Screens arbeiten
    // mit den gefakten Fetch-Antworten weiter, nichts hängt.
    const DeadSocket = class {
      constructor() {}
      send() {}
      close() {}
      addEventListener() {}
      removeEventListener() {}
    } as unknown as typeof WebSocket
    window.WebSocket = DeadSocket
  })

  // Wetter-Dienste (open-meteo) blockieren: die Libs fallen auf den Cache
  // zurück, der im frischen Profil leer ist — kein externer Netz-Faktor im Test.
  await page.route('**/open-meteo.com/**', (route) => route.abort())

  await page.route('**/*.supabase.co/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const accept = request.headers()['accept'] ?? ''

    if (path.endsWith('/rpc/login_participant') && request.method() === 'POST') {
      await route.fulfill(json(LOGIN_RESULT))
      return
    }

    // JoinScreen holt die Liste per select('*').eq('id').single() → PostgREST-
    // Objekt (Accept: application/vnd.pgrst.object+json); ohne single() ein Array.
    if (path === '/rest/v1/lists' && request.method() === 'GET') {
      const single = accept.includes('application/vnd.pgrst.object')
      await route.fulfill(json(single ? LIST : [LIST]))
      return
    }

    // Alle anderen Tabellen leer (participants, items, notes, expenses, ...);
    // die Screens zeigen dann ihre leeren Zustände.
    if (path.startsWith('/rest/v1/')) {
      await route.fulfill(json([]))
      return
    }

    // /auth/*, /functions/*, Restdatei: freundliches Leer-Objekt.
    await route.fulfill(json({}))
  })
}

/** Login über das Join-Screen-Formular; setzt voraus, dass mockBackend schon aktiv ist. */
async function login(page: Page) {
  await page.goto(PAGE_PATH)
  await page.getByLabel('Dein Name').fill('Flo')
  await page.getByLabel('Passwort').fill('SIESTA26')
  await page.getByRole('button', { name: /Anmelden/ }).click()
  // Der Nachweis für (a): nach dem Login ist die Tagesleiste da.
  await expect(page.locator('.day-strip')).toBeVisible()
}

test.describe('Fiesta Siesta — UI-Smoke (P7)', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page)
  })

  test('(a) Login → Tagesleiste sichtbar', async ({ page }) => {
    await login(page)
    // Kopf zeigt Liste und Teilnehmer aus den gefakten Daten.
    await expect(page.locator('.header-info')).toContainText('UI-Test')
    await expect(page.locator('.header-info')).toContainText('Flo')
  })

  test('(b) Tag → Küche → Einkauf → Zurück landet in der Küche', async ({ page }) => {
    await login(page)

    // Tag-Hub: Küche-Chip öffnet die Rezepte.
    const kitchenChip = page.locator('.day-hub-chip', { hasText: 'Küche' })
    await kitchenChip.click()
    await expect(page.getByRole('heading', { name: 'Küche', level: 1 })).toBeVisible()

    // Küchen-Kopf: Korb-Knopf (erste .rc-icon-btn) führt zur Einkaufsliste.
    await page.locator('.rc-icon-btn').first().click()
    await expect(page.getByRole('heading', { name: 'Einkaufen', level: 1 })).toBeVisible()

    // Zurück-Pfeil im Kopf: Einkaufen hängt an der Küche — Zurück landet dort.
    await page.locator('.header-back').click()
    await expect(page.getByRole('heading', { name: 'Küche', level: 1 })).toBeVisible()
  })

  test('(c) Bottom-Nav Geld → Ausgaben sichtbar', async ({ page }) => {
    await login(page)
    await page.locator('.bottom-nav-item', { hasText: 'Geld' }).click()
    await expect(page.getByRole('heading', { name: 'Geld', level: 1 })).toBeVisible()
    // Der Umschalter „Ausgaben“ ist der Kern-Zustand des Geld-Screens.
    await expect(page.getByRole('button', { name: 'Ausgaben', exact: true })).toBeVisible()
  })
})
