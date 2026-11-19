// ── Offline read cache (Phase 2) ──────────────────────────────────────
// localStorage-backed read cache so data stays visible when the app is offline.
// Each successful Supabase read writes its result here; when a fetch fails
// (network error / offline / RLS error) we fall back to the cached value.
//
// Keys are scoped per list:  fs_cache_{listId}_{table}

import { APP_VERSION } from '../version'

interface ReadCacheEntry<T> {
  v: string
  ts: number
  data: T
}

// Die Version klebt an der App-Version: ein Deploy ändert die Zeilengestalt,
// alte Einträge (v: 1 oder eine andere Version) werden beim Offline-Start
// einmalig verworfen, statt tote Zeilen in den State zu setzen — eine
// konstante SCHEMA_VERSION 1 hat das nie geschafft (Mechanismus war tot).
const SCHEMA_VERSION = `cache1@${APP_VERSION}`

function cacheKey(listId: string, table: string): string {
  return `fs_cache_${listId}_${table}`
}

/** Read a cached value for the given list + table. Returns `null` if no
 *  entry exists, the schema version mismatches, or JSON parsing fails. */
export function readCache<T>(listId: string, table: string): T | null {
  try {
    const raw = localStorage.getItem(cacheKey(listId, table))
    if (!raw) return null
    const entry = JSON.parse(raw) as ReadCacheEntry<T>
    if (entry.v !== SCHEMA_VERSION) return null
    return entry.data
  } catch {
    return null
  }
}

/** Zuletzt geschriebene Nutzdaten je Cache-Key (nur im Speicher). */
const lastWritten = new Map<string, string>()

/** Write a value to the cache. Wraps in try/catch so a full localStorage
 *  quota never crashes the caller. */
export function writeCache<T>(listId: string, table: string, data: T): void {
  try {
    const key = cacheKey(listId, table)
    const payload = JSON.stringify(data)
    // Diff statt Blindschreiben: der 90-s-Poll liefert meist identische Daten,
    // und JSON.stringify + synchrones setItem blockieren sonst den Main-Thread.
    if (lastWritten.get(key) === payload) return
    const entry: ReadCacheEntry<T> = { v: SCHEMA_VERSION, ts: Date.now(), data }
    localStorage.setItem(key, JSON.stringify(entry))
    lastWritten.set(key, payload)
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

/** Remove ALL cached entries for a given list (`fs_cache_{listId}_*`).
 *  Call this on join/leave so a new list never shows the previous list's data.
 *  Uses a known-tables list instead of iterating all localStorage keys. */
const KNOWN_CACHE_TABLES = [
  'shopping_items',
  'bring_items',
  'categories',
  'notes',
  'expenses',
  'expense_splits',
  'participants',
  'expense_quotas',
  'settlements',
  'bristol_entries',
  // Wird ebenfalls pro Liste gecacht (useTripPlan.ts: gewählter Tag) — ohne
  // Eintrag überlebt der alte Plan den Listenwechsel.
  'trip_plan',
  // RecipesScreen.tsx hält Rezepte im Read-Cache — sonst überleben alte
  // Rezepte den Listenwechsel.
  'recipes',
]

export function clearCacheForList(listId: string): void {
  try {
    for (const table of KNOWN_CACHE_TABLES) {
      const key = cacheKey(listId, table)
      localStorage.removeItem(key)
      // Auch den Speicher-Diff-Zustand des writeCache werfen: bleibt
      // lastWritten stehen, matcht der Diff für identische Daten und das
      // (nun fehlende) Schreiben wird übersprungen — nach Verlassen und
      // Wiedereintritt blieb der Cache leer, Offline-Start zeigte nichts.
      lastWritten.delete(key)
    }
  } catch {
    // localStorage unavailable — nothing to clear
  }
}