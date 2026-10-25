import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initGlassMotion } from './lib/glassMotion'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastProvider } from './context/ToastContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
)

// Glas-Bewegung: Lichtreflex folgt Zeiger/Scroll
initGlassMotion()

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/FiestaSiesta/sw.js').then((reg) => {
      // Eine installierte PWA läuft im Urlaub tagelang. Ohne aktives update() merkt
      // sie ein Deploy nie — der „Neue Version verfügbar"-Banner bliebe wirkungslos.
      let lastCheck = 0
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return
        if (Date.now() - lastCheck < 30 * 60 * 1000) return
        lastCheck = Date.now()
        reg.update().catch(() => {})
      })
    }).catch(() => {})
  })
}