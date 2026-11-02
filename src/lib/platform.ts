// ── Plattform-Erkennung ─────────────────────────────────────────────
// Nur das, was die UI wirklich unterscheiden muss: iOS (dort gibt es Web Push
// erst in der installierten PWA) und „läuft als installierte App".

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS meldet sich als Macintosh — deshalb zusätzlich Touch-Punkte prüfen.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches
}
