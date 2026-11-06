import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BookOpen, Palmtree, Trophy, Scissors, Users, Phone, ChevronRight,
  RotateCcw, Coins, Timer, Check, X as XIcon,
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

  const deadlineRef = useRef(0)
  const answeredRef = useRef(false)
  const runRef = useRef<string | null>(null)
  // Solange der „aufhören?"-Dialog offen ist, darf die Uhr den Lauf nicht
  // abwürgen — sonst verliert man die Runde, während man noch überlegt.
  const dialogRef = useRef(false)

  const loadLobby = useCallback(async () => {
    try {
      const [ov, lb] = await Promise.all([
        quizOverview(userName),
        quizLeaderboard('general'),
      ])
      setModes(ov.modes ?? [])
      setBoard(lb.rows ?? [])
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
      setQuestion(data)
      deadlineRef.current = Date.parse(String(data.deadline))
      setRemaining(Math.max(0, (deadlineRef.current - Date.now()) / 1000))
      answeredRef.current = false
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
      answeredRef.current = false
      toast(err instanceof Error ? err.message : 'Antwort nicht angekommen', 'error')
    } finally {
      setBusy(false)
    }
  }, [toast, userName])

  // Countdown: rechnet gegen die Server-Deadline, nicht gegen einen lokalen Start.
  useEffect(() => {
    if (phase !== 'playing') return
    const tick = () => {
      const left = (deadlineRef.current - Date.now()) / 1000
      setRemaining(Math.max(0, left))
      if (left <= 0 && !answeredRef.current && !dialogRef.current) void submit(-1)
    }
    tick()
    const id = window.setInterval(tick, 200)
    return () => window.clearInterval(id)
  }, [phase, submit])

  const startMode = useCallback(async (next: QuizMode) => {
    setBusy(true)
    try {
      const run = await quizStart(next, userName)
      setMode(next)
      runRef.current = run.run_id
      setResult(null)
      await loadQuestion(run.run_id)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Runde konnte nicht starten', 'error')
      setPhase('lobby')
    } finally {
      setBusy(false)
    }
  }, [loadQuestion, toast, userName])

  const next = useCallback(async () => {
    if (!runRef.current) return
    if (result) {
      setPhase('done')
      return
    }
    await loadQuestion(runRef.current)
  }, [loadQuestion, result])

  const takeMoney = useCallback(() => {
    if (!runRef.current || !question) return
    const win = QUIZ_LADDER[Math.max(0, question.step - 2)]
    dialogRef.current = true
    confirm(
      `Für ${euro(win)} aufhören?`,
      async () => {
        dialogRef.current = false
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
      () => { dialogRef.current = false },
      'Mitnehmen',
    )
  }, [confirm, question, toast, userName])

  const applyJoker = useCallback(async (kind: 'fifty' | 'audience' | 'call') => {
    if (!runRef.current) return
    try {
      const data = await quizJoker(runRef.current, userName, kind)
      if (data.eliminated) setEliminated(data.eliminated)
      if (data.distribution) setAudience(data.distribution)
      setQuestion((prev) => (prev ? { ...prev, jokers: data.jokers } : prev))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Joker nicht verfügbar', 'error')
    }
  }, [toast, userName])

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
            const ready = count >= 15
            return (
              <button
                key={entry.mode}
                type="button"
                className={`quiz-mode${ready ? '' : ' is-locked'}`}
                onClick={() => { if (ready && !busy) void startMode(entry.mode) }}
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
                    {ready ? `${count} Fragen · Beste Runde ${info?.best ?? 0}/15` : 'Fragen folgen'}
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
            <li>Sicher ist dein Geld nach Stufe 5 (500 €) und 10 (32.000 €).</li>
            <li>Falsch oder zu spät heißt: zurück auf die letzte Sicherheitsstufe.</li>
          </ul>
        </section>

        <section className="quiz-card">
          <h2 className="quiz-card-head">Rangliste</h2>
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
        <button type="button" className="quiz-ghost" onClick={() => setPhase('lobby')}>
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
          <button type="button" className="quiz-primary" onClick={() => { void startMode(mode) }}>
            <RotateCcw size={16} strokeWidth={2} /> Nochmal
          </button>
          <button type="button" className="quiz-ghost" onClick={() => { void showBoard(mode) }}>
            <Trophy size={16} strokeWidth={2} /> Rangliste
          </button>
        </div>
        <button type="button" className="quiz-ghost" onClick={() => { void loadLobby(); setPhase('lobby') }}>
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
  const safeHere = QUIZ_SAFE_STEPS.includes(question.step - 1)
  const ratio = Math.max(0, Math.min(1, remaining / TIMER_SECONDS))
  const circumference = 2 * Math.PI * 15

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
          aria-live="off"
          aria-label={`${Math.ceil(remaining)} Sekunden`}
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
              key={option}
              type="button"
              className={`quiz-option${state}`}
              disabled={answered || gone || busy}
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
        <div className="quiz-explain">
          <strong className={reveal.correct ? 'is-right' : 'is-wrong'}>
            {reveal.correct ? 'Richtig.' : reveal.timeout ? 'Zeit abgelaufen.' : 'Leider falsch.'}
          </strong>
          {reveal.explanation && <span>{reveal.explanation}</span>}
        </div>
      )}

      <footer className="quiz-foot">
        {!answered && (
          <>
            <div className="quiz-jokers">
              <button
                type="button" className="quiz-joker"
                disabled={!question.jokers.fifty || busy}
                onClick={() => { void applyJoker('fifty') }}
                aria-label="50:50-Joker"
              >
                <Scissors size={16} strokeWidth={2} /> 50:50
              </button>
              <button
                type="button" className="quiz-joker"
                disabled={!question.jokers.audience || busy}
                onClick={() => { void applyJoker('audience') }}
                aria-label="Publikumsjoker"
              >
                <Users size={16} strokeWidth={2} /> Publikum
              </button>
              <button
                type="button" className="quiz-joker"
                disabled={!question.jokers.call || busy}
                onClick={() => toast('Telefonjoker kommt später — frag die anderen so lange im Chat.', 'info')}
                aria-label="Telefonjoker"
              >
                <Phone size={16} strokeWidth={2} /> Telefon
              </button>
            </div>
            <button
              type="button" className="quiz-bank"
              disabled={reached === 0 || busy}
              onClick={takeMoney}
            >
              <Coins size={16} strokeWidth={2} />
              {reached === 0 ? 'Noch nichts zu holen' : `${euro(QUIZ_LADDER[reached - 1])} mitnehmen`}
            </button>
          </>
        )}
        {answered && (
          <button type="button" className="quiz-primary" onClick={() => { void next() }}>
            {result ? 'Ergebnis' : 'Weiter'} <ChevronRight size={16} strokeWidth={2} />
          </button>
        )}
        {answered && (
          <p className="quiz-safe-note">
            {safeHere
              ? 'Sicherheitsstufe erreicht — ab jetzt ist dein Geld sicher.'
              : question.step > 10
                ? 'Sicher: 32.000 €'
                : question.step > 5
                  ? 'Sicher: 500 €'
                  : 'Nichts gesichert bis Stufe 5 (500 €)'}
          </p>
        )}
      </footer>

      <span className="quiz-timer-hint" aria-hidden="true">
        <Timer size={12} strokeWidth={2} /> {clock(remaining)}
      </span>
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
