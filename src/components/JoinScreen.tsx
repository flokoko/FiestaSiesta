import { useState, useMemo, lazy, Suspense } from 'react'
import type { ShoppingList } from '../types'
import { supabase, loginParticipant } from '../lib/supabase'
import { ESPANOLA_QUOTES } from '../lib/espanaFlair'
const SiestaScene = lazy(() => import('./SiestaScene'))

import './JoinScreen.css'

interface JoinScreenProps {
  onJoin: (name: string, list: ShoppingList, participantId: string) => void
}

export default function JoinScreen({ onJoin }: JoinScreenProps) {
  const [name, setName] = useState(() => localStorage.getItem('user_name') || '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const subtitle = useMemo(
    () => Math.random() < 0.1
      ? 'Gebiss'
      : ESPANOLA_QUOTES[Math.floor(Math.random() * ESPANOLA_QUOTES.length)],
    []
  )

  const handleLogin = async () => {
    const n = name.trim()
    const pw = password.trim()
    if (!n) {
      setError('Bitte Namen eingeben.')
      return
    }
    if (!pw) {
      setError('Bitte Passwort eingeben.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await loginParticipant(n, pw)
      if (result.error) {
        setError(result.error)
        return
      }

      // Fetch full list data
      const { data: fullList } = await supabase
        .from('lists')
        .select('*')
        .eq('id', result.list_id)
        .single()

      if (!fullList) {
        setError('Liste nicht gefunden.')
        return
      }

      localStorage.setItem('user_name', result.participant_name)
      localStorage.setItem('participant_id', result.participant_id)

      onJoin(result.participant_name, fullList as ShoppingList, result.participant_id)
    } catch {
      setError('Verbindung fehlgeschlagen.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="join-screen">
      <Suspense fallback={null}>
        <SiestaScene fullscreen />
      </Suspense>
      <div className="join-card">
        <div className="join-logo">
          <div className="join-orbit">
            <svg viewBox="0 0 200 160" width="160" height="128" className="join-flag-svg" aria-label="Spanische Flagge">
              <defs>
                <clipPath id="flagWave">
                  <path d="M 12 8 Q 40 4 70 10 Q 100 16 130 10 Q 160 4 190 10 L 190 124 Q 160 130 130 124 Q 100 118 70 124 Q 40 118 12 122 Z" />
                </clipPath>
              </defs>
              <line x1="12" y1="2" x2="12" y2="158" stroke="#8B7355" strokeWidth="3.5" strokeLinecap="round" />
              <circle cx="12" cy="2" r="4" fill="#a08866" />
              <g clipPath="url(#flagWave)">
                {/* Spanien: horizontale Streifen — gelber Streifen ist doppelt so hoch wie rot */}
                <rect x="0"   y="0"   width="200" height="40"  fill="#AA151B" />
                <rect x="0"   y="40"  width="200" height="80"  fill="#F1BF00" />
                <rect x="0"   y="120" width="200" height="40"  fill="#AA151B" />
              </g>
            </svg>
          </div>
        </div>
        <h1>Fiesta Siesta</h1>
        <p className="join-subtitle">{subtitle}</p>

        <label className="join-label">Dein Name</label>
        <input
          className="join-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z.B. Florian"
          maxLength={50}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
        />

        <label className="join-label">Passwort</label>
        <input
          className="join-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Initial: SIESTA26"
          maxLength={50}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
        />

        <p className="join-hint">
          Beim ersten Mal mit dem Initial-Passwort <strong>SIESTA26</strong> anmelden.
          Danach in den Einstellungen ein eigenes Passwort setzen.
          Die Reise fasst <strong>drei Personen</strong>.
        </p>

        {error && <p className="join-error">{error}</p>}

        <button className="join-btn" onClick={handleLogin} disabled={loading}>
          {loading ? 'Verbinde…' : 'Anmelden →'}
        </button>
      </div>
    </div>
  )
}
