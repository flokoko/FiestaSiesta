import { useState, useEffect, useRef, useMemo, useCallback, Suspense, lazy } from 'react'
import { ArrowLeft, WifiOff } from 'lucide-react'
import type { TabView } from './types'
import { getResolvedTheme, toggleTheme, applyTheme, initThemeListener } from './lib/theme'
import { supabase, changeParticipantPassword } from './lib/supabase'
import { useToast } from './context/ToastContext'
import JoinScreen from './components/JoinScreen'
import DashboardScreen from './components/DashboardScreen'
import { spanishSuccess } from './lib/espanaFlair'
const SiestaScene = lazy(() => import('./components/SiestaScene'))
import { useListData } from './hooks/useListData'

// Code splitting: lazy-load screens that aren't needed on first paint
const ListScreen = lazy(() => import('./components/ListScreen'))
const BringScreen = lazy(() => import('./components/BringScreen'))
const ExpenseScreen = lazy(() => import('./components/ExpenseScreen'))
const SettingsScreen = lazy(() => import('./components/SettingsScreen'))
const BristolScreen = lazy(() => import('./components/BristolScreen'))
const WeatherScreen = lazy(() => import('./components/WeatherScreen'))
const TripPlanScreen = lazy(() => import('./components/TripPlanScreen'))
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

import './App.css'
import './nav.css'
import './design.css'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

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

export default function App() {
  const { toast } = useToast()

  const {
    userName, list, participantId, shoppingItems, bringItems, categories,
    notes, expenses, expenseSplits, expenseQuotas, participants, adminUnlocked,
    isAdmin, shoppingCategories, bringCategories, knownPersons, userBalance,
    expenseTotal, checkedCount, isLoading, isOnline, queueLength, flushQueue,
    setList, setAdminUnlocked,
    fetchAll,
    fetchItems, fetchCategories, fetchNotes, fetchExpenses, fetchParticipants, fetchExpenseQuotas, fetchSettlements,
    toggleShoppingItem, deleteShoppingItem, undoDelete, batchToggleShoppingItems, toggleBringItem, deleteBringItem, reorderItems, reorderNotes, toggleNoteFavorite,
    handleJoin, handleLeave, handleRename,
    undoState,
    settlements,
  } = useListData()

  // ── Tab state ──────────────────────────────────────────────────────
  const [tab, setTab] = useState<TabView>('home')
  const [moreOpen, setMoreOpen] = useState(false)

  // ── PWA update available banner ─────────────────────────────────────
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        setUpdateAvailable(true)
      })
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

  // ── beforeinstallprompt: capture for custom install UI ─────────────
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    if (isStandalone) return
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

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

  const handleInstall = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
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

  return (
    <>
      {!userName || !list ? (
        <>
          <div className="siesta-bg">
            <Suspense fallback={null}>
              <SiestaScene fullscreen />
            </Suspense>
          </div>
          <JoinScreen onJoin={handleJoin} />
        </>
      ) : (
    <div className="app">
      <header className="app-header">
        <div className="header-top">
          {backTarget ? (
            <button className="header-back" onClick={() => setTab(backTarget)}>
              <ArrowLeft size={18} strokeWidth={2} /> Zurück
            </button>
          ) : (
            <div className="header-info">
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
          )}
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
        {tab === 'home' && (
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
        )}
        {tab === 'trip' && (
          <TripScreen onNavigate={setTab} notesCount={notes.length} listId={list.id} />
        )}
        {tab === 'plan' && (
          <Suspense fallback={<TabLoader />}>
            <TripPlanScreen
              listId={list.id}
              userName={userName}
              isAdmin={isAdmin}
              onBack={() => setTab('trip')}
            />
          </Suspense>
        )}
        {tab === 'lists' && (
          <ListsScreen
            shoppingCount={shoppingItems.length}
            shoppingChecked={checkedCount}
            bringCount={bringItems.length}
            bringBrought={bringBrought}
            onNavigate={setTab}
          />
        )}
        {tab === 'notes' && (
          <DashboardScreen
            listId={list.id}
            userName={userName}
            listName={list.name}
            shoppingCount={shoppingItems.length}
            shoppingChecked={checkedCount}
            bringCount={bringItems.length}
            expenseCount={expenses.length}
            expenseTotal={expenseTotal}
            userBalance={userBalance}
            notes={notes}
            isLoading={isLoading}
            onNavigate={setTab}
            onNotesChange={handleNotesChange}
            onReorderNotes={reorderNotes}
            onToggleFavorite={toggleNoteFavorite}
            installPrompt={installPrompt}
            onInstall={handleInstall}
            bristolEnabled={bristolEnabled}
          />
        )}
        {tab === 'list' && (
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
        )}
        {tab === 'bring' && (
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
        )}
        {tab === 'expenses' && (
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
        )}
        {tab === 'bristol' && !bristolEnabled && (
          <BristolGate
            onEnable={() => {
              localStorage.setItem('bristol_modus_enabled', 'true')
              window.dispatchEvent(new CustomEvent('bristol-modus-change'))
              setBristolEnabled(true)
            }}
          />
        )}
        {tab === 'bristol' && bristolEnabled && (
          <Suspense fallback={<TabLoader />}>
            <BristolScreen
              listId={list.id}
              userName={userName}
              isAdmin={isAdmin}
            />
          </Suspense>
        )}
        {tab === 'weather' && (
          <Suspense fallback={<TabLoader />}>
            <WeatherScreen />
          </Suspense>
        )}
        {tab === 'settings' && (
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
            />
          </Suspense>
        )}
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