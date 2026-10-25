/**
 * Übersetzt bekannte Supabase/Netzwerk-Fehler in kurze deutsche Nutzertexte.
 * Unbekannte Fehler fallen auf die Originalmeldung zurück.
 */
export function friendlyError(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return 'Unbekannter Fehler'
  if (error.code === '23505') return 'Das gibt es schon.'
  if (error.code === '42501' || error.message?.includes('row-level security')) {
    return 'Keine Berechtigung für diesen Eintrag.'
  }
  if (error.code === '23503') return 'Der Eintrag wird noch verwendet.'
  if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
    return 'Keine Verbindung — bitte später erneut versuchen.'
  }
  return error.message ?? 'Unbekannter Fehler'
}
