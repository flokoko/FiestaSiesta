import { useState, useMemo, useRef, useLayoutEffect, useEffect, useCallback, type ReactNode } from 'react'
import { Trash2, ExternalLink, GripVertical, Star, Plus, X, Search, StickyNote, ChevronDown, ChevronUp } from 'lucide-react'
import type { QuickNote } from '../types'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/friendlyError'
import { useToast } from '../context/ToastContext'
import { useOfflineQueue } from '../hooks/useOfflineQueue'
import { useDragReorder } from '../hooks/useDragReorder'
import { SkeletonNote } from './Skeleton'
import './NotesScreen.css'

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

interface NotesScreenProps {
  listId: string
  userName: string
  notes: QuickNote[]
  isLoading?: boolean
  onNotesChange: () => void
  onReorderNotes: (newOrder: string[]) => void
  onToggleFavorite: (noteId: string) => void
}

export default function NotesScreen({
  listId,
  userName,
  notes,
  isLoading,
  onNotesChange,
  onReorderNotes,
  onToggleFavorite,
}: NotesScreenProps) {
  const { toast, confirm } = useToast()
  const { isOnline, enqueue } = useOfflineQueue()
  const [formTitle, setFormTitle] = useState('')
  const [formContent, setFormContent] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  // Composer ist zugeklappt, sobald es Notizen gibt: die Seite startet ruhig.
  const [composerOpen, setComposerOpen] = useState(notes.length === 0)
  const [searchOpen, setSearchOpen] = useState(false)
  // Lange Notizen werden auf drei Zeilen gekürzt; welche ausgeklappt sind,
  // merkt sich der Screen (nicht persistiert — nach Reload ist alles zu).
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [longIds, setLongIds] = useState<Set<string>>(new Set())
  const textRefs = useRef(new Map<string, HTMLElement>())

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

  // ── FLIP-Animation: Karten gleiten an ihre neue Position ──────────────
  // Ohne das springt die Reihenfolge beim Loslassen hart um. Gemessen wird
  // vor dem Commit (prevRects), animiert nach dem Commit (useLayoutEffect),
  // damit nichts zwischen zwei Frames flackert.
  const rowRefs = useRef(new Map<string, HTMLElement>())
  const prevRects = useRef(new Map<string, number>())

  const trackRow = useCallback((id: string, el: HTMLElement | null) => {
    registerItem(id, el)
    if (el) rowRefs.current.set(id, el)
    else rowRefs.current.delete(id)
  }, [registerItem])

  useLayoutEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const next = new Map<string, number>()
    for (const [id, el] of rowRefs.current) {
      next.set(id, el.getBoundingClientRect().top)
    }
    if (!reduce) {
      for (const [id, top] of next) {
        const prevTop = prevRects.current.get(id)
        if (prevTop === undefined) continue
        const dy = prevTop - top
        if (Math.abs(dy) < 2) continue
        const el = rowRefs.current.get(id)
        if (!el) continue
        el.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
          { duration: 280, easing: 'cubic-bezier(.22,.9,.28,1)' },
        )
      }
    }
    prevRects.current = next
  }, [filteredNotes])

  // ── Welche Notizen sind länger als drei Zeilen? ──────────────────────
  // Gemessen wird `scrollHeight` (Inhalt) gegen 3 × Zeilenhöhe — unabhängig
  // davon, ob die Notiz gerade offen ist oder ihre Höhe animiert. Ein
  // clientHeight-Vergleich würde während der Klapp-Animation fälschlich
  // „passt schon" melden und den Umschalter mitten im Zuklappen entfernen.
  useEffect(() => {
    const measure = () => {
      setLongIds(prev => {
        const next = new Set<string>()
        for (const [id, el] of textRefs.current) {
          const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 19.5
          if (el.scrollHeight > lineHeight * 3 + 2) next.add(id)
        }
        const same = next.size === prev.size && [...next].every(id => prev.has(id))
        return same ? prev : next
      })
    }
    measure()
    // Nach dem Laden der Webfont sind die Zeilen anders hoch — einmal neu messen.
    document.fonts?.ready.then(measure).catch(() => {})
  }, [filteredNotes])

  const prevHeights = useRef(new Map<string, number>())

  const toggleNote = useCallback((id: string) => {
    // Höhe VOR dem Zustandswechsel merken — daraus wird die Animation gebaut.
    const el = textRefs.current.get(id)
    if (el) prevHeights.current.set(id, el.getBoundingClientRect().height)
    setOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Höhe animieren statt max-height: bei 4.5em → 60em springt der sichtbare
  // Bereich fast das ganze Fenster der Transition unverändert und klappt erst
  // am Ende zu. Mit gemessenen Pixeln wachsen und schrumpfen die Zeilen wirklich.
  useLayoutEffect(() => {
    if (prevHeights.current.size === 0) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    for (const [id, h0] of prevHeights.current) {
      const el = textRefs.current.get(id)
      if (!el) continue
      const h1 = el.getBoundingClientRect().height
      if (reduce || Math.abs(h1 - h0) < 2) continue
      el.style.maxHeight = 'none'
      const anim = el.animate(
        [{ height: `${h0}px` }, { height: `${h1}px` }],
        { duration: 240, easing: 'cubic-bezier(.22,.9,.28,1)' },
      )
      anim.onfinish = () => { el.style.maxHeight = ''; el.style.height = '' }
    }
    prevHeights.current.clear()
  }, [openIds])

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
        toast(friendlyError(error), 'error')
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
    setComposerOpen(false)
    onNotesChange()
  }

  const handleDelete = (note: QuickNote) => {
    // Kurzer Auszug für den Bestätigungs-Toast: eine Zeile, max. ~40 Zeichen
    const kurz = note.content.replace(/\s+/g, ' ').trim().slice(0, 40)
    confirm(`Notiz „${kurz}“ wirklich löschen?`, async () => {
      if (isOnline) {
        const { error } = await supabase.from('notes').delete().eq('id', note.id)
        if (error) {
          toast(friendlyError(error), 'error')
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
    }, undefined, 'Löschen')
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
        toast(friendlyError(error), 'error')
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

  const countLabel = notes.length === 0
    ? 'Noch keine Notiz'
    : `${notes.length} ${notes.length === 1 ? 'Notiz' : 'Notizen'}`

  return (
    <div className="notes-screen">
      <header className="note-head">
        <div className="note-head-text">
          <h1>Notizen</h1>
          <p>{countLabel}</p>
        </div>
        <div className="notes-head-actions">
          {notes.length >= 4 && (
            <button
              type="button"
              className={`notes-icon-btn ${searchOpen ? 'is-on' : ''}`}
              onClick={() => { setSearchOpen(v => !v); if (searchOpen) setSearchQuery('') }}
              aria-label={searchOpen ? 'Suche schließen' : 'Notizen durchsuchen'}
              aria-pressed={searchOpen}
            >
              {searchOpen ? <X size={17} strokeWidth={2.2} /> : <Search size={17} strokeWidth={2.2} />}
            </button>
          )}
          <button
            type="button"
            className={`notes-icon-btn is-accent ${composerOpen ? 'is-on' : ''}`}
            onClick={() => {
              if (composerOpen) { setComposerOpen(false); setFormTitle(''); setFormContent('') }
              else setComposerOpen(true)
            }}
            aria-label={composerOpen ? 'Neue Notiz schließen' : 'Neue Notiz'}
            aria-expanded={composerOpen}
          >
            {composerOpen ? <X size={17} strokeWidth={2.2} /> : <Plus size={18} strokeWidth={2.4} />}
          </button>
        </div>
      </header>

      {searchOpen && (
        <div className="notes-search">
          <Search size={15} strokeWidth={2.2} className="notes-search-icon" />
          <input
            type="text"
            aria-label="Notizen durchsuchen"
            className="notes-search-input"
            placeholder="Notizen durchsuchen…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>
      )}

      {/* ── Neue Notiz: Glas-Karte, nur auf Wunsch ── */}
      {composerOpen && (
        <div className="dash-note-form notes-composer">
          <span className="notes-composer-kicker">Neue Notiz</span>
          <input
            className="dash-note-input"
            type="text"
            placeholder="Titel (optional)"
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
            maxLength={200}
            aria-label="Titel der Notiz"
          />
          <textarea
            className="dash-note-textarea"
            placeholder="Was willst du festhalten?"
            value={formContent}
            onChange={(e) => setFormContent(e.target.value)}
            maxLength={200}
            rows={3}
            aria-label="Notiztext"
          />
          <div className="dash-note-form-actions">
            <span className="notes-counter" aria-hidden="true">{formContent.length}/200</span>
            <button className="dash-btn-save" onClick={handleSave} disabled={!formContent.trim()}>
              Speichern
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="notes-card">
          <SkeletonNote />
          <SkeletonNote />
        </div>
      ) : notes.length === 0 ? (
        // Bei offenem Composer wäre der Leerzustand eine zweite Botschaft
        // über dieselbe Sache — dann bleibt nur das Formular stehen.
        composerOpen ? null : (
        <div className="notes-empty">
          <span className="notes-empty-icon"><StickyNote size={22} strokeWidth={1.8} /></span>
          <p className="notes-empty-title">Noch keine Notizen</p>
          <p className="notes-empty-text">Hausadresse, WLAN-Passwort, Abflugzeit — alles, was später keiner suchen will.</p>
          <button type="button" className="notes-empty-btn" onClick={() => setComposerOpen(true)}>
            Erste Notiz anlegen
          </button>
        </div>
        )
      ) : filteredNotes.length === 0 ? (
        <p className="dash-notes-empty">Keine Treffer für „{searchQuery}“</p>
      ) : (
        <div className="notes-card">
          {filteredNotes.map((note) => {
            const isEditing = editingId === note.id
            const isDragging = dragState.draggingId === note.id
            const isTarget = dragState.dragOverId === note.id

            if (isEditing) {
              return (
                <div key={note.id} className="notes-row is-editing" ref={(el) => trackRow(note.id, el)}>
                  <input
                    className="dash-note-input"
                    type="text"
                    placeholder="Titel (optional)"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    maxLength={200}
                    aria-label="Titel der Notiz"
                  />
                  <textarea
                    className="dash-note-textarea"
                    placeholder="Notiz eingeben…"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    maxLength={200}
                    rows={3}
                    aria-label="Notiztext"
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
                ref={(el) => trackRow(note.id, el)}
                className={[
                  'notes-row',
                  isDragging ? 'is-dragging' : '',
                  isTarget ? 'is-target' : '',
                  note.is_favorite ? 'is-favorite' : '',
                ].filter(Boolean).join(' ')}
                style={isDragging ? { transform: `translateY(${dragState.offsetY}px) scale(1.015)` } : undefined}
              >
                <div
                  className="notes-grip"
                  onPointerDown={(e) => { e.stopPropagation(); handlePointerDown(e, note.id) }}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  style={{ touchAction: 'none' }}
                  role="button"
                  tabIndex={-1}
                  aria-label="Notiz verschieben"
                >
                  <GripVertical size={16} strokeWidth={2} />
                </div>

                <div className="notes-body" onClick={() => startEdit(note)}>
                  {note.title && (
                    <div className="dash-note-title">
                      {note.is_favorite && <span className="notes-fav-dot" aria-hidden="true" />}
                      {note.title}
                    </div>
                  )}
                  {(() => {
                    const isLong = longIds.has(note.id)
                    const isOpen = openIds.has(note.id)
                    return (
                      <>
                        <div
                          ref={(el) => {
                            if (el) textRefs.current.set(note.id, el)
                            else textRefs.current.delete(note.id)
                          }}
                          className={[
                            'dash-note-text',
                            'notes-text',
                            isLong ? 'is-long' : '',
                            isLong && !isOpen ? 'is-clamped' : '',
                            isOpen ? 'is-open' : '',
                          ].filter(Boolean).join(' ')}
                        >
                          {renderTextWithLinks(note.content)}
                        </div>
                        {isLong && (
                          <button
                            type="button"
                            className="notes-toggle"
                            aria-expanded={isOpen}
                            onClick={(e) => { e.stopPropagation(); toggleNote(note.id) }}
                          >
                            {isOpen ? 'Weniger anzeigen' : 'Mehr anzeigen'}
                            {isOpen ? <ChevronUp size={13} strokeWidth={2.4} /> : <ChevronDown size={13} strokeWidth={2.4} />}
                          </button>
                        )}
                      </>
                    )
                  })()}
                  {note.created_by && (
                    <div className="notes-meta">
                      {note.is_favorite && !note.title && <span className="notes-fav-dot" aria-hidden="true" />}
                      <span>von {note.created_by}</span>
                    </div>
                  )}
                </div>

                <div className="notes-actions">
                  <button
                    type="button"
                    className={`dash-note-star ${note.is_favorite ? 'is-on' : ''}`}
                    onClick={(e) => { e.stopPropagation(); onToggleFavorite(note.id) }}
                    aria-label={note.is_favorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
                    aria-pressed={note.is_favorite}
                  >
                    <Star size={16} strokeWidth={2} fill={note.is_favorite ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    type="button"
                    className="dash-note-delete"
                    onClick={(e) => { e.stopPropagation(); handleDelete(note) }}
                    aria-label="Löschen"
                  >
                    <Trash2 size={16} strokeWidth={2} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
