import { useState, useEffect, useRef, useMemo, useCallback, Suspense, lazy, type ReactNode } from 'react'
import { ArrowLeft, WifiOff } from 'lucide-react'
import type { TabView } from './types'
import { getResolvedTheme, toggleTheme, applyTheme, initThemeListener } from './lib/theme'
import { supabase, changeParticipantPassword } from './lib/supabase'
import { screenDirection, type ScreenDirection } from './lib/navTransition'
import { useToast } from './context/ToastContext'
import JoinScreen from './components/JoinScreen'
import NotesScreen from './components/NotesScreen'
import { spanishSuccess } from './lib/espanaFlair'
import { useListData } from './hooks/useListData'

// Code splitting: lazy-load screens that aren't needed on first paint.
// Die Import-Funktionen liegen separat, damit sie sich nach dem Login im
// Idle vorladen lassen (sonst zeigt der erste Besuch eines Tabs kurz den
// 🏖️-Loader — genau das wirkt wie „die Seite baut neu“).
const importListScreen = () => import('./components/ListScreen')
const importBringScreen = () => import('./components/BringScreen')
const importExpenseScreen = () => import('./components/ExpenseScreen')
const importSettingsScreen = () => import('./components/SettingsScreen')
const importBristolScreen = () => import('./components/BristolScreen')
const importWeatherScreen = () => import('./components/WeatherScreen')
const importTripPlanScreen = () => import('./components/TripPlanScreen')

const ListScreen = lazy(importListScreen)
const BringScreen = lazy(importBringScreen)
const ExpenseScreen = lazy(importExpenseScreen)
const SettingsScreen = lazy(importSettingsScreen)
const BristolScreen = lazy(importBristolScreen)
const WeatherScreen = lazy(importWeatherScreen)
const TripPlanScreen = lazy(importTripPlanScreen)

// Leichte Screens direkt nach dem Login, schwere (Bristol ~416 kB, Wetter
// ~167 kB) erst im Idle — sie liegen sonst unnötig im Mobilfunk-Datenvolumen.
const SCREEN_CHUNKS_EAGER = [
  importListScreen,
  importBringScreen,
  importTripPlanScreen,
  importSettingsScreen,
  importExpenseScreen,
]
const SCREEN_CHUNKS_IDLE = [importWeatherScreen, importBristolScreen]
import TodayScreen from './components/TodayScreen'
import TripScreen from './components/TripScreen'
import ListsScreen from './components/ListsScreen'
import BottomNav from './components/BottomNav'
import MoreSheet from './components/MoreSheet'
import BristolGate from './components/BristolGate'

function TabLoader() {
  return (
    <div className="tab-loader">
      <span className="tab-loader-emoji">🏖️</span>
      <span className="tab-loader-text">Lädt…</span>
    </div>
  )
}

/**
 * Ein Screen als „Pane“: bleibt nach dem ersten Besuch gemountet und wird nur
 * versteckt. Das ist der Kern gegen das Flackern: kein Remount, kein erneuter
 * Chunk-Load, keine verlorenen Formular-/Filter-Zustände.
 *
 * Bewusst OHNE Animation: jeder Ein-/Überblender über der ganzen Seite wurde
 * auf dem Gerät als Flackern wahrgenommen. Der Wechsel ist ein harter Schnitt;
 * Bewegung gibt es nur an Kleinteilen (Nav-Pille, Kopfzeile).
 */
function ScreenPane({
  id,
  active,
  direction,
  children,
}: {
  id: TabView
  active: boolean
  direction: ScreenDirection
  children: ReactNode
}) {
  return (
    <div
      className="screen-pane"
      data-tab={id}
      data-state={active ? 'active' : 'idle'}
      data-dir={direction}
      aria-hidden={active ? undefined : true}
    >
      {children}
    </div>
  )
}

import './App.css'
import './nav.css'
import './design.css'
import './design-expense.css'

