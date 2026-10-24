import { Activity } from 'lucide-react'

interface BristolGateProps {
  onEnable: () => void
}

/** Wird gezeigt, solange der Bristol-Modus auf diesem Gerät aus ist. */
export default function BristolGate({ onEnable }: BristolGateProps) {
  return (
    <div className="bristol-gate">
      <div className="bristol-gate-card">
        <span className="bristol-gate-icon"><Activity size={22} strokeWidth={2} /></span>
        <h1>Bristol ist aus</h1>
        <p>
          Der Bristol-Modus ist ein Gag für die Gruppe — die Skala von 1 bis 7,
          mit eigener Statistik. Er lässt sich jederzeit wieder ausschalten.
        </p>
        <button type="button" className="bristol-gate-btn" onClick={onEnable}>
          Bristol einschalten
        </button>
        <small>Gilt nur auf diesem Gerät.</small>
      </div>
    </div>
  )
}
