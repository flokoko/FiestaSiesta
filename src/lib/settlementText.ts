// ── Abrechnung als kopierbarer Text ──────────────────────────────────
// „Wer schuldet wem" steht als Karten im Screen — für WhatsApp & Co. braucht
// Flo den gleichen Stand als reinen Text. Diese Datei baut ihn aus denselben
// Zahlungen, die computeSettlementProposals liefert: keine eigene Rechnung,
// kein zweiter Wahrheitsort. Kein Markdown, keine Emojis — WhatsApp zitiert
// sonst die Zeichen und die Zeilen zerfallen auf alten Handys.

import { roundCents, type SettlementTxn } from './settlement'

const HEAD = 'Fiesta Siesta · Abrechnung'

const eur = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Betrag mit Cent-Schutz runden (10.005 → 10,01) und als „32,50 €" zeigen. */
function money(value: number): string {
  return `${eur.format(roundCents(value))} €`
}

const line = (txn: SettlementTxn): string => `${txn.from} → ${txn.to}: ${money(txn.amount)}`

export interface SettlementTextOptions {
  /** offene Ausgleichszahlungen, in der Reihenfolge, in der sie angezeigt werden */
  proposals: SettlementTxn[]
  /** bereits beglichene Zahlungen — erscheinen als eigener Nachspann */
  settlements?: SettlementTxn[] | null
  /** reserviert: Personenliste des Urlaubs (die Zeilen folgen proposals) */
  persons?: readonly string[]
}

/**
 * Reiner Helfer: keine Hooks, keine React-Imports. Zeilen mit \n getrennt,
 * ohne \r, ohne Umbruch am Ende.
 */
export function settlementShareText({ proposals, settlements }: SettlementTextOptions): string {
  const lines: string[] = [HEAD]

  if (proposals.length === 0) {
    lines.push('', 'Alles ausgeglichen — niemand schuldet etwas.')
    return lines.join('\n')
  }

  for (const txn of proposals) lines.push(line(txn))
  const open = proposals.reduce((sum, txn) => sum + txn.amount, 0)
  lines.push(`Offen insgesamt: ${money(open)}`)

  const settled = settlements ?? []
  if (settled.length > 0) {
    lines.push('', 'Bereits beglichen')
    for (const txn of settled) lines.push(line(txn))
  }

  return lines.join('\n')
}