// ── Confetti helper: spanische Flagge (Rot-Gelb-Rot) ─────────────────
async function fireConfetti() {
  const { default: confetti } = await import('canvas-confetti')
  const colors = ['#AA151B', '#F1BF00', '#AA151B']
  // Burst 1: center, upward
  confetti({
    particleCount: 80,
    spread: 70,
    origin: { y: 0.6 },
    colors,
    startVelocity: 35,
    scalar: 0.9,
  })
  // Burst 2: left side
  setTimeout(() => {
    confetti({
      particleCount: 50,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.7 },
      colors,
      startVelocity: 40,
    })
  }, 200)
  // Burst 3: right side
  setTimeout(() => {
    confetti({
      particleCount: 50,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.7 },
      colors,
      startVelocity: 40,
    })
  }, 400)
  // Vibrate
  navigator.vibrate?.([100, 50, 100, 50, 200])
}

/**
 * Startbild, solange eine gespeicherte Sitzung geprüft wird. Ohne das blitzt bei
 * jedem Öffnen der Login auf, obwohl man angemeldet ist: userName/list sind in
 * den ersten Momenten null. Gleiches Markup wie in index.html, damit der Wechsel
 * von der statischen Seite in die App unsichtbar ist.
 */
function BootSplash() {
  return (
    <div className="boot-splash" role="status" aria-label="Fiesta Siesta wird geladen">
      <span className="boot-flag" aria-hidden="true">
        <span></span><span></span><span></span>
      </span>
      <span className="boot-name">Fiesta Siesta</span>
    </div>
  )
}

