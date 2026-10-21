import { describe, it, expect } from 'vitest'
import { aggregateItems } from '../aggregate'
import type { ListItem } from '../../types'

const makeItem = (overrides: Partial<ListItem> = {}): ListItem => ({
  id: crypto.randomUUID(),
  list_id: 'test-list',
  name: 'Test Item',
  category: 'Essen',
  quantity: '1',
  assigned_to: null,
  is_checked: false,
  is_brought: false,
  created_by: 'TestUser',
  created_at: new Date().toISOString(),
  list_type: 'shopping',
  sort_order: 0,
  ...overrides,
})

describe('aggregateItems', () => {
  it('returns single items unchanged', () => {
    const items = [makeItem({ id: '1', name: 'Apfel' })]
    const result = aggregateItems(items)
    expect(result).toHaveLength(1)
    expect(result[0].isAggregated).toBe(false)
    expect(result[0].name).toBe('Apfel')
  })

  it('aggregates items with same name and category', () => {
    const items = [
      makeItem({ id: '1', name: 'Bier', quantity: '6', category: 'Getränke' }),
      makeItem({ id: '2', name: 'Bier', quantity: '6', category: 'Getränke' }),
    ]
    const result = aggregateItems(items)
    expect(result).toHaveLength(1)
    expect(result[0].isAggregated).toBe(true)
    expect(result[0].count).toBe(2)
  })

  it('sums numeric quantities with same unit', () => {
    const items = [
      makeItem({ id: '1', name: 'Milch', quantity: '1 l', category: 'Getränke' }),
      makeItem({ id: '2', name: 'Milch', quantity: '2 l', category: 'Getränke' }),
    ]
    const result = aggregateItems(items)
    expect(result[0].displayQuantity).toBe('3 l')
  })

  it('shows count for mixed units', () => {
    const items = [
      makeItem({ id: '1', name: 'Eier', quantity: '6 Stk', category: 'Essen' }),
      makeItem({ id: '2', name: 'Eier', quantity: '10 Stk', category: 'Essen' }),
    ]
    const result = aggregateItems(items)
    expect(result[0].displayQuantity).toBe('16 stk')
  })

  it('all items checked = isChecked true', () => {
    const items = [
      makeItem({ id: '1', name: 'Bier', is_checked: true }),
      makeItem({ id: '2', name: 'Bier', is_checked: true }),
    ]
    const result = aggregateItems(items)
    expect(result[0].isChecked).toBe(true)
  })

  it('partial check = isChecked false', () => {
    const items = [
      makeItem({ id: '1', name: 'Bier', is_checked: true }),
      makeItem({ id: '2', name: 'Bier', is_checked: false }),
    ]
    const result = aggregateItems(items)
    expect(result[0].isChecked).toBe(false)
  })

  it('does not aggregate items with different names', () => {
    const items = [
      makeItem({ id: '1', name: 'Apfel' }),
      makeItem({ id: '2', name: 'Birne' }),
    ]
    const result = aggregateItems(items)
    expect(result).toHaveLength(2)
  })

  it('does not aggregate items with different categories', () => {
    const items = [
      makeItem({ id: '1', name: 'Bier', category: 'Getränke' }),
      makeItem({ id: '2', name: 'Bier', category: 'Party' }),
    ]
    const result = aggregateItems(items)
    expect(result).toHaveLength(2)
  })
})