import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your values.'
  )
}

// Fester Join-Code für die Liste (wird für RLS und login_participant benötigt).
// 'SIESTA26' ist der öffentliche Join-Code (steht im Login-Formular) und hartcodiert
// in der DB (lists.join_code) — für FiestaSiesta vom HOST per SQL angelegt; die App
// nutzt dasselbe Supabase-Projekt wie Bella Siestarella, Isolation über RLS via
// x-join-code-Header. Der Fallback ist KEIN Sicherheitsrisiko — ohne ihn
// wäre LIST_JOIN_CODE undefined → login_participant erhält nur p_name/p_password
// → PGRST202 "Could not find the function login_participant(p_name, p_password)".
const LIST_JOIN_CODE = import.meta.env.VITE_JOIN_CODE || 'SIESTA26'

// Module-level variable for the current join code (used for RLS)
const currentJoinCode = LIST_JOIN_CODE

export function getJoinCode() {
  return currentJoinCode
}

// Custom fetch that injects the x-join-code header on every request
const customFetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const headers = new Headers(init.headers)
  if (currentJoinCode) {
    headers.set('x-join-code', currentJoinCode)
  }
  return fetch(input, { ...init, headers })
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: customFetch },
  realtime: {
    params: { eventsPerSecond: 2 },
  },
})

// ── Login / Auth helpers ──────────────────────────────────────────

export interface LoginResult {
  list_id: string
  list_name: string
  join_code: string
  participant_id: string
  participant_name: string
  is_admin: boolean
  is_new?: boolean
  error?: string
}

export async function loginParticipant(
  name: string,
  password: string
): Promise<LoginResult> {
  const { data, error } = await supabase.rpc('login_participant', {
    p_join_code: LIST_JOIN_CODE,
    p_name: name,
    p_password: password,
  })
  if (error) {
    return { error: error.message } as LoginResult
  }
  return data as LoginResult
}

export async function changeParticipantPassword(
  participantId: string,
  oldPassword: string,
  newPassword: string
): Promise<{ success?: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('change_participant_password', {
    p_participant_id: participantId,
    p_old_password: oldPassword,
    p_new_password: newPassword,
  })
  if (error) {
    return { error: error.message }
  }
  return data as { success?: boolean; error?: string }
}

export async function restoreParticipantSession(
  participantId: string
): Promise<LoginResult> {
  const { data, error } = await supabase.rpc('restore_participant_session', {
    p_participant_id: participantId,
  })
  if (error) {
    return { error: error.message } as LoginResult
  }
  return data as LoginResult
}
