import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BookOpen, Palmtree, Trophy, Scissors, Users, Phone, ChevronRight,
  RotateCcw, Coins, Check, X as XIcon,
} from 'lucide-react'
import { useToast } from '../context/ToastContext'
import {
  QUIZ_LADDER, QUIZ_MODES, QUIZ_SAFE_STEPS, clock, euro,
  quizAnswer, quizBank, quizCurrent, quizJoker, quizLeaderboard, quizOverview,
  quizStart, type QuizBoardRow, type QuizMode, type QuizModeInfo, type QuizQuestion,
  type QuizResult, type QuizReveal,
} from '../lib/quiz'
import './QuizScreen.css'

type Phase = 'lobby' | 'playing' | 'reveal' | 'done' | 'board'

interface QuizScreenProps {
  userName: string
}

interface RevealState extends QuizReveal {
  chosen: number
}

const TIMER_SECONDS = 30

export default function QuizScreen({ userName }: QuizScreenProps) {
  const { toast, confirm } = useToast()

  const [phase, setPhase] = useState<Phase>('lobby')
  const [modes, setModes] = useState<QuizModeInfo[]>([])
  const [board, setBoard] = useState<QuizBoardRow[]>([])
  const [boardMode, setBoardMode] = useState<QuizMode>('general')
  const [mode, setMode] = useState<QuizMode>('general')
  const [question, setQuestion] = useState<QuizQuestion | null>(null)
  const [reveal, setReveal] = useState<RevealState | null>(null)
  const [result, setResult] = useState<QuizResult | null>(null)
  const [remaining, setRemaining] = useState(TIMER_SECONDS)
  const [eliminated, setEliminated] = useState<number[]>([])
  const [audience, setAudience] = useState<Record<string, number> | null>(null)
  const [busy, setBusy] = useState(false)
  // Antwort, die nicht durchging — wird nur auf Wunsch erneut gesendet.
  const [pending, setPending] = useState<number | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const deadlineRef = useRef(0)
  // Server- und Geräteuhr können auseinanderlaufen; die Deadline kommt vom Server.
  const clockOffsetRef = useRef(0)
  const answeredRef = useRef(false)
  // Der Ablauf darf nur EINMAL gemeldet werden — sonst feuert die Uhr im
  // 200-ms-Takt weitere Requests, während der erste noch unterwegs ist.
  const timeoutFiredRef = useRef(false)
  const runRef = useRef<string | null>(null)
  const startBusyRef = useRef(false)
  const jokerPendingRef = useRef(false)
  // Solange der „aufhören?"-Dialog offen ist, pausiert die Uhr und das
  // Spielfeld ist gesperrt — sonst antwortet man unter dem Dialog weiter.
  const dialogRef = useRef(false)
  const nextRef = useRef<HTMLButtonElement | null>(null)

  const loadLobby = useCallback(async () => {
    try {
      const [ov, lb] = await Promise.all([
        quizOverview(userName),
        quizLeaderboard('general'),
      ])
      setModes(ov.modes ?? [])
      setBoard(lb.rows ?? [])
      setBoardMode('general')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Quiz nicht erreichbar', 'error')
    }
  }, [toast, userName])

  useEffect(() => {
    void loadLobby()
  }, [loadLobby])

  const loadQuestion = useCallback(async (id: string) => {
    try {
      const data = await quizCurrent(id, userName)
      if (data.outcome) {
        setResult({ outcome: data.outcome, reached: data.reached, bank: data.bank })
        setPhase('done')
        return
      }
      const serverNow = data.now ? Date.parse(String(data.now)) : Date.now()
      clockOffsetRef.current = serverNow - Date.now()
      setQuestion(data)
      deadlineRef.current = Date.parse(String(data.deadline))
      setRemaining(Math.max(0, (deadlineRef.current - clockOffsetRef.current - Date.now()) / 1000))
      answeredRef.current = false
      timeoutFiredRef.current = false
      setPending(null)
      setReveal(null)
      setEliminated([])
      setAudience(null)
      setPhase('playing')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Frage konnte nicht geladen werden', 'error')
      setPhase('lobby')
    }
  }, [toast, userName])

  const submit = useCallback(async (choice: number) => {
    if (!runRef.current || answeredRef.current) return
    answeredRef.current = true
    setBusy(true)
    setPending(null)
    try {
      const data = await quizAnswer(runRef.current, userName, choice)
      // choice < 0 = die Uhr lief ab; der Server stempelt es ebenfalls als Zeitablauf.
      setReveal({ ...data, chosen: choice, timeout: data.timeout || choice < 0 })
      if (data.outcome !== 'playing') {
        setResult({
          outcome: data.outcome,
          reached: data.reached ?? 0,
          bank: data.bank ?? 0,
        })
      }
      setPhase('reveal')
    } catch (err) {
      // Bewusst KEIN automatischer Retry: die Uhr würde sonst im Zwei-Sekunden-
      // Takt weiterfeuern und den Nutzer mit Fehlertoasts zuschütten.
      setPending(choice)
      toast(err instanceof Error ? err.message : 'Antwort nicht angekommen', 'error')
    } finally {
      setBusy(false)
    }
  }, [toast, userName])

  const retry = useCallback(() => {
    if (pending === null) return
    answeredRef.current = false
    void submit(pending)
  }, [pending, submit])

  // Countdown gegen die Server-Deadline, nicht gegen einen lokalen Start.
  useEffect(() => {
    if (phase !== 'playing') return
    const tick = () => {
      const left = (deadlineRef.current - clockOffsetRef.current - Date.now()) / 1000
      setRemaining(Math.max(0, left))
      if (left <= 0 && !answeredRef.current && !dialogRef.current && !timeoutFiredRef.current) {
        timeoutFiredRef.current = true
        void submit(-1)
      }
    }
    tick()
    const id = window.setInterval(tick, 200)
    return () => window.clearInterval(id)
  }, [phase, submit])

  // Nach der Auflösung wandert der Fokus auf „Weiter" — die Antwortknöpfe sind
  // dann disabled, der Fokus fiele sonst auf <body>.
  useEffect(() => {
    if (phase === 'reveal') nextRef.current?.focus()
  }, [phase])

  const startMode = useCallback(async (target: QuizMode, openRun?: string | null) => {
    if (startBusyRef.current) return
    startBusyRef.current = true
    setBusy(true)
    try {
      if (openRun) {
        // Offener Lauf (z. B. nach einem Reload): fortsetzen statt neu starten.
        setMode(target)
        runRef.current = openRun
        setResult(null)
        await loadQuestion(openRun)
        return
      }
      const run = await quizStart(target, userName)
      setMode(target)
      runRef.current = run.run_id
      setResult(null)
      await loadQuestion(run.run_id)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Runde konnte nicht starten', 'error')
      setPhase('lobby')
    } finally {
      startBusyRef.current = false
      setBusy(false)
    }
  }, [loadQuestion, toast, userName])

  const next = useCallback(async () => {
    if (!runRef.current || busy) return
    if (result) {
      setPhase('done')
      return
    }
    await loadQuestion(runRef.current)
  }, [busy, loadQuestion, result])

  const takeMoney = useCallback(() => {
    if (!runRef.current || !question) return
    const win = QUIZ_LADDER[Math.max(0, question.step - 2)]
    dialogRef.current = true
    setDialogOpen(true)
    confirm(
      `Für ${euro(win)} aufhören?`,
      async () => {
        dialogRef.current = false
        setDialogOpen(false)
        try {
          const data = await quizBank(runRef.current as string, userName)
          // Der Server kann den Lauf inzwischen als verloren führen (Zeit
          // abgelaufen) — dann nicht „Mitgenommen" anzeigen.
          setResult({ outcome: data.outcome, reached: data.reached, bank: data.bank })
          setPhase('done')
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Konnte nicht sichern', 'error')
        }
      },
      () => { dialogRef.current = false; setDialogOpen(false) },
      'Mitnehmen',
    )
  }, [confirm, question, toast, userName])

  const applyJoker = useCallback(async (kind: 'fifty' | 'audience' | 'call') => {
    if (!runRef.current || jokerPendingRef.current || !question) return
    jokerPendingRef.current = true
    const askedStep = question.step
    try {
      const data = await quizJoker(runRef.current, userName, kind)
      // Während des Requests kann „Weiter" gedrückt worden sein — dann darf das
      // Joker-Ergebnis nicht auf der nächsten Frage landen.
      if (question.step !== askedStep) return
      if (data.eliminated) setEliminated(data.eliminated)
      if (data.distribution) setAudience(data.distribution)
      setQuestion((prev) => (prev ? { ...prev, jokers: data.jokers } : prev))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Joker nicht verfügbar', 'error')
    } finally {
      jokerPendingRef.current = false
    }
  }, [question, toast, userName])

  const showBoard = useCallback(async (target: QuizMode) => {
    try {
      const data = await quizLeaderboard(target)
      setBoard(data.rows ?? [])
      setBoardMode(target)
      setPhase('board')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Rangliste nicht erreichbar', 'error')
    }
  }, [toast])

  // ── Lobby ────────────────────────────────────────────────────────
  if (phase === 'lobby') {
    return (
      <div className="quiz-screen list-screen">
        <header className="list-head">
          <div className="list-head-text">
            <h1>Quiz</h1>
            <p>Wer wird Siesta-Millionär</p>
          </div>
          <button
            type="button"
            className="quiz-head-btn"
            onClick={() => { void showBoard('general') }}
            aria-label="Rangliste öffnen"
          >
            <Trophy size={18} strokeWidth={2} />
          </button>
        </header>

        <div className="quiz-modes">
          {QUIZ_MODES.map((entry) => {
            const info = modes.find((m) => m.mode === entry.mode)
            const count = info?.questions ?? 0
            const steps = info?.steps ?? 0
            // Spielbar nur, wenn jede Stufe 1-15 besetzt ist — die reine
            // Fragenzahl sagt darüber nichts.
            const ready = steps >= 15 && count >= 15
            const openRun = info?.open_run ?? null
            return (
              <button
                key={entry.mode}
                type="button"
                className={`quiz-mode${ready ? '' : ' is-locked'}`}
                onClick={() => { if (ready && !busy) void startMode(entry.mode, openRun) }}
                disabled={!ready || busy}
              >
                <span className="quiz-mode-icon">
                  {entry.mode === 'general'
                    ? <BookOpen size={20} strokeWidth={2} />
                    : <Palmtree size={20} strokeWidth={2} />}
                </span>
                <span className="quiz-mode-body">
                  <span className="quiz-mode-name">{entry.label}</span>
                  <span className="quiz-mode-hint">
                    {!ready
                      ? 'Fragen folgen'
                      : openRun
                        ? 'Offener Lauf · fortsetzen'
                        : `${count} Fragen · Beste Runde ${info?.best ?? 0}/15`}
                  </span>
                </span>
                <ChevronRight size={18} strokeWidth={2} className="quiz-mode-go" />
              </button>
            )
          })}
        </div>

        <section className="quiz-card quiz-rules">
          <h2 className="quiz-card-head">So läuft es</h2>
          <ul className="quiz-rule-list">
            <li>15 Stufen, 30 Sekunden pro Frage.</li>
            <li>Sicher ist dein Geld nach Stufe 5 (500 €) und 10 (16.000 €).</li>
            <li>Falsch oder zu spät heißt: zurück auf die letzte Sicherheitsstufe.</li>
          </ul>
        </section>

        <section className="quiz-card">
          <h2 className="quiz-card-head">
            Rangliste · {QUIZ_MODES.find((m) => m.mode === boardMode)?.label}
          </h2>
          <Board rows={board} />
        </section>
      </div>
    )
  }

  // ── Rangliste ────────────────────────────────────────────────────
  if (phase === 'board') {
    return (
      <div className="quiz-screen list-screen">
        <header className="list-head">
          <div className="list-head-text">
            <h1>Rangliste</h1>
            <p>Beste Runde pro Person</p>
          </div>
        </header>
        <div className="quiz-board-tabs" role="tablist">
          {QUIZ_MODES.map((entry) => (
            <button
              key={entry.mode}
              type="button"
              role="tab"
              aria-selected={boardMode === entry.mode}
              className={`quiz-board-tab${boardMode === entry.mode ? ' is-on' : ''}`}
              onClick={() => { void showBoard(entry.mode) }}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <section className="quiz-card">
          <Board rows={board} />
        </section>
        <button
          type="button" className="quiz-ghost"
          onClick={() => { void loadLobby(); setPhase('lobby') }}
        >
          Zurück zur Auswahl
        </button>
      </div>
    )
  }

  // ── Ergebnis ─────────────────────────────────────────────────────
  if (phase === 'done' && result) {
    const title = result.outcome === 'won'
      ? 'Millionär!'
      : result.outcome === 'banked' ? 'Mitgenommen' : 'Vorbei'
    return (
      <div className="quiz-screen list-screen">
        <header className="list-head">
          <div className="list-head-text">
            <h1>{title}</h1>
            <p>{QUIZ_MODES.find((m) => m.mode === mode)?.label}</p>
          </div>
        </header>

        <section className={`quiz-result is-${result.outcome}`}>
          <span className="quiz-result-kicker">Stufe erreicht</span>
          <span className="quiz-result-step">{result.reached}<small>/15</small></span>
          <span className="quiz-result-bank">{euro(result.bank)}</span>
          <span className="quiz-result-note">
            {result.outcome === 'won'
              ? 'Alle 15 Stufen — die volle Million.'
              : result.outcome === 'banked'
                ? 'Rechtzeitig aufgehört und gesichert.'
                : 'Zurück auf die letzte Sicherheitsstufe.'}
          </span>
        </section>

        <div className="quiz-actions">
          <button
            type="button" className="quiz-primary"
            disabled={busy}
            onClick={() => { if (!busy) void startMode(mode) }}
          >
            <RotateCcw size={16} strokeWidth={2} /> Nochmal
          </button>
          <button type="button" className="quiz-ghost" onClick={() => { void showBoard(mode) }}>
            <Trophy size={16} strokeWidth={2} /> Rangliste
          </button>
        </div>
        <button
          type="button" className="quiz-ghost"
          onClick={() => { void loadLobby(); setPhase('lobby') }}
        >
          Zur Auswahl
        </button>
      </div>
    )
  }

  if (!question) {
    return (
      <div className="quiz-screen list-screen">
        <div className="quiz-empty">Lädt…</div>
      </div>
    )
  }

  // ── Spielen / Auflösung ──────────────────────────────────────────
  const answered = phase === 'reveal'
  const reached = question.step - 1
  // Während der Auflösung ist question.step die GERADE beantwortete Stufe.
  const safeHere = QUIZ_SAFE_STEPS.includes(answered ? question.step : reached)
  const ratio = Math.max(0, Math.min(1, remaining / TIMER_SECONDS))
  const circumference = 2 * Math.PI * 15
  const locked = answered || busy || dialogOpen

  return (
    <div className="quiz-screen list-screen">
      <header className="quiz-top">
        <div className="quiz-top-left">
          <span className="quiz-kicker">
            Stufe {question.step} von {question.step_count}
          </span>
          <span className="quiz-worth">{euro(question.value)}</span>
        </div>
        <div
          className={`quiz-ring${remaining <= 5 ? ' is-low' : ''}${answered ? ' is-paused' : ''}`}
          role="timer"
          aria-label={answered ? 'Zeit gestoppt' : `${Math.ceil(remaining)} Sekunden`}
        >
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <circle className="quiz-ring-track" cx="18" cy="18" r="15" />
            <circle
              className="quiz-ring-bar"
              cx="18" cy="18" r="15"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - (answered ? 1 : ratio))}
            />
          </svg>
          <span className="quiz-ring-num">{answered ? <Check size={14} strokeWidth={3} /> : Math.ceil(remaining)}</span>
        </div>
      </header>

      <div className="quiz-ladder" aria-hidden="true">
        {QUIZ_LADDER.map((_, i) => {
          const step = i + 1
          const state = answered
            ? (step <= question.step ? (step === question.step ? 'is-now' : 'is-done') : '')
            : (step <= reached ? 'is-done' : step === question.step ? 'is-now' : '')
          return (
            <span
              key={step}
              className={`quiz-bar ${state}${QUIZ_SAFE_STEPS.includes(step) ? ' is-safe' : ''}`}
            />
          )
        })}
      </div>

      <section className={`quiz-question${answered ? (reveal?.correct ? ' is-right' : ' is-wrong') : ''}`}>
        <p className="quiz-question-text">{question.question}</p>
      </section>

      <div className="quiz-options">
        {question.options.map((option, index) => {
          const gone = eliminated.includes(index)
          const isCorrect = answered && reveal?.correct_index === index
          const isChosen = answered && reveal?.chosen === index
          const state = isCorrect ? ' is-right' : isChosen ? ' is-wrong' : gone ? ' is-gone' : ''
          const share = audience?.[String(index)]
          return (
            <button
              key={index}
              type="button"
              className={`quiz-option${state}`}
              disabled={locked || gone}
              onClick={() => { void submit(index) }}
            >
              <span className="quiz-letter">{'ABCD'[index]}</span>
              <span className="quiz-option-text">{option}</span>
              {share !== undefined && !answered && (
                <span className="quiz-share">{share}%</span>
              )}
              {isCorrect && <Check size={16} strokeWidth={3} className="quiz-mark" />}
              {isChosen && !isCorrect && <XIcon size={16} strokeWidth={3} className="quiz-mark" />}
            </button>
          )
        })}
      </div>

      {answered && reveal && (
        <div className="quiz-explain" role="status" aria-live="polite">
          <strong className={reveal.correct ? 'is-right' : 'is-wrong'}>
            {reveal.correct ? 'Richtig.' : reveal.timeout ? 'Zeit abgelaufen.' : 'Leider falsch.'}
          </strong>
          {reveal.explanation && <span>{reveal.explanation}</span>}
        </div>
      )}

      {pending !== null && !answered && (
        <div className="quiz-offline" role="alert">
          <span>Antwort nicht angekommen — keine Verbindung?</span>
          <button type="button" className="quiz-ghost" onClick={retry}>
            Erneut senden
          </button>
        </div>
      )}

      <footer className="quiz-foot">
        {!answered && (
          <>
            <div className="quiz-jokers">
              <button
                type="button" className="quiz-joker"
                disabled={!question.jokers.fifty || locked}
                onClick={() => { void applyJoker('fifty') }}
                aria-label="50:50-Joker"
              >
                <Scissors size={16} strokeWidth={2} /> 50:50
              </button>
              <button
                type="button" className="quiz-joker"
                disabled={!question.jokers.audience || locked}
                onClick={() => { void applyJoker('audience') }}
                aria-label="Publikumsjoker"
              >
                <Users size={16} strokeWidth={2} /> Publikum
              </button>
              <button
                type="button" className="quiz-joker"
                disabled={!question.jokers.call || locked}
                onClick={() => toast('Telefonjoker kommt später — frag die anderen so lange im Chat.', 'info')}
                aria-label="Telefonjoker"
              >
                <Phone size={16} strokeWidth={2} /> Telefon
              </button>
            </div>
            <button
              type="button" className="quiz-bank"
              disabled={reached === 0 || locked}
              onClick={takeMoney}
            >
              <Coins size={16} strokeWidth={2} />
              {reached === 0 ? 'Noch nichts zu holen' : `${euro(QUIZ_LADDER[reached - 1])} mitnehmen`}
            </button>
          </>
        )}
        {answered && (
          <button
            ref={nextRef}
            type="button" className="quiz-primary"
            disabled={busy}
            onClick={() => { void next() }}
          >
            {result ? 'Ergebnis' : 'Weiter'} <ChevronRight size={16} strokeWidth={2} />
          </button>
        )}
        {answered && (
          <p className="quiz-safe-note">
            {safeHere
              ? 'Sicherheitsstufe erreicht — ab jetzt ist dein Geld sicher.'
              : question.step > 10
                ? 'Sicher: 16.000 €'
                : question.step > 5
                  ? 'Sicher: 500 €'
                  : 'Nichts gesichert bis Stufe 5 (500 €)'}
          </p>
        )}
      </footer>
    </div>
  )
}

function Board({ rows }: { rows: QuizBoardRow[] }) {
  if (rows.length === 0) {
    return <p className="quiz-empty">Noch keine Runde gespielt.</p>
  }
  return (
    <ol className="quiz-board">
      {rows.map((row, index) => (
        <li className="quiz-board-row" key={row.participant}>
          <span className={`quiz-rank is-${index + 1}`}>{index + 1}</span>
          <span className="quiz-board-body">
            <span className="quiz-board-name">{row.participant}</span>
            <span className="quiz-board-meta">
              {row.runs === 1 ? '1 Runde' : `${row.runs} Runden`}
              {row.seconds > 0 ? ` · ${clock(row.seconds)}` : ''}
            </span>
          </span>
          <span className="quiz-board-score">
            {row.reached}<small>/15</small>
          </span>
        </li>
      ))}
    </ol>
  )
}
