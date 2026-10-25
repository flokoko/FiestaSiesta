import { useEffect, useRef } from 'react'
import { subscribeList } from '../lib/realtimeBus'

type TableName = 'items' | 'categories' | 'notes' | 'expenses' | 'expense_splits' | 'expense_quotas' | 'participants' | 'bristol_entries' | 'settlements' | 'trip_proposals' | 'trip_votes' | 'packlist_items'

interface UseRealtimeSyncOptions {
  listId: string | null
  onTableChange: (table: TableName, payload: any) => void
  /**
   * Historisch: mehrere Kanäle pro Liste. Seit dem Broadcast-Umbau (v0.37.0)
   * gibt es nur noch EINEN Kanal pro Liste (`lib/realtimeBus.ts`), der alle
   * Hörer bedient — das Argument wird ignoriert und bleibt nur, damit die
   * Aufrufer unverändert bleiben.
   */
  channelSuffix?: string
  /** nur diese Tabellen melden */
  tables?: TableName[]
}

const DEFAULT_TABLES: TableName[] = [
  'items', 'categories', 'notes', 'expenses', 'expense_splits', 'expense_quotas',
  'participants', 'settlements',
]

/**
 * Live-Sync über den Datenbank-Broadcast (`sql/140_realtime_broadcast.sql`).
 *
 * Warum kein `postgres_changes` mehr: die RLS aller Tabellen hängt an
 * `request.headers ->> 'x-join-code'`. Realtime prüft RLS beim Abo ohne diese
 * Header, also kam **kein einziges Event** an (am 25.10.2026 mit `items` und
 * `trip_proposals` gegen die laufende DB nachgewiesen). Jetzt schickt ein
 * Trigger die geänderte Zeile auf den privaten Kanal
 * `list:<list_id>:<join_code>`; die Policy auf `realtime.messages` prüft die
 * Topic gegen `public.lists`. Die Tabellen-RLS bleibt unverändert.
 *
 * Das Payload wird auf die alte postgres_changes-Form normalisiert
 * (`eventType` / `new` / `old`), damit die Aufrufer unverändert bleiben.
 */
export function useRealtimeSync({ listId, onTableChange, tables: onlyTables }: UseRealtimeSyncOptions) {
  const callbackRef = useRef(onTableChange)
  callbackRef.current = onTableChange

  // Nur der Join-Schlüssel als Dependency: inline übergebene Arrays erzeugen
  // pro Render eine neue Referenz und würden den Bus jedes Mal neu anmelden.
  const tablesKey = (onlyTables ?? DEFAULT_TABLES).join(',')

  useEffect(() => {
    if (!listId) return
    const watched = new Set(tablesKey.split(','))

    return subscribeList(listId, (event) => {
      if (!watched.has(event.table)) return
      callbackRef.current(event.table as TableName, {
        eventType: event.eventType,
        new: event.new,
        old: event.old,
        table: event.table,
      })
    })
  }, [listId, tablesKey])
}
