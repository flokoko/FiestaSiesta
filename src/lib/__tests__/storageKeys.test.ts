import { beforeEach, describe, expect, it } from 'vitest'
import { LS, migrateLegacyKeys } from '../storage'

// jsdom-Testumgebung: Node versteckt sein experimentelles localStorage ohne
// --localstorage-file — In-Memory-Web-Storage nachlegen (Muster wie im
// readCache-Test).
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value) },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

beforeEach(() => {
  localStorage.clear()
})

describe('migrateLegacyKeys — unpräfixte Keys einmalig auf siesta_* umziehen', () => {
  it('kopiert die Legacy-Keys auf die neuen Namen, wenn der neue Key fehlt', () => {
    localStorage.setItem('user_name', 'Anna')
    localStorage.setItem('participant_id', 'p-1')
    localStorage.setItem('theme', 'dark')
    localStorage.setItem('fs_current_list', '{"id":"l-1"}')
    localStorage.setItem('push_notifications_enabled', 'true')
    localStorage.setItem('bristol_modus_enabled', 'true')

    migrateLegacyKeys()

    expect(localStorage.getItem(LS.userName)).toBe('Anna')
    expect(localStorage.getItem(LS.participantId)).toBe('p-1')
    expect(localStorage.getItem(LS.theme)).toBe('dark')
    expect(localStorage.getItem(LS.currentList)).toBe('{"id":"l-1"}')
    expect(localStorage.getItem(LS.pushEnabled)).toBe('true')
    expect(localStorage.getItem(LS.bristolEnabled)).toBe('true')
  })

  it('fasst die Wetter-Keys NICHT an — sie können von der Schwester-App stammen', () => {
    localStorage.setItem('weather_lat', '43.46')
    localStorage.setItem('weather_lon', '11.05')
    localStorage.setItem('weather_name', 'Siena')

    migrateLegacyKeys()

    // Nach der Migration dürfen die neuen Wetter-Keys NICHT existieren —
    // dieses App fällt dann auf DEFAULT_LOCATION (Temisas) zurück.
    expect(localStorage.getItem(LS.weatherLat)).toBeNull()
    expect(localStorage.getItem(LS.weatherLon)).toBeNull()
    expect(localStorage.getItem(LS.weatherName)).toBeNull()
  })

  it('überschreibt keinen vorhandenen neuen Key', () => {
    localStorage.setItem('user_name', 'Anna')
    localStorage.setItem(LS.userName, 'Flo')

    migrateLegacyKeys()

    expect(localStorage.getItem(LS.userName)).toBe('Flo')
  })

  it('lässt die Legacy-Keys stehen — die Schwester-App liest sie weiter', () => {
    localStorage.setItem('user_name', 'Anna')
    localStorage.setItem('participant_id', 'p-1')
    localStorage.setItem('push_notifications_enabled', 'true')
    localStorage.setItem('bristol_modus_enabled', 'true')

    migrateLegacyKeys()

    expect(localStorage.getItem('user_name')).toBe('Anna')
    expect(localStorage.getItem('participant_id')).toBe('p-1')
    expect(localStorage.getItem('push_notifications_enabled')).toBe('true')
    expect(localStorage.getItem('bristol_modus_enabled')).toBe('true')
  })
})