export default function App() {
  const { toast } = useToast()

  const {
    userName, list, participantId, shoppingItems, bringItems, categories,
    notes, expenses, expenseSplits, expenseQuotas, participants, adminUnlocked,
    isAdmin, shoppingCategories, bringCategories, knownPersons, userBalance,
    expenseTotal, checkedCount, isLoading, isOnline, queueLength, flushQueue, restoringSession,
    setList, setAdminUnlocked,
    fetchAll,
    fetchItems, fetchCategories, fetchNotes, fetchExpenses, fetchParticipants, fetchExpenseQuotas, fetchSettlements,
    toggleShoppingItem, deleteShoppingItem, undoDelete, batchToggleShoppingItems, toggleBringItem, deleteBringItem, reorderItems, reorderNotes, toggleNoteFavorite,
    handleJoin, handleLeave, handleRename,
    undoState,
    settlements,
  } = useListData()

  // ── Tab state ──────────────────────────────────────────────────────
  const [tab, setTabState] = useState<TabView>('home')
  const [moreOpen, setMoreOpen] = useState(false)

  const tabRef = useRef<TabView>('home')
  // Richtung des Wechsels: vorwärts = tiefer in den Baum, zurück = zurück.
  // Bewusst im Callback statt im Render (StrictMode rendert zweimal).
  const [screenDir, setScreenDir] = useState<ScreenDirection>('side')
  // Besuchte Screens bleiben gemountet (Pane-Ansatz) — nur der erste Besuch
  // mountet wirklich, danach wird nur noch ein- und ausgeblendet.
  const [visited, setVisited] = useState<ReadonlySet<TabView>>(() => new Set<TabView>(['home']))

  const setTab = useCallback((next: TabView) => {
    const prev = tabRef.current
    if (prev === next) return
    tabRef.current = next
    setScreenDir(screenDirection(prev, next))
    setVisited((v) => (v.has(next) ? v : new Set(v).add(next)))
    setTabState(next)
  }, [])

  // Lazy-Chunks im Idle vorladen: der erste Besuch eines Tabs zeigt sonst den
  // Loader und wirkt wie ein Neuaufbau. Kleine Screens sind ohnehin im
  // SW-Precache, hier geht es nur um den Dynamic Import.
  useEffect(() => {
    if (!list?.id) return
    for (const load of SCREEN_CHUNKS_EAGER) void load().catch(() => {})
    const runIdle = () => {
      for (const load of SCREEN_CHUNKS_IDLE) void load().catch(() => {})
    }
    const run = runIdle
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
    const w = window as IdleWindow
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(run, { timeout: 2500 })
      return () => w.cancelIdleCallback?.(id)
    }
    const id = window.setTimeout(run, 1200)
    return () => window.clearTimeout(id)
  }, [list?.id])

  // Jeder Tab beginnt oben — sonst landet man beim Wechsel mitten im Inhalt.
  // `html { scroll-behavior: smooth }` würde den Sprung animieren (sieht aus
  // wie ein Ruckeln), deshalb kurz auf hart schalten.
  useEffect(() => {
    const html = document.documentElement
    const previous = html.style.scrollBehavior
    html.style.scrollBehavior = 'auto'
    window.scrollTo(0, 0)
    html.style.scrollBehavior = previous
  }, [tab])

  // ── PWA update available banner ─────────────────────────────────────
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const sw = navigator.serviceWorker
    // A controller already present means this is a returning session — only
    // then does a new service worker count as a real "update" worth announcing.
    const hadController = !!sw.controller

    const onControllerChange = () => {
      if (hadController) setUpdateAvailable(true)
    }
    sw.addEventListener('controllerchange', onControllerChange)

    sw.ready.then((registration) => {
      // A waiting worker only matters for sessions that were already controlled
      // (a fresh install claims the page and must not show the banner).
      if (registration.waiting && hadController) {
        setUpdateAvailable(true)
      }
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && sw.controller) {
            setUpdateAvailable(true)
          }
        })
      })
    })

    return () => {
      sw.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  // ── Undo toast when items are deleted ───────────────────────────────
  useEffect(() => {
    if (undoState) {
      const itemNames = undoState.items.map(i => i.name).join(', ')
      toast(
        `${undoState.items.length} Item(s) gelöscht: ${itemNames}`,
        'info',
        { label: 'Rückgängig', onClick: undoDelete },
      )
    }
  }, [undoState, undoDelete, toast])

  // ── Bristol Modus (read-only via Event-Listener; SettingsScreen is the
  //    single writer for 'bristol_modus_enabled') ──────────────────────
  const [bristolEnabled, setBristolEnabled] = useState(
    () => localStorage.getItem('bristol_modus_enabled') === 'true'
  )

  // Listen for bristol modus changes from SettingsScreen
  useEffect(() => {
    const handler = () => setBristolEnabled(localStorage.getItem('bristol_modus_enabled') === 'true')
    window.addEventListener('bristol-modus-change', handler)
    return () => window.removeEventListener('bristol-modus-change', handler)
  }, [])

  // ── Theme ──────────────────────────────────────────────────────────
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    applyTheme()
    setIsDark(getResolvedTheme() === 'dark')
    const cleanup = initThemeListener()
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setIsDark(getResolvedTheme() === 'dark')
    mql.addEventListener('change', handler)
    return () => {
      cleanup()
      mql.removeEventListener('change', handler)
    }
  }, [])

  // ── Online/offline: handle flush + toast ───────────────────────────
  useEffect(() => {
    if (isOnline && queueLength > 0) {
      toast(`Synchronisiere ${queueLength} offene Änderungen…`, 'info')
      flushQueue().then(({ success, failed }) => {
        if (failed > 0) {
          toast('Einige Änderungen konnten nicht synchronisiert werden.', 'error')
        } else if (success > 0) {
          toast(`${spanishSuccess()} Synchronisiert!`, 'success')
          // Full refetch after successful sync — single fetchAll with force=true
          if (list) {
            fetchAll(list.id, true)
          }
        }
      })
    }
  }, [isOnline, queueLength, fetchAll, flushQueue, toast, list])

  // ── Confetti when all shopping items are checked off ───────────────
  const prevAllCheckedRef = useRef(false)

  useEffect(() => {
    const allChecked = shoppingItems.length > 0 && checkedCount === shoppingItems.length
    // Only fire on transition false → true (not on initial load)
    if (allChecked && !prevAllCheckedRef.current) {
      fireConfetti()
    }
    prevAllCheckedRef.current = allChecked
  }, [checkedCount, shoppingItems.length])

  // ── Note: no early return here — hooks must stay above the main return.

  // ── Event handlers ─────────────────────────────────────────────────
  const handleToggleTheme = () => {
    toggleTheme()
    setIsDark(getResolvedTheme() === 'dark')
  }

  const handleSetAdminPassword = async (password: string) => {
    if (!list) return
    const { data, error } = await supabase.rpc('set_admin_password', {
      p_list_id: list.id,
      p_password: password,
    })
    if (error || !data) {
      toast(`Fehler beim Speichern: ${error?.message || 'Unbekannter Fehler'}`, 'error')
      return
    }
    setList({ ...list, admin_password: 'hashed' })
    setAdminUnlocked(true)
    navigator.vibrate?.(10)
  }

  const handleChangeOwnPassword = async (oldPassword: string, newPassword: string) => {
    if (!participantId) return { error: 'Nicht angemeldet' }
    return changeParticipantPassword(participantId, oldPassword, newPassword)
  }

  const handleChangeAdminPassword = async (
    oldPassword: string,
    newPassword: string,
  ): Promise<{ success?: boolean; error?: string }> => {
    if (!list) return { error: 'Keine Liste geladen' }
    const { data, error } = await supabase.rpc('change_admin_password', {
      p_list_id: list.id,
      p_old_password: oldPassword,
      p_new_password: newPassword,
    })
    if (error) {
      return { error: error.message }
    }
    if (data?.error) {
      return { error: data.error }
    }
    if (data?.success) {
      toast('Admin-Passwort geändert!', 'success')
    }
    return data as { success?: boolean; error?: string }
  }

  const handleUnlockAdmin = async (password: string): Promise<boolean> => {
    if (!list) return false
    // Serverseitige Prüfung via RPC — Passwort bleibt auf dem Server
    const { data, error } = await supabase.rpc('verify_admin_password', {
      p_list_id: list.id,
      p_password: password,
    })
    if (error || !data) {
      return false
    }
    if (data) {
      setAdminUnlocked(true)
      navigator.vibrate?.(10)
      return true
    }
    return false
  }

  // ── Memoized callback wrappers for screen props ─────────────────────
  const handleNotesChange = useCallback(() => { if (list) fetchNotes(list.id) }, [list, fetchNotes])
  const handleShoppingItemsChange = useCallback(() => { if (list) fetchItems(list.id, 'shopping') }, [list, fetchItems])
  const handleBringItemsChange = useCallback(() => { if (list) fetchItems(list.id, 'bring') }, [list, fetchItems])
  const handleCategoriesChange = useCallback(() => { if (list) fetchCategories(list.id) }, [list, fetchCategories])
  const handleExpensesChange = useCallback(() => { if (list) fetchExpenses(list.id) }, [list, fetchExpenses])
  const handleQuotasChange = useCallback(() => { if (list) fetchExpenseQuotas(list.id) }, [list, fetchExpenseQuotas])
  const handleSettlementsChange = useCallback(() => { if (list) fetchSettlements(list.id) }, [list, fetchSettlements])
  const handleParticipantsChange = useCallback(() => { if (list) fetchParticipants(list.id) }, [list, fetchParticipants])

  // ── Render ─────────────────────────────────────────────────────────
  const expenseCategories = useMemo(() => categories.filter(c => c.list_type === 'expense'), [categories])

  // Wohin der Zurück-Pfeil zeigt: Unterseiten → Domäne, Blatt-Ziele → Heute
  const backTarget: TabView | null =
    tab === 'list' || tab === 'bring'
      ? 'lists'
      : tab === 'notes' || tab === 'weather' || tab === 'settings'
        ? 'home'
        : null

  const bringBrought = bringItems.filter(i => i.is_brought).length


  if (restoringSession) return <BootSplash />

  return (
    <>
      {!userName || !list ? (
        <>
          <JoinScreen onJoin={handleJoin} />
        </>
      ) : (
    <div className="app">
      <header className="app-header">
        <div className="header-top">
          {/* Beide Zustände bleiben im DOM und blenden über (Stufe 3):
              der Zurück-Pfeil fährt ein, das Listen-Köpfchen gleitet zur Seite. */}
          <div className="header-slot">
            <button
              type="button"
              className={`header-back${backTarget ? ' is-on' : ''}`}
              onClick={() => backTarget && setTab(backTarget)}
              aria-hidden={!backTarget}
              tabIndex={backTarget ? undefined : -1}
            >
              <ArrowLeft size={18} strokeWidth={2} /> Zurück
            </button>
            <div className={`header-info${backTarget ? '' : ' is-on'}`} aria-hidden={!!backTarget}>
              <span className="header-name">
                <span className="header-flag">
                  <span className="header-flag-band red"></span>
                  <span className="header-flag-band yellow"></span>
                  <span className="header-flag-band red-bottom"></span>
                </span>
                {list.name}
              </span>
              <span className="header-user">
                {userName}
              </span>
            </div>
          </div>
        </div>
        <div className="header-flag-bar-full">
          <span className="header-flag-red"></span>
          <span className="header-flag-yellow"></span>
          <span className="header-flag-red bottom"></span>
        </div>
      </header>

      {!isOnline && (
        <div className="offline-banner">
          <WifiOff size={16} strokeWidth={2} /> Du bist offline — {queueLength > 0 ? `${queueLength} ${queueLength === 1 ? 'Änderung wird' : 'Änderungen werden'} synchronisiert` : 'Änderungen können momentan nicht gespeichert werden'}.
        </div>
      )}

      {updateAvailable && (
        <div className="update-banner">
          <span>🆕 Neue Version verfügbar!</span>
          <button className="update-banner-btn" onClick={() => window.location.reload()}>
            Aktualisieren
          </button>
        </div>
      )}

      <main className="app-main">
        <div className="screen-stack">
          {visited.has('home') && (
            <ScreenPane id="home" active={tab === 'home'} direction={screenDir}>
          <TodayScreen
            userName={userName}
            listName={list.name}
            participantCount={participants.length}
            shoppingCount={shoppingItems.length}
            shoppingChecked={checkedCount}
            bringCount={bringItems.length}
            expenseTotal={expenseTotal}
            userBalance={userBalance}
            bristolEnabled={bristolEnabled}
            onNavigate={setTab}
          />
            </ScreenPane>
          )}
          {visited.has('trip') && (
            <ScreenPane id="trip" active={tab === 'trip'} direction={screenDir}>
          <TripScreen onNavigate={setTab} notesCount={notes.length} listId={list.id} />
            </ScreenPane>
          )}
          {visited.has('plan') && (
            <ScreenPane id="plan" active={tab === 'plan'} direction={screenDir}>
          <Suspense fallback={<TabLoader />}>
            <TripPlanScreen
              listId={list.id}
              userName={userName}
              isAdmin={isAdmin}
              onBack={() => setTab('trip')}
            />
          </Suspense>
            </ScreenPane>
          )}
          {visited.has('lists') && (
            <ScreenPane id="lists" active={tab === 'lists'} direction={screenDir}>
          <ListsScreen
            shoppingCount={shoppingItems.length}
            shoppingChecked={checkedCount}
            bringCount={bringItems.length}
            bringBrought={bringBrought}
            onNavigate={setTab}
          />
            </ScreenPane>
          )}
          {visited.has('notes') && (
            <ScreenPane id="notes" active={tab === 'notes'} direction={screenDir}>
          <NotesScreen
            listId={list.id}
            userName={userName}
            notes={notes}
            isLoading={isLoading}
            onNotesChange={handleNotesChange}
            onReorderNotes={reorderNotes}
            onToggleFavorite={toggleNoteFavorite}
          />
            </ScreenPane>
          )}
          {visited.has('list') && (
            <ScreenPane id="list" active={tab === 'list'} direction={screenDir}>
          <Suspense fallback={<TabLoader />}>
            <ListScreen
              items={shoppingItems}
              categories={shoppingCategories}
              listId={list.id}
              userName={userName}
              isLoading={isLoading}
              onItemToggle={toggleShoppingItem}
              onBatchToggle={batchToggleShoppingItems}
              onItemDelete={deleteShoppingItem}
              onItemChange={handleShoppingItemsChange}
              onReorder={reorderItems}
              onCategoriesChange={handleCategoriesChange}
            />
          </Suspense>
            </ScreenPane>
          )}
          {visited.has('bring') && (
            <ScreenPane id="bring" active={tab === 'bring'} direction={screenDir}>
          <Suspense fallback={<TabLoader />}>
            <BringScreen
              items={bringItems}
              categories={bringCategories}
              listId={list.id}
              userName={userName}
              onItemToggle={toggleBringItem}
              onItemDelete={deleteBringItem}
              onItemChange={handleBringItemsChange}
              onReorder={reorderItems}
              onCategoriesChange={handleCategoriesChange}
              persons={participants.map(p => p.name)}
            />
          </Suspense>
            </ScreenPane>
          )}
          {visited.has('expenses') && (
            <ScreenPane id="expenses" active={tab === 'expenses'} direction={screenDir}>
          <Suspense fallback={<TabLoader />}>
            <ExpenseScreen
              expenses={expenses}
              expenseSplits={expenseSplits}
              expenseQuotas={expenseQuotas}
              listId={list.id}
              userName={userName}
              knownPersons={knownPersons}
              expenseCategories={expenseCategories}
              isLoading={isLoading}
              isAdmin={isAdmin}
              adminUnlocked={adminUnlocked}
              onExpensesChange={handleExpensesChange}
              onCategoriesChange={handleCategoriesChange}
              onQuotasChange={handleQuotasChange}
              settlements={settlements}
              onSettlementsChange={handleSettlementsChange}
            />
          </Suspense>
            </ScreenPane>
          )}
          {visited.has('bristol') && (
            <ScreenPane id="bristol" active={tab === 'bristol'} direction={screenDir}>
              {!bristolEnabled && (
          <BristolGate
            onEnable={() => {
              localStorage.setItem('bristol_modus_enabled', 'true')
              window.dispatchEvent(new CustomEvent('bristol-modus-change'))
              setBristolEnabled(true)
            }}
          />
              )}
              {bristolEnabled && (
          <Suspense fallback={<TabLoader />}>
            <BristolScreen
              listId={list.id}
              userName={userName}
              isAdmin={isAdmin}
            />
          </Suspense>
              )}
            </ScreenPane>
          )}
          {visited.has('weather') && (
            <ScreenPane id="weather" active={tab === 'weather'} direction={screenDir}>
          <Suspense fallback={<TabLoader />}>
            <WeatherScreen />
          </Suspense>
            </ScreenPane>
          )}
          {visited.has('settings') && (
            <ScreenPane id="settings" active={tab === 'settings'} direction={screenDir}>
          <Suspense fallback={<TabLoader />}>
            <SettingsScreen
              userName={userName}
              listName={list.name}
              onLeave={handleLeave}
              onRename={handleRename}
              categories={categories}
              listId={list.id}
              onCategoriesChange={handleCategoriesChange}
              participants={participants}
              onParticipantsChange={handleParticipantsChange}
              isAdmin={isAdmin}
              adminUnlocked={adminUnlocked}
              hasAdminPassword={!!list.admin_password}
              onSetAdminPassword={handleSetAdminPassword}
              onUnlockAdmin={handleUnlockAdmin}
              onChangeOwnPassword={handleChangeOwnPassword}
              onChangeAdminPassword={handleChangeAdminPassword}
            />
          </Suspense>
            </ScreenPane>
          )}
        </div>
      </main>

      <BottomNav
        tab={tab}
        onNavigate={setTab}
        onMore={() => setMoreOpen(true)}
        moreOpen={moreOpen}
      />

      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        onNavigate={setTab}
        isDark={isDark}
        onToggleTheme={handleToggleTheme}
        onLeave={handleLeave}
        userName={userName}
      />
    </div>
      )}
    </>
  )
}