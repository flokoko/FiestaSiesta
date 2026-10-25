import { useState, useEffect, useRef } from 'react'
import {
  Trash2, Palette, Sun, Moon, Pencil, Crown, Lock, KeyRound, Bell, BellOff, Loader2,
  MoreHorizontal, X, Settings2, Info, LogOut, Copy, Activity, Plus,
} from 'lucide-react'
import type { ItemCategory, ListType, Participant } from '../types'
import type { ThemeMode } from '../lib/theme'
import { getTheme, setTheme } from '../lib/theme'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/friendlyError'
import {
  isPushSupported,
  isPushConfigured,
  subscribeToPush,
  unsubscribeFromPush,
  hasActiveSubscription,
} from '../lib/push'
import { useToast } from '../context/ToastContext'
import { useCategories } from '../hooks/useCategories'
import { useDebouncedCallback } from '../hooks/useDebouncedCallback'
import { useSheetFocus } from '../hooks/useSheetFocus'
import { APP_VERSION } from '../version'
import { spanishMotto } from '../lib/espanaFlair'

import './SettingsScreen.css'

interface SettingsScreenProps {
  userName: string
  listName: string
  onLeave: () => void
  onRename: (newName: string) => Promise<string | null>
  categories: ItemCategory[]
  listId: string
  onCategoriesChange: () => void
  participants: Participant[]
  onParticipantsChange: () => void
  isAdmin: boolean
  adminUnlocked: boolean
  hasAdminPassword: boolean
  onSetAdminPassword: (password: string) => void
  onUnlockAdmin: (password: string) => Promise<boolean>
  onChangeOwnPassword: (oldPassword: string, newPassword: string) => Promise<{ success?: boolean; error?: string }>
  onChangeAdminPassword: (oldPassword: string, newPassword: string) => Promise<{ success?: boolean; error?: string }>
}

