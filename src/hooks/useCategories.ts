import { useCallback } from 'react'
import type { ItemCategory, ListType } from '../types'
import { supabase } from '../lib/supabase'
import { logError } from '../lib/logger'
import { useToast } from '../context/ToastContext'
import { useOfflineQueue } from './useOfflineQueue'

export function useCategories(onChange: () => void) {
  const { toast } = useToast()
  const { isOnline, enqueue } = useOfflineQueue()

  const updateCategory = useCallback(async (id: string, fields: Partial<ItemCategory>) => {
    const { error } = await supabase.from('categories').update(fields).eq('id', id)
    if (error) {
      logError('updateCategory error:', error)
      toast(`Fehler beim Speichern: ${error.message}`, 'error')
      return
    }
    onChange()
  }, [onChange, toast])

  const deleteCategory = useCallback(async (id: string) => {
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (error) {
      logError('deleteCategory error:', error)
      toast(`Fehler beim Löschen: ${error.message}`, 'error')
      return
    }
    onChange()
  }, [onChange, toast])

  const addCategory = useCallback(async (
    listId: string,
    listType: ListType,
    sortOrder: number,
    overrides?: { name?: string; icon?: string; color?: string; bg?: string },
  ) => {
    const { error } = await supabase.from('categories').insert({
      list_id: listId,
      list_type: listType,
      name: overrides?.name ?? 'Neue Kategorie',
      icon: overrides?.icon ?? '🏷️',
      color: overrides?.color ?? '#ffffff',
      bg: overrides?.bg ?? '#AA151B',
      sort_order: sortOrder,
    })
    if (error) {
      logError('addCategory error:', error)
      toast(`Fehler beim Hinzufügen: ${error.message}`, 'error')
      return
    }
    onChange()
  }, [onChange, toast])

  const reorderCategories = useCallback(async (orderedIds: string[]) => {
    const updates = orderedIds.map((id, idx) => ({
      id,
      sort_order: idx,
    }))
    if (isOnline) {
      // Batch update all categories with their new sort_order
      const { error } = await supabase.rpc('batch_reorder_categories', {
        category_data: updates,
      })
      if (error) {
        logError('reorderCategories error:', error)
        toast(`Fehler beim Sortieren: ${error.message}`, 'error')
        return
      }
    } else {
      // Offline: update each individually via queue
      for (const { id, sort_order } of updates) {
        enqueue({
          type: 'update',
          table: 'categories',
          payload: { sort_order },
          filterColumn: 'id',
          filterValue: id,
        })
      }
    }
    onChange()
  }, [onChange, toast, isOnline, enqueue])

  return { updateCategory, deleteCategory, addCategory, reorderCategories }
}