// ── Notfall-Zettel für die Reise ─────────────────────────────────────
// Reiner Text + Links, liegt im Bundle und damit im Precache: die Karte
// funktioniert ohne Netz — genau dann, wenn man sie braucht (Temisas liegt
// auf 690 m, im Bergdorf ist der Empfang dünn).
//
// Quellen der Nummern (Stand Oktober 2026):
//  · 112 — Centro Coordinador de Emergencias y Seguridad, Gobierno de Canarias
//  · Centro de Salud Agüimes — Gemeinde Agüimes (Teléfono-Verzeichnis)
//  · Hospital Insular — Complejo Hospitalario Universitario Insular (SCS)
//  · Taxi — Socomtaxi, Asociación de Taxis Roque Aguayro, Agüimes
// Die Nummer des Vermieters steht bewusst nicht hier: sie liegt in der
// Airbnb-Buchung und ist nicht Teil des Reiseplans.

export interface EmergencyRow {
  /** kurze Bezeichnung, z. B. „Notruf“ */
  label: string
  /** der eigentliche Wert, z. B. „112“ oder die Adresse */
  value: string
  /** zusätzliche Erläuterung */
  hint?: string
  /** tel:/https:-Ziel für den Hauptknopf */
  href?: string
  /** Text, den ein Kopieren-Knopf in die Zwischenablage legt */
  copy?: string
}

export interface EmergencySection {
  id: string
  title: string
  rows: EmergencyRow[]
}

export const EMERGENCY_HEADLINE = 'Notfall & Adressen'

export const EMERGENCY_SECTIONS: EmergencySection[] = [
  {
    id: 'sofort',
    title: 'Sofort',
    rows: [
      {
        label: 'Notruf',
        value: '112',
        hint: 'Kostenlos, auch ohne Guthaben. Spanisch oder Englisch, oft auch deutsch. '
          + 'Feuerwehr, Rettung und Polizei laufen alle über diese Nummer.',
        href: 'tel:112',
      },
      {
        label: 'Unterkunft',
        value: 'Casa Los Pinos, Temisas, 35270 Agüimes, Gran Canaria',
        hint: 'Für Taxi oder Notruf: Adresse vorzeigen. Anfahrt über die GC-550, '
          + '11 km bergauf von Agüimes.',
        href: 'https://maps.google.com/?cid=15046465034015783199',
        copy: 'Casa Los Pinos, Temisas, 35270 Agüimes, Gran Canaria',
      },
      {
        label: 'Vermieter',
        value: 'Nummer steht in der Airbnb-Buchung',
        hint: 'Schlüsselübergabe und Kaution laufen über den Eigentümer. '
          + 'Die Nummer vor der Abreise in den Notizen ablegen.',
      },
    ],
  },
  {
    id: 'gesundheit',
    title: 'Gesundheit',
    rows: [
      {
        label: 'Centro de Salud Agüimes',
        value: '928 78 98 41',
        hint: 'Calle Bolivia, 35260 Agüimes · 15–20 Min bergab. '
          + 'Erste Anlaufstelle bei allem, was kein Notfall ist.',
        href: 'tel:+34928789841',
      },
      {
        label: 'Urgencias Hospital Insular',
        value: '928 444 321',
        hint: 'Avenida Marítima del Sur, 35016 Las Palmas · rund 45 Min. '
          + 'Notaufnahme für Erwachsene.',
        href: 'tel:+34928444321',
      },
      {
        label: 'Apotheke',
        value: 'Agüimes, im Ortskern',
        hint: 'Nachts und sonntags wechselt der Notdienst — der Aushang an der '
          + 'Tür nennt die diensthabende Apotheke.',
      },
    ],
  },
  {
    id: 'unterwegs',
    title: 'Unterwegs',
    rows: [
      {
        label: 'Flughafen LPA',
        value: '21 km · 32 Min',
        hint: 'Rückflug So 06.12. um 10:25. Abfahrt in Temisas 07:45, '
          + 'Mietwagen bis etwa 08:45 zurück. Der 6. Dezember ist Feiertag '
          + '(Día de la Constitución) — mehr Betrieb einplanen.',
      },
      {
        label: 'Taxi',
        value: '928 15 47 77',
        hint: 'Socomtaxi, Asociación de Taxis Roque Aguayro (Agüimes). '
          + 'Taxistand im Ortskern von Agüimes.',
        href: 'tel:+34928154777',
      },
      {
        label: 'Mietwagen',
        value: 'Pannenhilfe steht im Mietvertrag',
        hint: 'Voll-zu-voll getankt zurückgeben, Tankbeleg aufbewahren. '
          + 'Die Notrufnummer des Vermieters beim Abholen fotografieren.',
      },
      {
        label: 'Einkauf',
        value: 'Supermarkt in Agüimes · Café 1 km',
        hint: 'In Temisas gibt es keinen Laden. Sonntags haben viele '
          + 'Supermärkte geschlossen.',
      },
    ],
  },
]

export const EMERGENCY_FOOTNOTE =
  'Alles hier liegt offline in der App. Nummern Stand Oktober 2026 — '
  + 'im Zweifel die 112.'
