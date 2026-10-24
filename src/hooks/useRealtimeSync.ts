import { useEffect, useRef, useCallback } from 'react'
import { supabase, getJoinCode } from '../lib/supabase'

type TableName = 'items' | 'categories' | 'notes' | 'expenses' | 'expense_splits' | 'expense_quotas' | 'participants' | 'bristol_entries' | 'settlements' | 'trip_proposals' | 'trip_votes'

interface UseRealtimeSyncOptions {
  listId: string | null
  onTableChange: (table: TableName, payload: any) => void
  /** eigener Kanalname, wenn ein zweiter Sync parallel läuft (z. B. Reiseplan) */
  channelSuffix?: string
  /** nur diese Tabellen abonnieren */
  tables?: TableName[]
}

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

  useEffect(() => {
    if (!listId) return

    const joinCode = getJoinCode()
    const tables: TableName[] =
      onlyTables ??
      ['items', 'categories', 'notes', 'expenses', 'expense_splits', 'expense_quotas', 'participants', 'bristol_entries', 'settlements']

    const channel = supabase.channel(`list:${listId}${channelSuffix}`, {
      config: { headers: { 'x-join-code': joinCode } },
    } as any)

    for (const table of tables) {
      channel.on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table,
          filter: `list_id=eq.${listId}`,
        },
        (payload: any) => {
          onTableChangeRef.current(table, payload)
        }
      )
    }

    channel.subscribe()
    channelRef.current = channel

    return cleanup
  }, [listId, cleanup, channelSuffix, onlyTables])

  // Cleanup on unmount
  useEffect(() => {
    return cleanup
  }, [cleanup])
}