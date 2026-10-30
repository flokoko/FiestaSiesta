export type ListType = 'shopping' | 'bring' | 'expense'

export interface ItemCategory {
  id: string
  list_id: string
  list_type: ListType
  name: string
  icon: string
  color: string
  bg: string
  sort_order: number
  created_at: string
}

export interface ListItem {
  id: string
  list_id: string
  name: string
  category: string
  quantity: string
  assigned_to: string | null
  is_checked: boolean
  is_brought: boolean
  created_by: string | null
  created_at: string
  list_type: ListType
  sort_order: number
}

export interface ShoppingList {
  id: string
  name: string
  join_code: string
  admin_password: string | null
  created_at: string
}

export type TabView =
  | 'home'   // Heute-Cockpit
  | 'trip'   // Reise-Domäne (Plan, Fotos, Karte …)
  | 'plan'   // Reiseplan: Vorschläge + Abstimmung
  | 'offen'  // Öffnungszeiten-Ampel (Läden, Apotheken, Tankstellen)
  | 'lists'  // Listen-Domäne (Einkauf + Mitbringen)
  | 'list'
  | 'bring'
  | 'expenses'
  | 'bristol'
  | 'weather'
  | 'settings'
  | 'notes'
export type BringFilter = 'all' | 'mine' | 'unfilled'

export interface QuickNote {
  id: string
  list_id: string
  title: string | null
  content: string
  created_by: string | null
  created_at: string
  sort_order: number
  is_favorite: boolean
}

export interface Expense {
  id: string
  list_id: string
  description: string
  amount: number
  paid_by: string
  expense_date: string
  split_mode: 'equal' | 'exact'
  note: string | null
  category: string | null
  created_by: string | null
  created_at: string
}

export interface ExpenseSplit {
  id: string
  expense_id: string
  person_name: string
  share_amount: number
  created_at: string
}

export interface Participant {
  id: string
  list_id: string
  name: string
  is_admin: boolean
  joined_at: string
}

export interface ExpenseQuota {
  id: string
  list_id: string
  category: string
  person_name: string
  percent: number
  created_at: string
}

export interface Settlement {
  id: string
  list_id: string
  payer: string
  payee: string
  amount: number
  settled_at: string
  created_by: string | null
  created_at: string
}

export interface BristolEntry {
  id: string
  list_id: string
  participant_name: string
  value: number  // 1-13
  entry_date: string  // YYYY-MM-DD
  entry_time: string  // ISO timestamptz
  created_at: string
}
// ── Reiseplan ─────────────────────────────────────────────────────────
export type TripSlot = 'morning' | 'noon' | 'evening'

export interface TripProposal {
  id: string
  list_id: string
  /** ISO-Datum (YYYY-MM-DD) */
  day: string
  slot: TripSlot
  title: string
  note: string | null
  /** optionaler Ort, antippbar → Google Maps */
  place: string | null
  /** Koordinaten des Ziels (aus Maps-Link oder Geocoding) — Grundlage fürs Ziel-Wetter */
  place_lat: number | null
  place_lon: number | null
  /** der eingefügte Maps-Link, falls einer gesetzt wurde */
  place_url: string | null
  created_by: string
  created_at: string
  /** gesetzt, wenn der Vorschlag fest als Plan übernommen wurde */
  confirmed_at: string | null
  confirmed_by: string | null
  votes?: string[]
}

export interface TripVote {
  id: string
  list_id: string
  proposal_id: string
  voter: string
  created_at: string
}
