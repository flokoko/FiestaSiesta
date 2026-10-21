export type ThemeMode = 'light' | 'dark' | 'auto'

const STORAGE_KEY = 'theme'

/** Read the stored theme preference (default: 'auto') */
export function getTheme(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'auto') {
    return stored
  }
  return 'auto'
}

/** Store the theme preference and apply it to <html data-theme="…"> */
export function setTheme(theme: ThemeMode): void {
  localStorage.setItem(STORAGE_KEY, theme)
  applyTheme()
}

/** Resolve 'auto' to the actual system preference; set data-theme on <html> */
export function applyTheme(): void {
  const mode = getTheme()
  const resolved =
    mode === 'auto'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : mode
  document.documentElement.setAttribute('data-theme', resolved)
}

/**
 * Start listening to system colour-scheme changes.
 * Only matters while the stored preference is 'auto'.
 * Returns a cleanup function.
 */
export function initThemeListener(): () => void {
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => {
    if (getTheme() === 'auto') applyTheme()
  }
  mql.addEventListener('change', handler)
  return () => mql.removeEventListener('change', handler)
}

/** Convenience: cycle auto → dark → light → auto … */
export function toggleTheme(): ThemeMode {
  const current = getTheme()
  const next: ThemeMode = current === 'auto' ? 'dark' : current === 'dark' ? 'light' : 'auto'
  setTheme(next)
  return next
}

/** Returns the *resolved* theme ('light' | 'dark'), never 'auto' */
export function getResolvedTheme(): 'light' | 'dark' {
  const mode = getTheme()
  if (mode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}