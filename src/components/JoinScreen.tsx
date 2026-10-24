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
            {/* Dasselbe Bild wie das App-Icon: Burro mit Sombrero */}
            <img
              src={`${import.meta.env.BASE_URL}favicon.svg`}
              alt="Fiesta Siesta"
              className="join-app-icon"
              width={112}
              height={112}
            />
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
