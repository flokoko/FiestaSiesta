import type { TripProposal, TripSlot } from '../types'

export interface SlotMeta {
  key: TripSlot
  label: string
  emoji: string
  hint: string
}

export const SLOTS: SlotMeta[] = [
  { key: 'morning', label: 'Morgen', emoji: '🌅', hint: 'Frühstück, Strand, erster Stopp' },
  { key: 'noon', label: 'Mittag', emoji: '☀️', hint: 'Essen, Ausflug, Siesta' },
  { key: 'evening', label: 'Abend', emoji: '🌙', hint: 'Tapas, Bar, Sonnenuntergang' },
]

export function slotMeta(slot: TripSlot): SlotMeta {
  return SLOTS.find((s) => s.key === slot) ?? SLOTS[0]
}

/** ISO-Datum (lokal, ohne UTC-Verschiebung) */
export function isoDay(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function voteCount(proposal: TripProposal): number {
  return proposal.votes?.length ?? 0
}

/**
 * Sieger einer Tageszeit: meiste Stimmen, bei Gleichstand der ältere Vorschlag.
 * Ohne Stimmen gibt es keinen Plan.
 */
export function leadingProposal(list: TripProposal[]): TripProposal | null {
  const voted = list.filter((p) => voteCount(p) > 0)
  if (voted.length === 0) return null
  return [...voted].sort((a, b) => {
    const diff = voteCount(b) - voteCount(a)
    if (diff !== 0) return diff
    return a.created_at.localeCompare(b.created_at)
  })[0]
}

export function proposalsFor(
  proposals: TripProposal[],
  day: string,
  slot: TripSlot
): TripProposal[] {
  return proposals
    .filter((p) => p.day === day && p.slot === slot)
    .sort((a, b) => {
      const diff = voteCount(b) - voteCount(a)
      if (diff !== 0) return diff
      return a.created_at.localeCompare(b.created_at)
    })
}

/** Vorschlag, der für diese Zeit fest übernommen wurde */
export function confirmedProposal(list: TripProposal[]): TripProposal | null {
  return list.find((p) => p.confirmed_at) ?? null
}

/** Was gilt: bestätigter Plan vor Sieger der Abstimmung */
export function planFor(list: TripProposal[]): TripProposal | null {
  return confirmedProposal(list) ?? leadingProposal(list)
}

/** Google-Maps-Link zum Ort (mit Reise-Region als Kontext) */
export function mapsUrl(place: string): string {
  const lower = place.toLowerCase()
  const parts = [place]
  if (!lower.includes('gran canaria')) {
    if (!lower.includes('las palmas')) parts.push('Las Palmas')
    parts.push('Gran Canaria')
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(', '))}`
}
