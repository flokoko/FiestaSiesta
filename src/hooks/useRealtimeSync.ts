import { useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

type TableName = 'items' | 'categories' | 'notes' | 'expenses' | 'expense_splits' | 'expense_quotas' | 'participants' | 'bristol_entries' | 'settlements' | 'trip_proposals' | 'trip_votes'

interface UseRealtimeSyncOptions {
  listId: string | null
  onTableChange: (table: TableName, payload: any) => void
  /** eigener Kanalname, wenn ein zweiter Sync parallel läuft (z. B. Reiseplan) */
  channelSuffix?: string
  /** nur diese Tabellen abonnieren */
  tables?: TableName[]
}

/** Tabellen ohne list_id-Spalte: `expense_splits` hängt nur über expense_id
 * an expenses (ON DELETE CASCADE — sql/expenses_migration.sql). Ein
 * `list_id=eq.…`-Filter würde deren Abo NIE auslösen lassen. Deshalb: Abo ohne
 * Filter, die RLS-Policies filtern über den Eltern-Expense.
 * `trip_votes` hat dagegen DOCH eine list_id (sql/110_trip_plan.sql) und
 * bleibt daher gefiltert. */
const TABLES_WITHOUT_LIST_ID: ReadonlySet<TableName> = new Set(['expense_splits'])

const DEFAULT_TABLES: TableName[] = [
  'items', 'categories', 'notes', 'expenses', 'expense_splits', 'expense_quotas',
  'participants', 'settlements',
]

export function useRealtimeSync({ listId, onTableChange, channelSuffix = '', tables: onlyTables }: UseRealtimeSyncOptions) {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const onTableChangeRef = useRef(onTableChange)
  onTableChangeRef.current = onTableChange

  const cleanup = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
  }, [])

  // Stabilisierung: inline übergebene Arrays (z. B. in TripPlanScreen) erzeugen
  // pro Render eine neue Referenz — das würde bei Dependency `onlyTables` den
  // Kanal jedes Mal neu aufsetzen. Deshalb hier nur der Join-Schlüssel als
  // Dependency; im Effekt wird das Array aus dem Schlüssel rekonstruiert.
  const tablesKey = (onlyTables ?? DEFAULT_TABLES).join(',')

  useEffect(() => {
    if (!listId) return

    const tables = tablesKey.split(',') as TableName[]
    // NOTE: Ein `config.headers`-Block ({ 'x-join-code': joinCode }) wird von
    // realtime-js verworfen und erreicht den Realtime-Server nie — der
    // join-code-basierte RLS-Zugriff läuft über die global gesetzten
    // Supabase-Header (lib/supabase.ts). Deshalb bewusst KEIN config-Objekt.
    const channel = supabase.channel(`list:${listId}${channelSuffix}`)

    for (const table of tables) {
      channel.on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table,
          // Nur Tabellen MIT list_id-Spalte bekommen den Filter (s. oben)
          ...(TABLES_WITHOUT_LIST_ID.has(table) ? {} : { filter: `list_id=eq.${listId}` }),
        },
        (payload: any) => {
          onTableChangeRef.current(table, payload)
        }
      )
    }

    channel.subscribe()
    channelRef.current = channel

    return cleanup
  }, [listId, cleanup, channelSuffix, tablesKey])

  // Cleanup on unmount
  useEffect(() => {
    return cleanup
  }, [cleanup])
}