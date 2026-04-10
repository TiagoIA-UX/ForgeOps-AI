-- ======================================================
-- ZAEA Migration 049 — Campos Mercado Pago nas orgs
-- (campos mp_payer_email e mp_subscription_id já criados
--  na 048; aqui apenas adicionamos os campos extras)
-- ======================================================

-- Garante que os campos base existem (idempotente)
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS mp_payer_email     TEXT,
  ADD COLUMN IF NOT EXISTS mp_subscription_id TEXT;

-- Adiciona campo de plano MP e status da assinatura
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS mp_subscription_status TEXT
    CHECK (mp_subscription_status IN (
      'authorized','paused','cancelled','pending','authorized'
    )),
  ADD COLUMN IF NOT EXISTS mp_plan            TEXT,
  ADD COLUMN IF NOT EXISTS mp_next_payment_at TIMESTAMPTZ;

-- Índice para lookup por subscription_id (webhooks)
CREATE INDEX IF NOT EXISTS idx_organizations_mp_subscription
  ON organizations (mp_subscription_id)
  WHERE mp_subscription_id IS NOT NULL;

-- ======================================================
-- Tabela de eventos de pagamento (auditoria)
-- ======================================================
CREATE TABLE IF NOT EXISTS billing_events (
  id             UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id         UUID      REFERENCES organizations(id) ON DELETE CASCADE,
  event_type     TEXT      NOT NULL,   -- payment.created, subscription.authorized, etc.
  mp_event_id    TEXT      NOT NULL,   -- data.id do payload MP
  mp_resource    TEXT,                 -- payment | preapproval | etc.
  amount         NUMERIC(10,2),
  currency       TEXT      DEFAULT 'BRL',
  status         TEXT,
  raw_payload    JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_org
  ON billing_events (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_events_mp_id
  ON billing_events (mp_event_id);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;

-- Service role vê tudo
DROP POLICY IF EXISTS "service_role_all_billing" ON billing_events;
DROP POLICY IF EXISTS "org_members_see_billing"  ON billing_events;

CREATE POLICY "service_role_all_billing"
  ON billing_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Owners/admins da org veem os eventos dela
CREATE POLICY "org_members_see_billing"
  ON billing_events FOR SELECT TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );
