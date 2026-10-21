import { useEffect, useRef, useCallback } from 'react'
import { supabase, getJoinCode } from '../lib/supabase'

type TableName = 'items' | 'categories' | 'notes' | 'expenses' | 'expense_splits' | 'expense_quotas' | 'participants' | 'bristol_entries' | 'settlements'

interface UseRealtimeSyncOptions {
  listId: string | null
  onTableChange: (table: TableName, payload: any) => void
}

export function useRealtimeSync({ listId, onTableChange }: UseRealtimeSyncOptions) {
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
    const tables: TableName[] = ['items', 'categories', 'notes', 'expenses', 'expense_splits', 'expense_quotas', 'participants', 'bristol_entries', 'settlements']

    const channel = supabase.channel(`list:${listId}`, {
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
  }, [listId, cleanup])

  // Cleanup on unmount
  useEffect(() => {
    return cleanup
  }, [cleanup])
}