-- ======================================================
-- ZAEA Migration 050 — Configurações dos agentes por org
-- Armazena credenciais necessárias para funcionamento
-- dos agentes (GitHub, Groq, Telegram, etc.)
-- ======================================================

CREATE TABLE IF NOT EXISTS org_agent_config (
  id          UUID     PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID     NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,

  -- GitHub — necessário para Scanner + Surgeon + Validator
  github_token        TEXT,   -- PAT com scopes: repo, read:user
  github_repo_owner   TEXT,   -- já vem do onboarding, mas pode sobrescrever
  github_repo_name    TEXT,

  -- Groq — necessário para Scanner + Surgeon
  groq_api_key        TEXT,   -- em: console.groq.com

  -- Telegram — necessário para Sentinel (alertas)
  telegram_bot_token  TEXT,   -- de: @BotFather
  telegram_chat_id    TEXT,   -- de: @userinfobot

  -- E-mail para notificações (opcional)
  notify_email        TEXT,

  -- Controles de comportamento dos agentes
  auto_fix_enabled    BOOLEAN NOT NULL DEFAULT false,
  max_fixes_per_run   INTEGER NOT NULL DEFAULT 5,
  risk_level_allowed  TEXT    NOT NULL DEFAULT 'SAFE'
                        CHECK (risk_level_allowed IN ('SAFE','MODERATE','RISKY')),
  notify_on_fix       BOOLEAN NOT NULL DEFAULT true,
  notify_on_error     BOOLEAN NOT NULL DEFAULT true,

  -- Setup concluído
  setup_completed     BOOLEAN NOT NULL DEFAULT false,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_org_agent_config_updated_at ON org_agent_config;
CREATE TRIGGER trg_org_agent_config_updated_at
  BEFORE UPDATE ON org_agent_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE org_agent_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_agent_config" ON org_agent_config;
DROP POLICY IF EXISTS "org_admin_manage_config"        ON org_agent_config;

CREATE POLICY "service_role_all_agent_config"
  ON org_agent_config FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Owners e admins veem e editam a config da própria org
CREATE POLICY "org_admin_manage_config"
  ON org_agent_config FOR ALL TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM org_members
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );
