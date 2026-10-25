import {
  Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning,
} from 'lucide-react'

/**
 * WMO-Wettercode → Lucide-Icon. Bewusst Icons statt Emoji: Emoji fallen je nach
 * Renderer als Tofu durch (siehe SlotIcon-Entscheidung), und im kleinen
 * Tageskarten-Abzeichen ist ein Tofu-Kasten sofort sichtbar.
 */
export function weatherIconFor(code: number) {
  if (code === 0) return Sun
  if (code === 1 || code === 2) return CloudSun
  if (code === 3) return Cloud
  if (code === 45 || code === 48) return CloudFog
  if (code === 51 || code === 53 || code === 55 || code === 56 || code === 57) return CloudDrizzle
  if (code === 71 || code === 73 || code === 75 || code === 77) return CloudSnow
  if (code === 85 || code === 86) return CloudSnow
  if (code === 95 || code === 96 || code === 99) return CloudLightning
  // 61–67 Regen, 80–82 Schauer und alles Unbekannte
  return CloudRain
}

interface WeatherGlyphProps {
  code: number
  size?: number
  className?: string
}

export default function WeatherGlyph({ code, size = 12, className }: WeatherGlyphProps) {
  const Icon = weatherIconFor(code)
  return <Icon size={size} strokeWidth={2.2} className={className} aria-hidden="true" />
}
