import { Sunrise, Sun, MoonStar } from 'lucide-react'
import type { TripSlot } from '../types'

const ICONS = {
  morning: Sunrise,
  noon: Sun,
  evening: MoonStar,
} as const

interface SlotIconProps {
  slot: TripSlot
  size?: number
  className?: string
}

/** Einheitliches Symbol je Tageszeit (statt Emoji, damit es überall gleich rendert) */
export default function SlotIcon({ slot, size = 13, className }: SlotIconProps) {
  const Icon = ICONS[slot]
  return <Icon size={size} strokeWidth={2.2} className={className} aria-hidden="true" />
}
