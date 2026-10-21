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
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: '2rem',
            textAlign: 'center',
            fontFamily: 'Inter, -apple-system, sans-serif',
            background: 'linear-gradient(160deg, #f0fff4 0%, #fafff0 50%, #fff0f0 100%)',
          }}
        >
          <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'center', color: '#AA151B' }}>
            <AlertCircle size={48} strokeWidth={2} />
          </div>
          <h1
            style={{
              fontSize: '1.4rem',
              fontWeight: 800,
              color: '#1a2e1a',
              marginBottom: '0.5rem',
            }}
          >
            Ups, da ist etwas schiefgelaufen
          </h1>
          <p
            style={{
              fontSize: '0.9rem',
              color: '#6b806b',
              marginBottom: '1.5rem',
            }}
          >
            Die App ist abgestürzt. Lade die Seite neu, um es erneut zu versuchen.
          </p>
          <button
            onClick={this.handleReload}
            style={{
              background: 'linear-gradient(135deg, #AA151B 0%, #d64a52 100%)',
              color: 'white',
              border: 'none',
              padding: '0.7rem 1.5rem',
              borderRadius: '999px',
              fontSize: '0.9rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Neu laden
          </button>
        </div>
      )
    }
    return this.props.children
  }
}