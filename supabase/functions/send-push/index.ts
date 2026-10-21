// ═══════════════════════════════════════════════════════════════════
// Supabase Edge Function: send-push
// Bella Mozzarella PWA — Web Push notification sender
// ═══════════════════════════════════════════════════════════════════
//
// MANUAL SETUP STEPS:
//
// 1. Generate VAPID keys:
//      npx web-push generate-vapid-keys
//    Save the public AND private key.
//
// 2. Set VITE_VAPID_PUBLIC_KEY (the public key) as a build-time env var
//    for the PWA (Vite .env / GitHub Actions secret).
//
// 3. Set these secrets on this Edge Function (Supabase Dashboard →
//    Edge Functions → send-push → Secrets):
//      VAPID_PUBLIC_KEY    = <public key from step 1>
//      VAPID_PRIVATE_KEY   = <private key from step 1>
//      VAPID_SUBJECT       = mailto:you@example.com
//
// 4. Deploy the Edge Function:
//      supabase functions deploy send-push --project-ref qmlovitzrupolqitwobv
//
// 5. Run the SQL migration (sql/push_subscriptions_migration.sql)
//    in the Supabase Dashboard SQL Editor.
//
// USAGE:
//   POST /functions/v1/send-push
//   Body: { "list_id": "<uuid>", "title": "...", "body": "...", "to": "optional-name" }
//   Response: { "sent": 3, "failed": 1, "results": [...] }
//
// ═══════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

// ── Env ────────────────────────────────────────────────────────────
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

if (!VAPID_PRIVATE_KEY) {
  console.error('VAPID_PRIVATE_KEY environment variable is not set.')
}

// Configure web-push with VAPID details.
// The public key must also be set as an Edge Function secret (VAPID_PUBLIC_KEY).
// It should be the SAME public key the PWA uses (VITE_VAPID_PUBLIC_KEY).
webpush.setVapidDetails(
  VAPID_SUBJECT,
  Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  VAPID_PRIVATE_KEY ?? '',
)

// ── Supabase admin client (service role, bypasses RLS) ────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// ── CORS headers ───────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── Edge Function entry point ─────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!VAPID_PRIVATE_KEY) {
    return new Response(
      JSON.stringify({ error: 'VAPID_PRIVATE_KEY not configured on the server.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // Parse request body
  let body: {
    list_id: string
    title: string
    body: string
    to?: string
    tag?: string
    data?: Record<string, unknown>
  }

  try {
    body = await req.json()
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const { list_id, title, body: messageBody, to, tag, data } = body

  if (!list_id || !title) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: list_id, title.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // Query push_subscriptions for this list (optionally filtered by participant)
  let query = supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, participant_name')
    .eq('list_id', list_id)

  if (to) {
    query = query.eq('participant_name', to)
  }

  const { data: subscriptions, error: queryError } = await query

  if (queryError) {
    return new Response(
      JSON.stringify({ error: `DB query failed: ${queryError.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  if (!subscriptions || subscriptions.length === 0) {
    return new Response(
      JSON.stringify({ sent: 0, failed: 0, results: [], message: 'No subscriptions found.' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // Send push to each subscription
  const payload = JSON.stringify({
    title,
    body: messageBody ?? '',
    icon: '/BellaMozzarella/icon-192.png',
    tag: tag ?? 'bella-mozzarella',
    data: data ?? {},
  })

  const results: Array<{ endpoint: string; success: boolean; error?: string }> = []
  let sent = 0
  let failed = 0

  for (const sub of subscriptions) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
    }

    try {
      await webpush.sendNotification(pushSubscription, payload)
      sent++
      results.push({ endpoint: sub.endpoint, success: true })
    } catch (err) {
      failed++
      const errMsg = err instanceof Error ? err.message : String(err)
      results.push({ endpoint: sub.endpoint, success: false, error: errMsg })

      // If the subscription is gone (410 Gone), clean it up
      const statusCode = (err as { statusCode?: number }).statusCode
      if (statusCode === 404 || statusCode === 410) {
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', sub.endpoint)
      }
    }
  }

  return new Response(
    JSON.stringify({ sent, failed, results }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})