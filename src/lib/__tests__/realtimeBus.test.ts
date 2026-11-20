import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mock des Supabase-Clients ────────────────────────────────────────
// Kette am Kanal: channel(topic, cfg) → on('broadcast', filter, cb) →
// subscribe(cb). Das Abmelden läuft im Bus über supabase.removeChannel
// (das kanalweise Pendant zu unsubscribe).
const sb = vi.hoisted(() => {
  type BroadcastCb = (message: unknown) => void
  type StatusCb = (status: string) => void
  interface Channel {
    topic: string
    cfg: unknown
    onCalls: Array<{ type: string; filter: unknown }>
    broadcastCbs: BroadcastCb[]
    statusCbs: StatusCb[]
    on: (type: string, filter: unknown, cb: BroadcastCb) => Channel
    subscribe: (cb: StatusCb) => Channel
  }
  const channels: Channel[] = []
  const removed: unknown[] = []
  return {
    channels,
    removed,
    supabase: {
      channel(topic: string, cfg?: unknown): Channel {
        const ch = {} as Channel
        ch.topic = topic
        ch.cfg = cfg
        ch.onCalls = []
        ch.broadcastCbs = []
        ch.statusCbs = []
        ch.on = (type, filter, cb) => {
          ch.onCalls.push({ type, filter })
          ch.broadcastCbs.push(cb)
          return ch
        }
        ch.subscribe = (cb) => {
          ch.statusCbs.push(cb)
          return ch
        }
        channels.push(ch)
        return ch
      },
      removeChannel(channel: unknown) {
        removed.push(channel)
        return Promise.resolve('ok')
      },
    },
  }
})

vi.mock('../supabase', () => ({
  supabase: sb.supabase,
  getJoinCode: () => 'TESTJOIN',
}))

import { closeAllRealtimeChannels, subscribeList, type RealtimeEvent } from '../realtimeBus'

type Ch = (typeof sb.channels)[number]

/** Das vom Bus registrierte broadcast-Callback mit einer Nachricht füttern. */
function emitBroadcast(channel: Ch, message: unknown): void {
  for (const cb of channel.broadcastCbs) cb(message)
}

describe('realtimeBus — ein Kanal pro Liste, viele Hörer', () => {
  beforeEach(() => {
    closeAllRealtimeChannels()
    sb.channels.length = 0
    sb.removed.length = 0
  })

  it('zwei Hörer bekommen dasselbe Event', () => {
    const a = vi.fn((_: RealtimeEvent) => {})
    const b = vi.fn((_: RealtimeEvent) => {})
    subscribeList('l1', a)
    subscribeList('l1', b)
    emitBroadcast(sb.channels[0], {
      payload: { table: 'items', operation: 'INSERT', record: { id: '1', name: 'Wasser' }, old_record: null },
    })
    const expected: RealtimeEvent = {
      table: 'items', eventType: 'INSERT', new: { id: '1', name: 'Wasser' }, old: null,
    }
    expect(a).toHaveBeenCalledTimes(1)
    expect(a).toHaveBeenCalledWith(expected)
    expect(b).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledWith(expected)
  })

  it('der Kanal wird pro Liste nur EINMAL abonniert (Kette channel → on → subscribe)', () => {
    subscribeList('l1', () => {})
    subscribeList('l1', () => {})
    subscribeList('l2', () => {})
    expect(sb.channels).toHaveLength(2)
    const ch = sb.channels[0]
    expect(ch.topic).toBe('list:l1:TESTJOIN')
    expect(ch.cfg).toEqual({ config: { private: true, broadcast: { self: true } } })
    expect(ch.onCalls).toEqual([{ type: 'broadcast', filter: { event: '*' } }])
    expect(ch.broadcastCbs).toHaveLength(1)
    expect(ch.statusCbs).toHaveLength(1)
  })

  it('beim Abmelden des letzten Hörers wird der Kanal abgemeldet (removeChannel)', () => {
    const un1 = subscribeList('l1', () => {})
    const un2 = subscribeList('l1', () => {})
    un1()
    expect(sb.removed).toHaveLength(0) // zweiter Hörer hängt noch am Kanal
    un2()
    expect(sb.removed).toHaveLength(1)
    expect(sb.removed[0]).toBe(sb.channels[0])
    // Danach bekommt ein neuer Hörer einen FRISCHEN Kanal, keinen halbtoten
    subscribeList('l1', () => {})
    expect(sb.channels).toHaveLength(2)
    expect(sb.channels[1].topic).toBe('list:l1:TESTJOIN')
  })

  it('ein werfender Hörer reißt die anderen nicht mit', () => {
    const boom = vi.fn((_e: RealtimeEvent) => { throw new Error('kaputt') })
    const gut = vi.fn((_e: RealtimeEvent) => {})
    subscribeList('l1', boom)
    subscribeList('l1', gut)
    emitBroadcast(sb.channels[0], {
      payload: { table: 'notes', operation: 'UPDATE', record: { id: '2' }, old_record: { id: '2' } },
    })
    expect(boom).toHaveBeenCalledTimes(1)
    expect(gut).toHaveBeenCalledTimes(1)
    expect(gut).toHaveBeenCalledWith({
      table: 'notes', eventType: 'UPDATE', new: { id: '2' }, old: { id: '2' },
    })
  })

  it('closeAllRealtimeChannels meldet alles ab', () => {
    subscribeList('l1', () => {})
    subscribeList('l2', () => {})
    expect(sb.channels).toHaveLength(2)
    closeAllRealtimeChannels()
    expect(sb.removed).toHaveLength(2)
    expect(sb.removed).toContain(sb.channels[0])
    expect(sb.removed).toContain(sb.channels[1])
    // Danach legt ein neues Abonnieren wieder einen frischen Kanal an
    subscribeList('l1', () => {})
    expect(sb.channels).toHaveLength(3)
  })
})
