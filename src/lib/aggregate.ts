import type { ListItem } from '../types'

export interface AggregatedItem {
  /** Canonical name from the first item in the group */
  name: string
  /** All underlying items */
  items: ListItem[]
  /** Display quantity (summed if same unit, or count if mixed) */
  displayQuantity: string
  /** Whether all items are checked */
  isChecked: boolean
  /** Whether this is an aggregation of 2+ items */
  isAggregated: boolean
  /** Number of underlying items */
  count: number
  /** Category (same for all items in the group) */
  category: string
  /** Use the first item's id as the group key for drag/reorder */
  groupKey: string
}

const UNIT_PATTERN = /^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|x|stk| Stück|Stk)?$/i

interface ParsedQty {
  value: number
  unit: string
}

function parseQuantity(q: string): ParsedQty | null {
  const trimmed = q.trim()
  if (!trimmed) return null
  const match = trimmed.match(UNIT_PATTERN)
  if (!match) return null
  const value = parseFloat(match[1].replace(',', '.'))
  if (isNaN(value)) return null
  const unit = (match[2] || '').trim().toLowerCase()
  return { value, unit }
}

export function aggregateItems(items: ListItem[]): AggregatedItem[] {
  // Group by name (case-insensitive) within the same category
  const groups = new Map<string, ListItem[]>()

  for (const item of items) {
    const key = `${item.category}::${item.name.toLowerCase()}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(item)
  }

  const result: AggregatedItem[] = []

  for (const groupItems of groups.values()) {
    const first = groupItems[0]
    const count = groupItems.length

    if (count === 1) {
      result.push({
        name: first.name,
        items: groupItems,
        displayQuantity: first.quantity,
        isChecked: first.is_checked,
        isAggregated: false,
        count: 1,
        category: first.category,
        groupKey: first.id,
      })
      continue
    }

    // Try to parse all quantities
    const parsed = groupItems.map((i) => parseQuantity(i.quantity))

    // Check if all parsed successfully and have the same unit
    const allParsed = parsed.every((p) => p !== null)
    const allSameUnit = allParsed && parsed.every((p) => p!.unit === parsed[0]!.unit)

    let displayQuantity: string

    if (allParsed && allSameUnit) {
      const total = parsed.reduce((sum, p) => sum + p!.value, 0)
      const unit = parsed[0]!.unit
      // Format: if integer, no decimals; otherwise keep up to 2
      const formatted = Number.isInteger(total) ? String(total) : total.toFixed(2).replace(/\.?0+$/, '')
      displayQuantity = unit ? `${formatted} ${unit}` : formatted
    } else {
      displayQuantity = `${count} Einträge`
    }

    const allChecked = groupItems.every((i) => i.is_checked)

    result.push({
      name: first.name,
      items: groupItems,
      displayQuantity,
      isChecked: allChecked,
      isAggregated: true,
      count,
      category: first.category,
      groupKey: first.id,
    })
  }

  return result
}