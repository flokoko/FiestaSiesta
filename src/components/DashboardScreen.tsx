import { useState, useMemo, type ReactNode } from 'react'
import { ShoppingCart, Backpack, Wallet, Smartphone, StickyNote, Trash2, ExternalLink, ChevronDown, ChevronUp, GripVertical, Star } from 'lucide-react'
import type { QuickNote, TabView } from '../types'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { useOfflineQueue } from '../hooks/useOfflineQueue'
import { useDragReorder } from '../hooks/useDragReorder'
import { SkeletonCard, SkeletonNote } from './Skeleton'
import WeatherWidget from './WeatherWidget'
import BristolWidget from './BristolWidget'
import './DashboardScreen.css'

/** Detect URLs in text and render them as clickable links. */
function renderTextWithLinks(text: string): ReactNode[] {
  const urlRegex = /(https?:\/\/[^\s<>"']+)/gi
  const result: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index))
    }
    const url = match[0]
    result.push(
      <a
        key={key++}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="dash-note-link"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
        <ExternalLink size={11} strokeWidth={2} className="dash-note-link-icon" />
      </a>,
    )
    lastIndex = match.index + url.length
  }
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex))
  }
  return result
}

interface DashboardScreenProps {
  listId: string
  userName: string
  listName: string
  shoppingCount: number
  shoppingChecked: number
  bringCount: number
  expenseCount: number
  expenseTotal: number
  userBalance: number
  notes: QuickNote[]
  isLoading?: boolean
  onNavigate: (tab: TabView) => void
  onNotesChange: () => void
  onReorderNotes: (newOrder: string[]) => void
  onToggleFavorite: (noteId: string) => void
  installPrompt: BeforeInstallPromptEvent | null
  onInstall: () => void
  bristolEnabled: boolean
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function DashboardScreen({
  listId,
  userName,
  shoppingCount,
  shoppingChecked,
  bringCount,
  expenseCount,
  expenseTotal,
  userBalance,
  notes,
  isLoading,
  onNavigate,
  onNotesChange,
  onReorderNotes,
  onToggleFavorite,
  installPrompt,
  onInstall,
  bristolEnabled,
}: DashboardScreenProps) {
  const { toast, confirm } = useToast()
  const { isOnline, enqueue } = useOfflineQueue()
  const [showForm, setShowForm] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formContent, setFormContent] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  // ── Notes collapsible state from localStorage ──
  const [notesExpanded, setNotesExpanded] = useState(() => {
    return localStorage.getItem('notes_expanded') === 'true'
  })

  const toggleNotes = () => {
    navigator.vibrate?.(8)
    setNotesExpanded(prev => {
      const next = !prev
      localStorage.setItem('notes_expanded', String(next))
      return next
    })
  }

