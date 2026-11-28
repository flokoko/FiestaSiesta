// ── Browser-Storage-Keys — zentral, mit App-Präfix ──────────────────
// Zwei Apps teilen sich dieselbe GitHub-Pages-Origin (flokoko.github.io),
// nur die Pfade unterscheiden sich — localStorage gilt aber pro ORIGIN.
// Ohne Präfix las dieses App die Keys der Schwester-App (BellaMozzarella):
// der Regen-Radar zentrierte auf dem fremden Ort statt auf Gran Canaria.
// Deshalb trägt hier jeder Key das Präfix siesta_.

export const LS = {
  // Wetter-Ort — wird NICHT migriert (Begründung bei migrateLegacyKeys)
  weatherLat: 'siesta_weather_lat',
  weatherLon: 'siesta_weather_lon',
  weatherName: 'siesta_weather_name',
  // Sitzungs-/Geräte-Flags — einmalig aus den alten Keys migriert
  userName: 'siesta_user_name',
  participantId: 'siesta_participant_id',
  currentList: 'siesta_current_list',
  pushEnabled: 'siesta_push_enabled',
  bristolEnabled: 'siesta_bristol_enabled',
  theme: 'siesta_theme',
} as const

// Alt (unpräfixt) → neu (siesta_*): genau diese Keys wandern einmalig um.
const LEGACY_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['theme', LS.theme],
  ['user_name', LS.userName],
  ['participant_id', LS.participantId],
  ['fs_current_list', LS.currentList],
  ['push_notifications_enabled', LS.pushEnabled],
  ['bristol_modus_enabled', LS.bristolEnabled],
]

/**
 * Einmalige Migration beim Start (main.tsx, VOR applyTheme — sonst liest
 * getTheme() die Präferenz, bevor sie unter dem neuen Key liegt).
 *
 * Absichtlich NICHT migriert: weather_lat / weather_lon / weather_name.
 * Diese Keys kann die Schwester-App (BellaMozzarella, gleiche Origin)
 * geschrieben haben — wem der Ort gehört, lässt sich nicht mehr feststellen.
 * Der ganze Sinn der Umbenennung ist, dass dieses App stattdessen auf
 * DEFAULT_LOCATION (Temisas, Gran Canaria) fällt statt auf einen fremden
 * Ort (der Regen-Radar zeigte sonst die Toskana).
 *
 * Die Legacy-Keys bleiben stehen: die Schwester-App liest sie weiter.
 */
export function migrateLegacyKeys(): void {
  for (const [from, to] of LEGACY_KEYS) {
    let oldValue: string | null = null
    try {
      oldValue = localStorage.getItem(from)
    } catch {
      // Storage blockiert (Privatmodus) — ohne Migration weiterleben
      continue
    }
    if (oldValue === null) continue
    try {
      // Nur beim ersten Start: ein vorhandener neuer Key gewinnt immer
      if (localStorage.getItem(to) === null) {
        localStorage.setItem(to, oldValue)
      }
    } catch {
      // Schreiben nicht möglich (Privatmodus) — ignorieren
    }
  }
}
