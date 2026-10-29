-- ═══════════════════════════════════════════════════════════════════
-- Push Subscriptions Migration — Bella Mozzarella PWA
-- ═══════════════════════════════════════════════════════════════════
--
-- MANUAL SETUP STEPS (do these before the migration takes effect):
--
-- 1. Generate VAPID keys:
--      npx web-push generate-vapid-keys
--    This prints a public and a private key. Save both.
--
-- 2. Set VITE_VAPID_PUBLIC_KEY (the public key) as a build-time env var
--    in your Vite .env file and/or GitHub Actions secret so the PWA
--    can subscribe users.
--
-- 3. Set these secrets on the Edge Function (Supabase Dashboard →
--    Edge Functions → send-push → Secrets):
--      VAPID_PUBLIC_KEY    = <public key from step 1>
--      VAPID_PRIVATE_KEY   = <private key from step 1>
--      VAPID_SUBJECT       = mailto:you@example.com
--
-- 4. Deploy the Edge Function:
--      supabase functions deploy send-push --project-ref qmlovitzrupolqitwobv
--    (or via Supabase Dashboard → Edge Functions → Deploy)
--
-- 5. Run this SQL migration in the Supabase Dashboard (SQL Editor).
--    Each block below is individually executable and ends with
--    NOTIFY pgrst, 'reload schema' so PostgREST picks up the changes.
--
-- ═══════════════════════════════════════════════════════════════════

-- ── Block 1: Create table ──────────────────────────────────────────
BEGIN;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id         UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  participant_name TEXT NOT NULL,
  endpoint        TEXT NOT NULL,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent duplicate subscriptions for the same user + endpoint
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_list_participant_endpoint
  ON push_subscriptions (list_id, participant_name, endpoint);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Block 2: Enable RLS + policies (x-join-code pattern) ────────────
-- Same RLS approach used across the app: compare lists.join_code to the
-- x-join-code request header, just like the other tables.

BEGIN;

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Allow reading subscriptions when the join code matches the list's join_code
DROP POLICY IF EXISTS push_subscriptions_select ON push_subscriptions;
CREATE POLICY push_subscriptions_select ON push_subscriptions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM lists l
      WHERE l.id = push_subscriptions.list_id
        AND l.join_code = current_setting('request.headers', true)::json ->> 'x-join-code'
    )
  );

-- Allow inserting new subscriptions when the join code matches
DROP POLICY IF EXISTS push_subscriptions_insert ON push_subscriptions;
CREATE POLICY push_subscriptions_insert ON push_subscriptions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM lists l
      WHERE l.id = push_subscriptions.list_id
        AND l.join_code = current_setting('request.headers', true)::json ->> 'x-join-code'
    )
  );

-- Allow deleting subscriptions when the join code matches
DROP POLICY IF EXISTS push_subscriptions_delete ON push_subscriptions;
CREATE POLICY push_subscriptions_delete ON push_subscriptions
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM lists l
      WHERE l.id = push_subscriptions.list_id
        AND l.join_code = current_setting('request.headers', true)::json ->> 'x-join-code'
    )
  );

-- Allow updating (for upsert / replacing stale subscriptions) when the join code matches
DROP POLICY IF EXISTS push_subscriptions_update ON push_subscriptions;
CREATE POLICY push_subscriptions_update ON push_subscriptions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM lists l
      WHERE l.id = push_subscriptions.list_id
        AND l.join_code = current_setting('request.headers', true)::json ->> 'x-join-code'
    )
  );

COMMIT;

NOTIFY pgrst, 'reload schema';