export default function SettingsScreen({
  userName,
  listName,
  onLeave,
  onRename,
  categories,
  listId,
  onCategoriesChange,
  participants,
  onParticipantsChange,
  isAdmin,
  adminUnlocked,
  hasAdminPassword,
  onSetAdminPassword,
  onUnlockAdmin,
  onChangeOwnPassword,
  onChangeAdminPassword,
}: SettingsScreenProps) {
  const { toast, confirm } = useToast()
  const [theme, setThemeState] = useState<ThemeMode>('auto')
  const [editingName, setEditingName] = useState(false)
  const [newName, setNewName] = useState(userName)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default')
  const [pushLoading, setPushLoading] = useState(false)
  const [pushSupported] = useState(() => isPushSupported())
  const [pushConfigured] = useState(() => isPushConfigured())
  const [showAddParticipant, setShowAddParticipant] = useState(false)
  const [newParticipantName, setNewParticipantName] = useState('')
  const [adminPasswordInput, setAdminPasswordInput] = useState('')
  const [showSetPassword, setShowSetPassword] = useState(false)
  const [newAdminPassword, setNewAdminPassword] = useState('')
  const [adminError, setAdminError] = useState('')
  // Account-Bereich: eigenes Passwort ändern (separate State vom Admin-Bereich)
  const [showChangeOwnPw, setShowChangeOwnPw] = useState(false)
  const [ownOldPw, setOwnOldPw] = useState('')
  const [ownNewPw, setOwnNewPw] = useState('')
  const [ownPwError, setOwnPwError] = useState('')
  // Admin-Bereich: Passwort ändern (separate State vom Account-Bereich)
  const [showChangeAdminPw, setShowChangeAdminPw] = useState(false)
  const [adminOldPw, setAdminOldPw] = useState('')
  const [adminNewPw, setAdminNewPw] = useState('')
  const [adminPwError, setAdminPwError] = useState('')
  const [localCatNames, setLocalCatNames] = useState<Record<string, string>>({})
  const [bristolEnabled, setBristolEnabled] = useState(() => localStorage.getItem('bristol_modus_enabled') === 'true')
  const [menuOpen, setMenuOpen] = useState(false)
  const [catsOpen, setCatsOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)

  const menuRef = useRef<HTMLDivElement | null>(null)
  useSheetFocus(menuRef, menuOpen, () => setMenuOpen(false))

  const { updateCategory, deleteCategory, addCategory } = useCategories(onCategoriesChange)
  const debouncedUpdateCategory = useDebouncedCallback(updateCategory, 400)

  useEffect(() => {
    setThemeState(getTheme())
    if ('Notification' in window) {
      setPushPermission(Notification.permission)
    }
    // Check if there's an active push subscription on mount
    hasActiveSubscription().then((active) => {
      setPushEnabled(active)
      // Keep localStorage flag in sync
      if (active) {
        localStorage.setItem('push_notifications_enabled', 'true')
      } else {
        localStorage.removeItem('push_notifications_enabled')
      }
    })
  }, [])

  useEffect(() => {
    localStorage.setItem('bristol_modus_enabled', bristolEnabled ? 'true' : 'false')
    window.dispatchEvent(new CustomEvent('bristol-modus-change'))
  }, [bristolEnabled])

  const handleThemeChange = (mode: ThemeMode) => {
    navigator.vibrate?.(8)
    setThemeState(mode)
    setTheme(mode)
  }

  const handleSubscribePush = async () => {
    navigator.vibrate?.(8)
    setPushLoading(true)
    const result = await subscribeToPush(listId, userName)
    setPushLoading(false)
    if (result.ok) {
      setPushEnabled(true)
      if ('Notification' in window) {
        setPushPermission(Notification.permission)
      }
      toast('Push-Benachrichtigungen aktiviert!', 'success')
    } else {
      toast(result.error || 'Aktivierung fehlgeschlagen.', 'error')
    }
  }

  const handleUnsubscribePush = async () => {
    navigator.vibrate?.(8)
    setPushLoading(true)
    await unsubscribeFromPush(listId, userName)
    setPushLoading(false)
    setPushEnabled(false)
    toast('Push-Benachrichtigungen deaktiviert.', 'success')
  }

  const handleSaveName = async () => {
    const trimmed = newName.trim()
    if (trimmed && trimmed !== userName) {
      const error = await onRename(trimmed)
      if (error) {
        toast(error, 'error')
        return
      }
    }
    setEditingName(false)
  }

  const MAX_PARTICIPANTS = 3

  const handleAddParticipant = async () => {
    const n = newParticipantName.trim()
    if (!n) return
    if (participants.length >= MAX_PARTICIPANTS) {
      toast(`Die Reise ist voll — maximal ${MAX_PARTICIPANTS} Personen.`, 'error')
      return
    }
    const exists = participants.find(p => p.name.toLowerCase() === n.toLowerCase())
    if (exists) {
      toast(`Teilnehmer „${exists.name}“ existiert bereits!`, 'error')
      return
    }
    const { error } = await supabase.from('participants').insert({ list_id: listId, name: n })
    if (error) {
      toast(friendlyError(error), 'error')
      return
    }
    navigator.vibrate?.(10)
    setNewParticipantName('')
    setShowAddParticipant(false)
    onParticipantsChange()
  }

  const handleDeleteParticipant = (p: Participant) => {
    confirm(`„${p.name}“ aus der Reise entfernen?`, async () => {
      const { data, error } = await supabase.rpc('delete_participant', {
        p_list_id: listId,
        p_name: p.name,
      })
      if (error) {
        toast(friendlyError(error), 'error')
        return
      }
      if (data?.error) {
        // Server blockiert das Löschen (offene Geldbezüge) — Text direkt zeigen
        toast(data.error, 'error')
        return
      }
      navigator.vibrate?.(10)
      onParticipantsChange()
    }, undefined, 'Entfernen')
  }

  const handleUnlock = async () => {
    setAdminError('')
    const ok = await onUnlockAdmin(adminPasswordInput)
    if (!ok) {
      setAdminError('Falsches Passwort.')
    }
    setAdminPasswordInput('')
  }

  const handleOwnPasswordChange = async () => {
    setOwnPwError('')
    const oldPw = ownOldPw.trim()
    const newPw = ownNewPw.trim()
    if (!oldPw || !newPw) {
      setOwnPwError('Bitte altes und neues Passwort eingeben.')
      return
    }
    if (newPw.length < 3) {
      setOwnPwError('Neues Passwort muss mindestens 3 Zeichen lang sein.')
      return
    }
    const result = await onChangeOwnPassword(oldPw, newPw)
    if (result.error) {
      setOwnPwError(result.error)
    } else {
      toast('Passwort geändert!', 'success')
      setOwnOldPw('')
      setOwnNewPw('')
      setShowChangeOwnPw(false)
    }
  }

  const handleAdminPasswordChange = async () => {
    setAdminPwError('')
    const oldPw = adminOldPw.trim()
    const newPw = adminNewPw.trim()
    if (!oldPw || !newPw) {
      setAdminPwError('Bitte altes und neues Passwort eingeben.')
      return
    }
    if (newPw.length < 3) {
      setAdminPwError('Neues Passwort muss mindestens 3 Zeichen lang sein.')
      return
    }
    const result = await onChangeAdminPassword(oldPw, newPw)
    if (result.error) {
      setAdminPwError(result.error)
    } else {
      toast('Admin-Passwort geändert', 'success')
      setAdminOldPw('')
      setAdminNewPw('')
      setShowChangeAdminPw(false)
    }
  }

  const handleSavePassword = () => {
    const pw = newAdminPassword.trim()
    if (pw.length < 3) {
      setAdminError('Passwort muss mindestens 3 Zeichen lang sein.')
      return
    }
    onSetAdminPassword(pw)
    setNewAdminPassword('')
    setShowSetPassword(false)
    setAdminError('')
    toast('Admin-Passwort gesetzt', 'success')
  }

  const handleAddCategory = (listType: ListType) => {
    const cats = categories.filter((c) => c.list_type === listType)
    const maxOrder = cats.reduce((max, c) => Math.max(max, c.sort_order), 0)
    addCategory(listId, listType, maxOrder + 1)
  }

  const renderCategoryEditor = (listType: ListType, title: string) => {
    const cats = categories.filter((c) => c.list_type === listType)
    return (
      <div className="settings-cat-subsection" key={listType}>
        <div className="settings-cat-subsection-header">
          <span className="settings-cat-subsection-title">{title}</span>
          <button
            className="settings-cat-add-btn"
            onClick={() => handleAddCategory(listType)}
          >
            + Kategorie
          </button>
        </div>
        {cats.length === 0 && (
          <p className="settings-cat-empty">Keine Kategorien</p>
        )}
        {cats.map((cat) => (
          <div key={cat.id} className="settings-cat-item">
            <input
              className="settings-cat-name-input"
              type="text"
              value={localCatNames[cat.id] ?? cat.name}
              aria-label={`Kategorie „${cat.name}“ umbenennen`}
              onChange={(e) => {
                setLocalCatNames(prev => ({ ...prev, [cat.id]: e.target.value }))
                debouncedUpdateCategory(cat.id, { name: e.target.value })
              }}
            />
            <button
              className="settings-cat-delete-btn"
              onClick={() => confirm(`Kategorie „${cat.name}“ wirklich löschen?`, () => deleteCategory(cat.id))}
              aria-label="Kategorie löschen"
            >
              <Trash2 size={16} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
    )
  }

  const JOIN_CODE = import.meta.env.VITE_JOIN_CODE || 'SIESTA26'

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(JOIN_CODE)
      toast('Reise-Code kopiert', 'success')
    } catch {
      toast(`Reise-Code: ${JOIN_CODE}`, 'success')
    }
  }

  return (
    <div className="settings-screen">
      <header className="list-head">
        <div className="list-head-text">
          <h1>Einstellungen</h1>
          <p>{userName} · {listName} · {participants.length} von {MAX_PARTICIPANTS}</p>
        </div>
        <button
          type="button"
          className="list-menu-btn"
          onClick={() => setMenuOpen(true)}
          aria-label="Weitere Optionen"
        >
          <MoreHorizontal size={20} strokeWidth={2.2} />
        </button>
      </header>

      {menuOpen && (
        <div className="list-menu-scrim" role="presentation" onClick={() => setMenuOpen(false)}>
          <div
            ref={menuRef}
            className="list-menu-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Weitere Optionen"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="more-grab" aria-hidden="true" />
            <button
              type="button"
              className="list-menu-item"
              onClick={() => { setCatsOpen(true); setMenuOpen(false) }}
            >
              <Settings2 size={17} strokeWidth={2} />
              <span>Kategorien verwalten</span>
            </button>
            <button
              type="button"
              className="list-menu-item"
              onClick={() => { setInfoOpen(true); setMenuOpen(false) }}
            >
              <Info size={17} strokeWidth={2} />
              <span>Über Fiesta Siesta</span>
            </button>
            <button
              type="button"
              className="list-menu-item danger"
              onClick={() => { setMenuOpen(false); onLeave() }}
            >
              <LogOut size={17} strokeWidth={2} />
              <span>Liste verlassen</span>
            </button>
          </div>
        </div>
      )}

      <section className="set-group">
        <h2 className="set-group-title">Darstellung</h2>
        <div className="set-rows">
          <div className="set-row">
            <Palette size={17} strokeWidth={2} className="set-icon" />
            <span className="set-label">Design</span>
            <div className="money-toggle set-toggle">
              <button
                type="button"
                className={`money-toggle-btn${theme === 'auto' ? ' active' : ''}`}
                onClick={() => handleThemeChange('auto')}
                aria-pressed={theme === 'auto'}
              >
                Auto
              </button>
              <button
                type="button"
                className={`money-toggle-btn${theme === 'light' ? ' active' : ''}`}
                onClick={() => handleThemeChange('light')}
                aria-pressed={theme === 'light'}
              >
                <Sun size={13} strokeWidth={2} /> Hell
              </button>
              <button
                type="button"
                className={`money-toggle-btn${theme === 'dark' ? ' active' : ''}`}
                onClick={() => handleThemeChange('dark')}
                aria-pressed={theme === 'dark'}
              >
                <Moon size={13} strokeWidth={2} /> Dunkel
              </button>
            </div>
          </div>
          <div className="set-row">
            <Activity size={17} strokeWidth={2} className="set-icon" />
            <span className="set-label">Bristol-Modus</span>
            <div className="money-toggle set-toggle">
              <button
                type="button"
                className={`money-toggle-btn${!bristolEnabled ? ' active' : ''}`}
                onClick={() => { navigator.vibrate?.(8); setBristolEnabled(false) }}
                aria-pressed={!bristolEnabled}
              >
                Aus
              </button>
              <button
                type="button"
                className={`money-toggle-btn${bristolEnabled ? ' active' : ''}`}
                onClick={() => { navigator.vibrate?.(8); setBristolEnabled(true) }}
                aria-pressed={bristolEnabled}
              >
                An
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="set-group">
        <h2 className="set-group-title">Dein Konto</h2>
        <div className="set-rows">
          <div className="set-row">
            <span className="set-label">Name</span>
            <span className="set-value">{userName}</span>
            {!editingName && (
              <button
                type="button"
                className="set-mini-btn"
                onClick={() => { setNewName(userName); setEditingName(true) }}
                aria-label="Namen ändern"
              >
                <Pencil size={15} strokeWidth={2} />
              </button>
            )}
          </div>
          {editingName && (
            <div className="set-inline">
              <input
                className="settings-inline-input"
                type="text"
                value={newName}
                aria-label="Neuer Name"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                autoFocus
              />
              <button className="set-btn set-btn-primary" onClick={handleSaveName}>Speichern</button>
              <button className="set-btn" onClick={() => setEditingName(false)}>Abbrechen</button>
            </div>
          )}

          <div className="set-row">
            <span className="set-label">Passwort</span>
            <span className="set-value">geschützt</span>
            {!showChangeOwnPw && (
              <button
                type="button"
                className="set-mini-btn"
                onClick={() => setShowChangeOwnPw(true)}
                aria-label="Passwort ändern"
              >
                <KeyRound size={15} strokeWidth={2} />
              </button>
            )}
          </div>
          {showChangeOwnPw && (
            <div className="set-inline column">
              <input
                className="settings-inline-input"
                type="password"
                placeholder="Altes Passwort"
                aria-label="Altes Passwort"
                value={ownOldPw}
                onChange={(e) => setOwnOldPw(e.target.value)}
                autoFocus
              />
              <input
                className="settings-inline-input"
                type="password"
                placeholder="Neues Passwort"
                aria-label="Neues Passwort"
                value={ownNewPw}
                onChange={(e) => setOwnNewPw(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleOwnPasswordChange()}
              />
              {ownPwError && <p className="settings-admin-error">{ownPwError}</p>}
              <div className="set-inline-actions">
                <button
                  className="set-btn"
                  onClick={() => { setShowChangeOwnPw(false); setOwnOldPw(''); setOwnNewPw(''); setOwnPwError('') }}
                >
                  Abbrechen
                </button>
                <button className="set-btn set-btn-primary" onClick={handleOwnPasswordChange}>Speichern</button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="set-group">
        <h2 className="set-group-title">
          Reise · {participants.length} von {MAX_PARTICIPANTS}
          {isAdmin && adminUnlocked && (
            <span className="settings-admin-badge"><Crown size={11} strokeWidth={2.2} /> Admin</span>
          )}
        </h2>
        <div className="set-rows">
          {participants.map((p) => (
            <div key={p.id} className="set-row">
              <span className="set-label">{p.name}</span>
              {p.is_admin && (
                <span className="set-tag"><Crown size={11} strokeWidth={2.2} /> Admin</span>
              )}
              {isAdmin && adminUnlocked && (
                <button
                  className="set-mini-btn danger"
                  onClick={() => handleDeleteParticipant(p)}
                  aria-label="Teilnehmer entfernen"
                >
                  <Trash2 size={15} strokeWidth={2} />
                </button>
              )}
            </div>
          ))}
          {participants.length === 0 && <p className="settings-cat-empty">Noch keine Teilnehmer</p>}

          <div className="set-row">
            <span className="set-label">Reise-Code</span>
            <code className="set-code">{JOIN_CODE}</code>
            <button type="button" className="set-mini-btn" onClick={handleCopyCode} aria-label="Code kopieren">
              <Copy size={15} strokeWidth={2} />
            </button>
          </div>
        </div>

        {isAdmin && adminUnlocked && (
          <div className="set-admin-block">
            {showAddParticipant ? (
              <div className="set-inline">
                <input
                  className="settings-inline-input"
                  type="text"
                  placeholder="Name"
                  aria-label="Name des neuen Teilnehmers"
                  value={newParticipantName}
                  onChange={(e) => setNewParticipantName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddParticipant()}
                  autoFocus
                />
                <button className="set-btn set-btn-primary" onClick={handleAddParticipant}>Hinzufügen</button>
                <button
                  className="set-btn"
                  onClick={() => { setShowAddParticipant(false); setNewParticipantName('') }}
                >
                  Abbrechen
                </button>
              </div>
            ) : participants.length < MAX_PARTICIPANTS ? (
              <button className="set-btn set-btn-ghost" onClick={() => setShowAddParticipant(true)}>
                <Plus size={15} strokeWidth={2.2} /> Person eintragen
              </button>
            ) : (
              <p className="set-hint">Die Reise ist voll — mehr als {MAX_PARTICIPANTS} Personen gehen nicht.</p>
            )}
          </div>
        )}

        {isAdmin && !adminUnlocked && (
          <div className="set-admin-block">
            <p className="set-hint">
              <Lock size={13} strokeWidth={2} /> Teilnehmerverwaltung ist gesperrt.
            </p>
            {hasAdminPassword ? (
              <div className="set-inline">
                <input
                  className="settings-inline-input"
                  type="password"
                  placeholder="Admin-Passwort"
                  aria-label="Admin-Passwort"
                  value={adminPasswordInput}
                  onChange={(e) => setAdminPasswordInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                />
                <button className="set-btn set-btn-primary" onClick={handleUnlock}>Entsperren</button>
              </div>
            ) : showSetPassword ? (
              <div className="set-inline">
                <input
                  className="settings-inline-input"
                  type="password"
                  placeholder="Admin-Passwort festlegen"
                  aria-label="Neues Admin-Passwort"
                  value={newAdminPassword}
                  onChange={(e) => setNewAdminPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSavePassword()}
                  autoFocus
                />
                <button className="set-btn set-btn-primary" onClick={handleSavePassword}>Speichern</button>
              </div>
            ) : (
              <button className="set-btn set-btn-ghost" onClick={() => setShowSetPassword(true)}>
                <Lock size={15} strokeWidth={2.2} /> Admin-Passwort festlegen
              </button>
            )}
            {adminError && <p className="settings-admin-error">{adminError}</p>}
          </div>
        )}

        {isAdmin && adminUnlocked && (
          <div className="set-admin-block">
            {showChangeAdminPw ? (
              <div className="set-inline column">
                <input
                  className="settings-inline-input"
                  type="password"
                  placeholder="Altes Admin-Passwort"
                  aria-label="Altes Admin-Passwort"
                  value={adminOldPw}
                  onChange={(e) => setAdminOldPw(e.target.value)}
                  autoFocus
                />
                <input
                  className="settings-inline-input"
                  type="password"
                  placeholder="Neues Admin-Passwort"
                  aria-label="Neues Admin-Passwort"
                  value={adminNewPw}
                  onChange={(e) => setAdminNewPw(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdminPasswordChange()}
                />
                {adminPwError && <p className="settings-admin-error">{adminPwError}</p>}
                <div className="set-inline-actions">
                  <button
                    className="set-btn"
                    onClick={() => { setShowChangeAdminPw(false); setAdminOldPw(''); setAdminNewPw(''); setAdminPwError('') }}
                  >
                    Abbrechen
                  </button>
                  <button className="set-btn set-btn-primary" onClick={handleAdminPasswordChange}>Speichern</button>
                </div>
              </div>
            ) : (
              <button className="set-btn set-btn-ghost" onClick={() => setShowChangeAdminPw(true)}>
                <KeyRound size={15} strokeWidth={2.2} /> Admin-Passwort ändern
              </button>
            )}
          </div>
        )}

        {!isAdmin && <p className="set-hint">Nur der Admin kann Teilnehmer verwalten.</p>}
      </section>

      <section className="set-group">
        <h2 className="set-group-title">Mitteilungen</h2>
        <div className="set-rows">
          <div className="set-row">
            <Bell size={17} strokeWidth={2} className="set-icon" />
            <span className="set-label">Push</span>
            <span className={`set-tag ${pushEnabled ? 'on' : ''}`}>
              {pushEnabled ? 'Aktiv' : 'Aus'}
            </span>
          </div>
        </div>
        <div className="set-admin-block">
          {!pushConfigured ? (
            <p className="set-hint">Push ist auf diesem Gerät nicht konfiguriert.</p>
          ) : !pushSupported ? (
            <p className="set-hint">
              Dieser Browser unterstützt kein Push
              {pushPermission === 'denied' ? ' (Benachrichtigungen blockiert).' : '.'}
            </p>
          ) : pushEnabled ? (
            <button className="set-btn set-btn-ghost set-btn-wide" onClick={handleUnsubscribePush} disabled={pushLoading}>
              {pushLoading ? <Loader2 size={15} className="spin" /> : <BellOff size={15} strokeWidth={2.2} />}
              Deaktivieren
            </button>
          ) : pushPermission === 'denied' ? (
            <p className="set-hint">Benachrichtigungen sind im Browser blockiert — dort erlauben.</p>
          ) : (
            <button className="set-btn set-btn-primary set-btn-wide" onClick={handleSubscribePush} disabled={pushLoading}>
              {pushLoading ? <Loader2 size={15} className="spin" /> : <Bell size={15} strokeWidth={2.2} />}
              Aktivieren
            </button>
          )}
        </div>
      </section>

      {catsOpen && (
        <section className="set-group">
          <h2 className="set-group-title">
            Kategorien
            <button type="button" className="set-mini-btn" onClick={() => setCatsOpen(false)} aria-label="Schließen">
              <X size={15} strokeWidth={2} />
            </button>
          </h2>
          <p className="set-hint">Getrennt für Einkaufsliste und Mitbringen.</p>
          {renderCategoryEditor('shopping', 'Einkaufsliste')}
          {renderCategoryEditor('bring', 'Mitbringen')}
        </section>
      )}

      {infoOpen && (
        <section className="set-group">
          <h2 className="set-group-title">
            Über die App
            <button type="button" className="set-mini-btn" onClick={() => setInfoOpen(false)} aria-label="Schließen">
              <X size={15} strokeWidth={2} />
            </button>
          </h2>
          <div className="set-rows">
            <div className="set-row">
              <span className="set-label">Version</span>
              <span className="set-value">{APP_VERSION}</span>
            </div>
            <div className="set-row">
              <span className="set-label">Reise</span>
              <span className="set-value">{listName}</span>
            </div>
          </div>
          <p className="set-hint">{spanishMotto()}</p>
          <a
            className="set-btn set-btn-ghost"
            href="https://github.com/flokoko/FiestaSiesta"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub-Repository →
          </a>
        </section>
      )}

      <footer className="set-footer">
        Fiesta Siesta · v{APP_VERSION}
      </footer>
    </div>
  )
}
