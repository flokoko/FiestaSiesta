import { Component, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { logError } from '../lib/logger'

interface Props {
  children: ReactNode
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
