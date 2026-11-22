import { Loader2 } from 'lucide-react'
import { PULL_TRIGGER } from '../hooks/usePullToRefresh'

/**
 * Runder Pull-to-Refresh-Indikator: wächst mit dem Gummiband-Zug über dem
 * Inhalt mit, beim Auslösen (feste Position auf PULL_TRIGGER) dreht er kurz
 * und blendet danach aus. Die Übergänge liegen im CSS der Screens; ohne
 * `prefers-reduced-motion`-Ausnahmen wäre der Zug kein Zug.
 */
export default function PullIndicator({
  pull,
  refreshing,
  pulling,
}: {
  pull: number
  refreshing: boolean
  pulling: boolean
}) {
  return (
    <div
      aria-hidden="true"
      className={`ptr-indicator${pulling ? ' is-pulling' : ''}${refreshing ? ' is-refreshing' : ''}`}
      style={{
        opacity: refreshing ? 1 : Math.min(1, Math.max(0, pull / 44)),
        /* Der Weg wird gedeckelt (48 px): der Indikator soll im Kopfbereich
           bleiben, nicht über die Kategorie-Chips wandern. */
        transform: `translate(-50%, ${refreshing ? PULL_TRIGGER : Math.min(pull, 48)}px) scale(${
          refreshing ? 1 : Math.min(1, 0.55 + pull / 116)
        })`,
      }}
    >
      <Loader2 size={15} strokeWidth={2.4} className="spin" />
    </div>
  )
}
