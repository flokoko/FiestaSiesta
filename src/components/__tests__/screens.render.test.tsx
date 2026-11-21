// P7: Render-Smoke-Tests für die 7 Haupt-Screens.
//
// Warum: `tsc` und `vite build` sehen einen Prop, der in der Destrukturierung
// der Komponente fehlt, NICHT (optional im Interface!) — erst beim Rendern knallt
// er als ReferenceError (passiert am 20.11.2026 mit onOpenKitchen in ListScreen).
// Diese Tests rendern jeden Screen in einen ToastProvider mit minimalem, aber
// vollständigem Propsatz und erwarten den Kern-Text.
//
// Der Supabase-Client ist gefälscht: from() liefert einen thenable Query-Builder
// (jede Chain-Methode gibt self zurück, await ergibt { data: [], error: null }),
// rpc() resolved sofort, Realtime-Kanäle verbinden nicht. Screens laden im
// useEffect — die Promises lösen sich leere auf, kein Hängen.
//
// Die Tests prüfen bewusst NICHT Uhrzeit/Reisedaten (heute liegt außerhalb der
// Reise) — für DayScreen deshalb ein zustandsunabhängiger Anker (der „Notfall“-
// Hub-Chip), nicht das „Programm“-Kartentitel, der am gewählten Tag hängt.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'

import { ToastProvider } from '../../context/ToastContext'
import DayScreen from '../DayScreen'
import ListScreen from '../ListScreen'
import BringScreen from '../BringScreen'
import ExpenseScreen from '../ExpenseScreen'
import TripPlanScreen from '../TripPlanScreen'
import RecipesScreen from '../RecipesScreen'
import NotesScreen from '../NotesScreen'

// Fälschung für ../../lib/supabase (gleiche Modul-Identität wie ../lib/supabase
// in den Screens — vi.mock normalisiert den Pfad). Alles hängt an zwei
// Bausteinen: ein Query-Builder, der auf AUF jede Methode mit sich selbst
// antwortet und beim await ein leeres Ergebnis liefert (screens chainen
// select/eq/order/limit/abortSignal/maybeSingle ... — ein Proxy deckt alle
// ab, inklusive Methoden, die heute noch fehlen), und ein Kanal-Objekt für
// lib/realtimeBus (on → self, subscribe → self, unsubscribe → Promise).
// removeChannel wird beim Unmount gebraucht und MUSS existieren, sonst
// sammeln sich unhandled rejections im Testlauf an.
vi.mock('../../lib/supabase', () => {
  const EMPTY_RESULT = { data: [], error: null }

  /** self-returning Proxy mit fest überschreibbaren Methoden. */
  function selfReturning(overrides: Record<PropertyKey, unknown> = {}) {
    const target: Record<PropertyKey, unknown> = { ...overrides }
    const proxy = new Proxy(target, {
      get(t, prop) {
        if (prop in t) return t[prop]
        // Erstkontakt eines Chain-Aufrufs: Methode, die self zurückgibt.
        t[prop] = () => proxy
        return t[prop]
      },
    })
    return proxy
  }

  /** Thenable Query-Builder: await ergibt { data: [], error: null }. */
  function makeBuilder() {
    return selfReturning({
      then: (
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(EMPTY_RESULT).then(onFulfilled, onRejected),
      catch: (onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(EMPTY_RESULT).catch(onRejected),
      finally: (onFinally?: () => void) =>
        Promise.resolve(EMPTY_RESULT).finally(onFinally),
    })
  }

  /** Realtime-Kanal für realtimeBus: on/subscribe chainen, ohne zu feuern. */
  function makeChannel() {
    return selfReturning({
      subscribe: () => undefined,
      unsubscribe: () => Promise.resolve(),
    })
  }

  const supabase = {
    from: () => makeBuilder(),
    rpc: () => Promise.resolve({ data: null, error: null }),
    channel: () => makeChannel(),
    removeChannel: () => Promise.resolve('ok'),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  }

  return {
    supabase,
    getJoinCode: () => 'TESTUI26',
    getSupabaseUrl: () => 'https://mock.supabase.co',
  }
})

// DayScreen startet fetchLiveWeather — ohne Stub würde der Node-fetch gegen
// open-meteo laufen (unbestimmt, ggf. Netz). Rejection ist gewollt: die Lib
// schluckt Fehler und fällt auf den Cache zurück (Offline-Pfad), der hier leer ist.
// bewusst KEIN Access auf init.signal im Stub → keine AbortSignal-Realm-Falle.
// localStorage: in dieser Node/jsdom-Konstellation nicht vorhanden — In-Memory-
// Store nachbauen (Muster readCache.test.ts), sonst knallen usePersistedState,
// readCache und die Offline-Queue beim allerersten Zugriff.
const localStorageStore = new Map<string, string>()
const localStorageMock = {
  getItem: (key: string) => localStorageStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    localStorageStore.set(key, String(value))
  },
  removeItem: (key: string) => {
    localStorageStore.delete(key)
  },
  clear: () => {
    localStorageStore.clear()
  },
  key: (index: number) => [...localStorageStore.keys()][index] ?? null,
  get length() {
    return localStorageStore.size
  },
}

// matchMedia existiert im jsdom ebenfalls nicht — glassMotion & Co. rufen es an.
const matchMediaStub = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
})

