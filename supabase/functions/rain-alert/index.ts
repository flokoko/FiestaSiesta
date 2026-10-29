// ═══════════════════════════════════════════════════════════════════
// Supabase Edge Function: rain-alert
// Fiesta Siesta — prüft die Vorhersage für MORGEN am Unterkunftsort und
// schickt einen Web-Push, wenn es nass wird.
//
// Aufruf: pg_cron (täglich 17:00 UTC = 18:00 Europe/Madrid im Winter).
//   Authorization: Bearer <anon key>   (verify_jwt bleibt true)
//   x-join-code: SIESTA26              (Autorisierung wie bei send-push)
//
// Antwort: { rain, probability, mm, sent, skipped? }
// ═══════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

webpush.setVapidDetails(VAPID_SUBJECT, Deno.env.get('VAPID_PUBLIC_KEY') ?? '', VAPID_PRIVATE_KEY)

// Unterkunft: Casa Los Pinos, Temisas (Gemeinde Agüimes), 691 m
const TRIP_LAT = 27.90937
const TRIP_LON = -15.50733
const TRIP_START = '2026-11-29'
const TRIP_END = '2026-12-06'

/** Ab hier gilt „wird nass": 50 % Regenwahrscheinlichkeit ODER 2 mm Niederschlag. */
const PROBABILITY_THRESHOLD = 50
const MM_THRESHOLD = 2

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const ALLOWED_ORIGINS = [
  'https://flokoko.github.io',
  'http://127.0.0.1:5188',
  'http://localhost:5188',
]

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-join-code',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

/** Datum in Europe/Madrid als YYYY-MM-DD */
function madridDate(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86400000)
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsFor(req) })
  }

  try {
    // ── Autorisierung: der Join-Code muss zu einer Liste gehören ───────
    const joinCode = req.headers.get('x-join-code') ?? ''
    if (!joinCode) {
      return new Response(JSON.stringify({ error: 'x-join-code fehlt' }), {
        status: 403, headers: { ...corsFor(req), 'Content-Type': 'application/json' },
      })
    }
    const { data: list, error: listError } = await supabase
      .from('lists').select('id, join_code').eq('join_code', joinCode).maybeSingle()
    if (listError || !list) {
      return new Response(JSON.stringify({ error: 'Keine Berechtigung' }), {
        status: 403, headers: { ...corsFor(req), 'Content-Type': 'application/json' },
      })
    }

    // Diagnose: mit `x-dry-run: 1` wird nur gerechnet, nicht gesendet;
    // `x-day` prüft einen bestimmten Tag (Standard: morgen).
    const dryRun = req.headers.get('x-dry-run') === '1'
    const dayHeader = req.headers.get('x-day') ?? ''
    const tomorrow = /^\d{4}-\d{2}-\d{2}$/.test(dayHeader) ? dayHeader : madridDate(1)
    // Außerhalb des Reisefensters (mit zwei Tagen Vorlauf fürs Packen) nichts schicken.
    const windowStart = new Date(TRIP_START + 'T00:00:00Z')
    windowStart.setUTCDate(windowStart.getUTCDate() - 2)
    const inWindow = new Date(tomorrow + 'T00:00:00Z') >= windowStart
      && tomorrow <= TRIP_END

    if (!inWindow && !dryRun) {
      return new Response(JSON.stringify({ skipped: 'außerhalb des Reisefensters', tomorrow }), {
        status: 200, headers: { ...corsFor(req), 'Content-Type': 'application/json' },
      })
    }

    // ── Vorhersage für morgen ──────────────────────────────────────────
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${TRIP_LAT}&longitude=${TRIP_LON}`
      + '&daily=precipitation_probability_max,precipitation_sum,weather_code,temperature_2m_max'
      + '&timezone=Europe%2FMadrid&forecast_days=3'
    const wxRes = await fetch(url)
    if (!wxRes.ok) {
      return new Response(JSON.stringify({ error: `Open-Meteo HTTP ${wxRes.status}` }), {
        status: 502, headers: { ...corsFor(req), 'Content-Type': 'application/json' },
      })
    }
    const wx = await wxRes.json()
    const times: string[] = wx?.daily?.time ?? []
    const idx = times.indexOf(tomorrow)
    if (idx < 0) {
      return new Response(JSON.stringify({ skipped: 'Vorhersage reicht nicht bis morgen', tomorrow }), {
        status: 200, headers: { ...corsFor(req), 'Content-Type': 'application/json' },
      })
    }

    const probability = Number(wx.daily.precipitation_probability_max?.[idx] ?? 0)
    const mm = Number(wx.daily.precipitation_sum?.[idx] ?? 0)
    const tMax = Math.round(Number(wx.daily.temperature_2m_max?.[idx] ?? 0))

    const wet = probability >= PROBABILITY_THRESHOLD || mm >= MM_THRESHOLD
    if (!wet || dryRun) {
      return new Response(JSON.stringify({ rain: wet, dryRun, probability, mm, tMax, sent: 0, tomorrow }), {
        status: 200, headers: { ...corsFor(req), 'Content-Type': 'application/json' },
      })
    }

    // ── Push an alle Geräte der Liste ──────────────────────────────────
    const { data: subs, error: subsError } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('list_id', list.id)
    if (subsError) {
      return new Response(JSON.stringify({ error: subsError.message }), {
        status: 500, headers: { ...corsFor(req), 'Content-Type': 'application/json' },
      })
    }

    const body = `Morgen ${probability} % Regen${mm >= 0.5 ? ` · ${mm.toFixed(1)} mm` : ''} · bis ${tMax}°. Plane den Tag mit Dach ein oder nimm die Regenjacke.`
    const payload = JSON.stringify({
      title: 'Regen-Alarm für morgen',
      body,
      icon: '/FiestaSiesta/icon-192.png',
      tag: 'fiesta-rain',
      data: { url: '/FiestaSiesta/', kind: 'rain-alert', day: tomorrow },
    })

    let sent = 0
    let failed = 0
    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        )
        sent++
      } catch (err) {
        failed++
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        }
      }
    }

    return new Response(
      JSON.stringify({ rain: true, probability, mm, tMax, sent, failed, tomorrow }),
      { status: 200, headers: { ...corsFor(req), 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsFor(req), 'Content-Type': 'application/json' } },
    )
  }
})
