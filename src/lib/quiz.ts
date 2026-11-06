import { supabase } from './supabase'

// ── Quiz „Wer wird Siesta-Millionär" ────────────────────────────────
// Der Antwortschlüssel liegt ausschließlich in der DB: die RPCs liefern
// Frage + vier Antworten, aber nie den richtigen Index (erst nach dem
// Antworten, zur Auflösung). Deshalb gibt es hier keinen lokalen Fragenkatalog.

export type QuizMode = 'general' | 'island'

export interface QuizModeInfo {
  mode: QuizMode
  questions: number
  /** Wie viele der 15 Stufen besetzt sind — nur dann ist der Modus spielbar. */
  steps: number
  best: number
  runs: number
  open_run: string | null
}

export interface QuizBoardRow {
  participant: string
  reached: number
  best_bank: number
  seconds: number
  runs: number
  won: number
}

export interface QuizQuestion {
  step: number
  step_count: number
  question: string
  options: string[]
  bank: number
  value: number
  jokers: { fifty: boolean; audience: boolean; call: boolean }
  deadline: string
  /** Serverzeit beim Abruf — der Client korrigiert damit seinen Uhrenversatz. */
  now?: string
  seconds: number
}

export interface QuizReveal {
  correct: boolean
  timeout?: boolean
  correct_index: number
  explanation: string | null
  outcome: 'playing' | 'won' | 'lost' | 'banked'
  reached?: number
  bank?: number
  step?: number
  value?: number
}

export interface QuizResult {
  outcome: 'won' | 'lost' | 'banked'
  reached: number
  bank: number
}

/** Leiter in Siesta-Euro — muss zur SQL-Funktion quiz_ladder() passen. */
export const QUIZ_LADDER = [
  50, 100, 200, 300, 500, 1000, 2000, 4000, 8000,
  16000, 32000, 64000, 125000, 500000, 1000000,
]

/** Stufen, nach denen das Geld sicher ist. */
export const QUIZ_SAFE_STEPS = [5, 10]

export const QUIZ_MODES: Array<{ mode: QuizMode; label: string; hint: string }> = [
  { mode: 'general', label: 'Allgemeinwissen', hint: '180 Fragen · weltweit' },
  { mode: 'island', label: 'Gran Canaria', hint: 'Inselwissen und Trivia' },
]

export function euro(value: number): string {
  return new Intl.NumberFormat('de-DE').format(value) + ' €'
}

/** „8:07" aus Sekunden. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

type RpcResult = Record<string, unknown>

async function call<T>(name: string, args: RpcResult): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  if (data && typeof data === 'object' && 'error' in (data as RpcResult)) {
    throw new Error(String((data as RpcResult).error))
  }
  return data as T
}

export function quizOverview(participant: string) {
  return call<{ modes: QuizModeInfo[] }>('quiz_overview', { p_participant: participant })
}

export function quizLeaderboard(mode: QuizMode) {
  return call<{ mode: QuizMode; rows: QuizBoardRow[] }>('quiz_leaderboard', { p_mode: mode })
}

export function quizStart(mode: QuizMode, participant: string) {
  return call<{ run_id: string; mode: QuizMode; steps: number }>('quiz_start', {
    p_mode: mode,
    p_participant: participant,
  })
}

export type QuizCurrent =
  | (QuizQuestion & { outcome?: undefined })
  | ({ outcome: 'won' | 'lost' | 'banked'; reached: number; bank: number } & Partial<QuizQuestion>)

export function quizCurrent(runId: string, participant: string) {
  return call<QuizCurrent>('quiz_current', { p_run_id: runId, p_participant: participant })
}

export function quizAnswer(runId: string, participant: string, choice: number) {
  return call<QuizReveal>('quiz_answer', {
    p_run_id: runId,
    p_participant: participant,
    p_choice: choice,
  })
}

export function quizBank(runId: string, participant: string) {
  return call<QuizResult & { outcome: 'banked' }>('quiz_bank', {
    p_run_id: runId,
    p_participant: participant,
  })
}

export function quizJoker(
  runId: string,
  participant: string,
  kind: 'fifty' | 'audience' | 'call',
) {
  return call<{
    eliminated?: number[]
    distribution?: Record<string, number>
    jokers: QuizQuestion['jokers']
  }>('quiz_joker', { p_run_id: runId, p_participant: participant, p_kind: kind })
}