  const {
    dragState,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    registerItem,
  } = useDragReorder(notes, onReorderNotes)

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return notes
    return notes.filter((n) =>
      (n.title ?? '').toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q),
    )
  }, [notes, searchQuery])

  const handleSave = async () => {
    const content = formContent.trim()
    if (!content) return
    if (isOnline) {
      const { error } = await supabase.from('notes').insert({
        list_id: listId,
        title: formTitle.trim() || null,
        content,
        created_by: userName,
      })
      if (error) {
        toast(`Fehler beim Speichern: ${error.message}`, 'error')
        return
      }
    } else {
      enqueue({
        type: 'insert',
        table: 'notes',
        payload: {
          list_id: listId,
          title: formTitle.trim() || null,
          content,
          created_by: userName,
        },
      })
    }
    setFormTitle('')
    setFormContent('')
    setShowForm(false)
    onNotesChange()
  }

  const handleDelete = (note: QuickNote) => {
    confirm('Dieses Element wirklich löschen?', async () => {
      if (isOnline) {
        const { error } = await supabase.from('notes').delete().eq('id', note.id)
        if (error) {
          toast(`Fehler beim Löschen: ${error.message}`, 'error')
          return
        }
      } else {
        enqueue({
          type: 'delete',
          table: 'notes',
          payload: {},
          filterColumn: 'id',
          filterValue: note.id,
        })
      }
      navigator.vibrate?.(15)
      onNotesChange()
    })
  }

  const startEdit = (note: QuickNote) => {
    setEditingId(note.id)
    setEditTitle(note.title ?? '')
    setEditContent(note.content)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditTitle('')
    setEditContent('')
  }

  const handleUpdate = async (note: QuickNote) => {
    const content = editContent.trim()
    if (!content) return
    if (isOnline) {
      const { error } = await supabase
        .from('notes')
        .update({
          title: editTitle.trim() || null,
          content,
        })
        .eq('id', note.id)
      if (error) {
        toast(`Fehler beim Speichern: ${error.message}`, 'error')
        return
      }
    } else {
      enqueue({
        type: 'update',
        table: 'notes',
        payload: {
          title: editTitle.trim() || null,
          content,
        },
        filterColumn: 'id',
        filterValue: note.id,
      })
    }
    cancelEdit()
    onNotesChange()
  }

  const shoppingStatus = shoppingCount > 0 ? `${shoppingChecked}/${shoppingCount} erledigt` : '🥘 Nada auf der Liste!'
  const bringStatus = bringCount > 0 ? `${bringCount} Items` : '🍷 Nada que llevar!'
  const expenseStatus = expenseCount > 0
    ? `${expenseCount} Ausgaben — Du: ${userBalance >= 0 ? 'bekommst' : 'schuldest'} €${Math.abs(userBalance).toFixed(2)}`
    : '💶 Nada de gastos!'
  const expenseTotalFmt = expenseTotal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })

  return (
    <div className="dashboard-screen">
      <header className="note-head">
        <div className="note-head-text">
          <h1>Notizen</h1>
          <p>
            {notes.length === 0
              ? 'Noch keine Notiz'
              : `${notes.length} ${notes.length === 1 ? 'Notiz' : 'Notizen'}`}
          </p>
        </div>
      </header>

      {/* ── Weather Widget ── */}
      <WeatherWidget onNavigate={() => { navigator.vibrate?.(8); onNavigate('weather') }} />

      {/* ── Bristol Widget ── */}
      {bristolEnabled && (
        <BristolWidget
          listId={listId}
          userName={userName}
          onNavigate={() => { navigator.vibrate?.(8); onNavigate('bristol') }}
        />
      )}

      {/* ── Feature Cards ── */}
      {isLoading ? (
        <div className="dashboard-cards">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
      <div className="dashboard-cards">
        <button className="dash-card" onClick={() => { navigator.vibrate?.(8); onNavigate('list') }}>
          <div className="dash-card-icon"><ShoppingCart size={28} strokeWidth={2} /></div>
          <div className="dash-card-body">
            <div className="dash-card-title">Einkaufsliste</div>
            <div className="dash-card-sub">{shoppingStatus}</div>
          </div>
          {shoppingCount > 0 && (
            <span className="dash-card-badge">{shoppingChecked}/{shoppingCount}</span>
          )}
        </button>

        <button className="dash-card" onClick={() => { navigator.vibrate?.(8); onNavigate('bring') }}>
          <div className="dash-card-icon"><Backpack size={28} strokeWidth={2} /></div>
          <div className="dash-card-body">
            <div className="dash-card-title">Mitbringen</div>
            <div className="dash-card-sub">{bringStatus}</div>
          </div>
          {bringCount > 0 && (
            <span className="dash-card-badge">{bringCount}</span>
          )}
        </button>

        <button className="dash-card" onClick={() => { navigator.vibrate?.(8); onNavigate('expenses') }}>
          <div className="dash-card-icon"><Wallet size={28} strokeWidth={2} /></div>
          <div className="dash-card-body">
            <div className="dash-card-title">Ausgaben</div>
            <div className="dash-card-sub">{expenseStatus}</div>
          </div>
          {expenseCount > 0 && (
            <span className="dash-card-badge">{expenseTotalFmt}</span>
          )}
        </button>
      </div>
      )}

      {/* ── Install Banner ── */}
      {installPrompt && (
        <button className="dash-install-banner" onClick={onInstall}>
          <span className="dash-install-icon"><Smartphone size={22} strokeWidth={2} /></span>
          App installieren — für schnelleren Zugriff
        </button>
      )}

      {/* ── Quick Notes ── */}
      <section className="dash-notes-section">
        <h2
          className="dash-section-title dash-section-title-clickable"
          onClick={toggleNotes}
        >
          <StickyNote size={18} strokeWidth={2} />
          Kurznotizen
          {notes.length > 0 && (
            <span className="dash-notes-count">{notes.length}</span>
          )}
          <span className="dash-notes-chevron">
            {notesExpanded ? <ChevronUp size={16} strokeWidth={2} /> : <ChevronDown size={16} strokeWidth={2} />}
          </span>
        </h2>

        {notesExpanded && (
          isLoading ? (
            <div className="dash-notes-list">
              <SkeletonNote />
              <SkeletonNote />
            </div>
          ) : (
          <>
          {notes.length > 0 && (
            <input
              type="text"
              className="dash-notes-search"
              placeholder="🔍 Suchen…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          )}
          {!showForm && (
            <button className="dash-add-btn" onClick={() => setShowForm(true)}>
              + Notiz hinzufügen
            </button>
          )}

          {showForm && (
            <div className="dash-note-form">
              <input
                className="dash-note-input"
                type="text"
                placeholder="Titel (z.B. Hausadresse)"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                maxLength={200}
              />
              <textarea
                className="dash-note-textarea"
                placeholder="Notiz eingeben…"
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                maxLength={200}
                rows={3}
              />
              <div className="dash-note-form-actions">
                <button className="dash-btn-cancel" onClick={() => { setShowForm(false); setFormTitle(''); setFormContent('') }}>
                  Abbrechen
                </button>
                <button className="dash-btn-save" onClick={handleSave} disabled={!formContent.trim()}>
                  Speichern
                </button>
              </div>
            </div>
          )}

          {notes.length === 0 && !showForm && (
            <p className="dash-notes-empty">Noch keine Notizen — füge Infos wie die Hausadresse hinzu!</p>
          )}

          {notes.length > 0 && filteredNotes.length === 0 && (
            <p className="dash-notes-empty">Keine Notizen gefunden für „{searchQuery}"</p>
          )}

          <div className="dash-notes-list">
            {filteredNotes.map((note) => {
              const isEditing = editingId === note.id
              const isDragging = dragState.draggingId === note.id
              const isDragOver = dragState.dragOverId === note.id
              if (isEditing) {
                return (
                  <div key={note.id} className="dash-note-card dash-note-card-editing">
                    <input
                      className="dash-note-input"
                      type="text"
                      placeholder="Titel (optional)"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      maxLength={200}
                    />
                    <textarea
                      className="dash-note-textarea"
                      placeholder="Notiz eingeben…"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      maxLength={200}
                      rows={3}
                    />
                    <div className="dash-note-form-actions">
                      <button className="dash-btn-cancel" onClick={cancelEdit}>Abbrechen</button>
                      <button className="dash-btn-save" onClick={() => handleUpdate(note)} disabled={!editContent.trim()}>
                        Speichern
                      </button>
                    </div>
                  </div>
                )
              }
              return (
                <div
                  key={note.id}
                  ref={(el) => registerItem(note.id, el)}
                  className={`dash-note-card ${isDragging ? 'dash-note-dragging' : ''} ${isDragOver ? 'dash-note-dragover' : ''} ${note.is_favorite ? 'dash-note-favorite' : ''}`}
                >
                  <div className="dash-note-card-top">
                    <div
                      className="dash-note-drag-handle"
                      onPointerDown={(e) => { e.stopPropagation(); handlePointerDown(e, note.id) }}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      style={{ touchAction: 'none' }}
                    >
                      <GripVertical size={14} strokeWidth={2} />
                    </div>
                    <button
                      className="dash-note-star"
                      onClick={(e) => { e.stopPropagation(); onToggleFavorite(note.id) }}
                      aria-label={note.is_favorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
                    >
                      <Star size={16} strokeWidth={2} fill={note.is_favorite ? 'currentColor' : 'none'} />
                    </button>
                    <div className="dash-note-card-content" onClick={() => startEdit(note)}>
                      {note.title && <div className="dash-note-title">{note.title}</div>}
                      <div className="dash-note-text">{renderTextWithLinks(note.content)}</div>
                    </div>
                    <button
                      className="dash-note-delete"
                      onClick={(e) => { e.stopPropagation(); handleDelete(note) }}
                      aria-label="Löschen"
                    >
                      <Trash2 size={16} strokeWidth={2} />
                    </button>
                  </div>
                  {note.created_by && <div className="dash-note-by">von {note.created_by}</div>}
                </div>
              )
            })}
          </div>
          </>
          )
        )}
      </section>
    </div>
  )
}
