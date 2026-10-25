import { Component, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { logError } from '../lib/logger'
import './ErrorBoundary.css'

interface Props {
  children: ReactNode
  /** Kompakter Modus für einzelne Panes: kleine Karte statt Vollbild-Absturz. */
  compact?: boolean
  /** Eigener Text der kompakten Karte (nur im compact-Modus). */
  fallbackLabel?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logError('ErrorBoundary caught:', { error, info })
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      // Compact: kleine Karte für einen einzelnen Pane (z. B. fehlender
      // Lazy-Chunk nach einem Deploy) — nur der betroffene Bereich zeigt den
      // Fallback, nicht die ganze App. Knopf-Klasse des globalen Fallbacks
      // (error-screen-btn aus design.css) wird wiederverwendet.
      if (this.props.compact) {
        return (
          <div className="error-boundary-compact" role="alert">
            <p className="error-boundary-compact-text">
              {this.props.fallbackLabel ?? 'Dieser Bereich konnte nicht geladen werden.'}
            </p>
            <button type="button" className="error-screen-btn" onClick={this.handleReload}>
              Neu laden
            </button>
          </div>
        )
      }
      // Bewusst über Tokens statt Inline-Farben: der alte Gradient war der
      // Bella-Look (grün-weiß) und im Dark Mode eine grelle helle Seite —
      // ausgerechnet im Moment des Absturzes.
      return (
        <div className="error-screen" role="alert">
          <span className="error-screen-icon" aria-hidden="true">
            <AlertCircle size={44} strokeWidth={2} />
          </span>
          <h1 className="error-screen-title">Ups, da ist etwas schiefgelaufen</h1>
          <p className="error-screen-text">
            Die App ist abgestürzt. Lade die Seite neu, um es erneut zu versuchen.
          </p>
          <button type="button" className="error-screen-btn" onClick={this.handleReload}>
            Neu laden
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
