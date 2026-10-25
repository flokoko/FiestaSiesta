// ── Ein Realtime-Kanal pro Liste, viele Zuhörer ───────────────────────
// Broadcast ist themenbasiert: Nachrichten gehen an EXAKT eine Topic
// (`list:<id>:<join_code>`). Zwei Kanäle mit Suffixen (der alte
// channelSuffix-Ansatz) bekommen deshalb nie dieselben Nachrichten — und zwei
// getrennte Kanäle auf dieselbe Topic würden sich beim zweiten
// `postgres_changes`-Callback ohnehin ins Gehege kommen.
//
// Der Bus hält pro Liste genau einen privaten Broadcast-Kanal und verteilt
// jede Änderung an alle angemeldeten Hörer. Jeder Hörer filtert selbst nach
// Tabelle. Erst wenn der letzte Hörer abspringt, wird der Kanal abgeräumt.

import { supabase, getJoinCode } from './supabase'

export interface RealtimeEvent {
  /** Tabelle, die sich geändert hat (z. B. 'items') */
  table: string
  /** INSERT | UPDATE | DELETE */
  eventType: string
  /** neue Zeile (bei DELETE null) */
  new: Record<string, unknown> | null
  /** alte Zeile (bei INSERT null) */
  old: Record<string, unknown> | null
}

type Listener = (event: RealtimeEvent) => void

interface Entry {
  channel: ReturnType<typeof supabase.channel>
  listeners: Set<Listener>
}

const channels = new Map<string, Entry>()

function openChannel(listId: string): Entry {
  const topic = `list:${listId}:${getJoinCode()}`
  const channel = supabase.channel(topic, {
    // privat = die Policy auf realtime.messages prüft die Topic gegen
    // public.lists (Join-Code). Ohne diese Prüfung käme jeder mit dem
    // öffentlichen anon-Key an die Änderungen.
    config: { private: true, broadcast: { self: true } },
  })
  const entry: Entry = { channel, listeners: new Set() }

  channel.on('broadcast', { event: '*' }, (message: any) => {
    const payload = message?.payload
    const table = payload?.table as string | undefined
    if (!table) return
    const event: RealtimeEvent = {
      table,
      eventType: payload.operation ?? message?.event ?? '',
      new: payload.record ?? null,
      old: payload.old_record ?? null,
    }
    for (const listener of entry.listeners) {
      try {
        listener(event)
      } catch {
        // ein fehlerhafter Hörer darf die anderen nicht mitreißen
      }
    }
  })

  channel.subscribe((status: string) => {
    if (status !== 'SUBSCRIBED') {
      // Kein Nutzer-Fehlerbild: alle Screens laden beim Betreten, bei
      // Sichtbarkeit und im 90-Sekunden-Takt nach (useListData).
      console.warn('[realtime] Kanal nicht abonniert:', status)
    }
  })

  return entry
}

/** Änderungen dieser Liste abonnieren. Gibt die Abmelde-Funktion zurück. */
export function subscribeList(listId: string, listener: Listener): () => void {
  let entry = channels.get(listId)
  if (!entry) {
    entry = openChannel(listId)
    channels.set(listId, entry)
  }
  entry.listeners.add(listener)

  return () => {
    const current = channels.get(listId)
    if (!current) return
    current.listeners.delete(listener)
    if (current.listeners.size === 0) {
      void supabase.removeChannel(current.channel)
      channels.delete(listId)
    }
  }
}

/** Beim Abmelden alles schließen (sonst hört die Sitzung weiter mit). */
export function closeAllRealtimeChannels() {
  for (const [listId, entry] of channels) {
    void supabase.removeChannel(entry.channel)
    channels.delete(listId)
  }
}