// jsdom kennt Element.scrollTo nicht — DayScreen zentriert beim Mount den
// gewählten Tag-Chip in der Tagesleiste; im Test reicht das No-Op.
Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => undefined)

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline im Test')))
  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  })
  vi.stubGlobal('matchMedia', matchMediaStub)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorageStore.clear()
})

const noop = () => undefined

describe('Screens — Render-Smoke (P7)', () => {
  it('DayScreen rendert (Tag-Hub mit „Notfall“ sichtbar)', async () => {
    render(
      <ToastProvider>
        <DayScreen
          participantCount={4}
          shoppingCount={3}
          shoppingChecked={1}
          bringCount={2}
          expenseTotal={127}
          userBalance={-42}
          proposalCount={0}
          plan={{}}
          weather={{}}
          dayIso=""
          onPickDay={noop}
          onNavigate={noop}
          onEmergency={noop}
        />
      </ToastProvider>,
    )
    await waitFor(() => {
      expect(screen.getByText('Notfall')).toBeTruthy()
    })
  })

  it('ListScreen rendert (Einkaufen-Kopf sichtbar)', async () => {
    render(
      <ToastProvider>
        <ListScreen items={[]} categories={[]} listId="smoke-list" userName="Flo" />
      </ToastProvider>,
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Einkaufen', level: 1 })).toBeTruthy()
    })
  })

  // Regression zum 20.11.2026: onOpenKitchen war aus der Destrukturierung von
  // ListScreen gerutscht — tsc und build sahen nichts (Prop ist optional im
  // Interface), der Screen knallte beim Rendern mit ReferenceError. Genau dieser
  // Fall, Prop ÜBERGEBEN und rendern: fehlt onOpenKitchen in der Destrukturierung,
  // wirft `{onOpenKitchen && ...}` im JSX sofort den ReferenceError und dieser
  // Test fällt rot.
  it('ListScreen mit onOpenKitchen übergeben — fängt fehlende Destrukturierung als ReferenceError', async () => {
    render(
      <ToastProvider>
        <ListScreen
          items={[]}
          categories={[]}
          listId="smoke-list"
          userName="Flo"
          onOpenKitchen={vi.fn()}
        />
      </ToastProvider>,
    )
    // Kopf und der Küche-Knopf (onClick={onOpenKitchen} direkt am JSX) müssen da sein.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Einkaufen', level: 1 })).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'Küche öffnen' })).toBeTruthy()
  })

  it('BringScreen rendert (Mitbringen-Kopf sichtbar)', async () => {
    render(
      <ToastProvider>
        <BringScreen items={[]} categories={[]} listId="smoke-list" userName="Flo" />
      </ToastProvider>,
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Mitbringen', level: 1 })).toBeTruthy()
    })
  })

  it('ExpenseScreen rendert (Geld-Kopf sichtbar)', async () => {
    render(
      <ToastProvider>
        <ExpenseScreen
          expenses={[]}
          expenseSplits={[]}
          expenseQuotas={[]}
          listId="smoke-list"
          userName="Flo"
          knownPersons={['Flo']}
          expenseCategories={[]}
          isLoading={false}
          isAdmin={false}
          adminUnlocked={false}
          onAddPendingExpense={noop}
          removePendingExpense={noop}
          onExpensesChange={noop}
          onCategoriesChange={noop}
          onQuotasChange={noop}
          settlements={[]}
          onSettlementsChange={noop}
        />
      </ToastProvider>,
    )
    // „Geld“ sitzt im h1 und ist als Überschrift einzigartig; „Noch keine Ausgabe“
    // steht in Kopf UND leerer Liste doppelt — dafür wäre getAllByText nötig.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Geld', level: 1 })).toBeTruthy()
    })
  })

  it('TripPlanScreen rendert (Reiseplan-Kopf sichtbar)', async () => {
    render(
      <ToastProvider>
        <TripPlanScreen
          listId="smoke-list"
          userName="Flo"
          isAdmin={false}
          onNavigate={noop}
          notesCount={0}
        />
      </ToastProvider>,
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Reiseplan', level: 1 })).toBeTruthy()
    })
  })

  it('RecipesScreen rendert (Küche-Kopf sichtbar)', async () => {
    render(
      <ToastProvider>
        <RecipesScreen listId="smoke-list" userName="Flo" onOpenShopping={noop} />
      </ToastProvider>,
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Küche', level: 1 })).toBeTruthy()
    })
  })

  it('NotesScreen rendert (Notizen-Kopf sichtbar)', async () => {
    render(
      <ToastProvider>
        <NotesScreen
          listId="smoke-list"
          userName="Flo"
          notes={[]}
          onNotesChange={noop}
          onReorderNotes={noop}
          onToggleFavorite={noop}
        />
      </ToastProvider>,
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Notizen', level: 1 })).toBeTruthy()
    })
  })
})
