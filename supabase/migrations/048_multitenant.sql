-- ======================================================
-- ZAEA Migration 048 — Multi-tenant SaaS Schema
-- organizations → memberships → connected_repos → agent_tasks (por org)
-- ======================================================

-- ======================================================
-- organizations — cada cliente é uma org
-- ======================================================
CREATE TABLE IF NOT EXISTS organizations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug         TEXT NOT NULL UNIQUE,            -- URL-friendly: 'zairyx'
  name         TEXT NOT NULL,
  plan         TEXT NOT NULL DEFAULT 'free'
                 CHECK (plan IN ('free','starter','pro','enterprise')),
  -- Limites por plano
  max_repos    INTEGER NOT NULL DEFAULT 1,
  max_members  INTEGER NOT NULL DEFAULT 3,
  -- Contadores desnormalizados para performance
  repos_count  INTEGER NOT NULL DEFAULT 0,
  -- Billing
  mp_payer_email         TEXT,
  mp_subscription_id     TEXT,
  trial_ends_at          TIMESTAMPTZ,
  -- Metadados
  avatar_url   TEXT,
  website      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations (slug);

-- ======================================================
-- org_members — quem pertence a qual org e com qual papel
-- ======================================================
CREATE TABLE IF NOT EXISTS org_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner','admin','member','viewer')),
  invited_by  UUID REFERENCES auth.users (id),
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON org_members (user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org_id  ON org_members (org_id);

-- ======================================================
-- connected_repos — repositórios GitHub conectados por org
-- ======================================================
CREATE TABLE IF NOT EXISTS connected_repos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- GitHub
  github_repo_id  BIGINT NOT NULL,
  github_owner    TEXT NOT NULL,
  github_repo     TEXT NOT NULL,
  github_branch   TEXT NOT NULL DEFAULT 'main',
  -- Instalação do GitHub App
  installation_id BIGINT,
  -- Configuração do agente
  scan_interval   INTEGER NOT NULL DEFAULT 10,   -- minutos
  auto_fix        BOOLEAN NOT NULL DEFAULT true,
  notify_telegram BOOLEAN NOT NULL DEFAULT true,
  telegram_chat_id TEXT,
  -- Status
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_scan_at    TIMESTAMPTZ,
  last_error      TEXT,
  -- Metadados
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, github_repo_id)
);

CREATE INDEX IF NOT EXISTS idx_connected_repos_org_id    ON connected_repos (org_id);
CREATE INDEX IF NOT EXISTS idx_connected_repos_is_active ON connected_repos (is_active);

-- ======================================================
-- Adiciona org_id e repo_id nas agent_tasks existentes
-- (nullable para compatibilidade com modo interno)
-- ======================================================
ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS org_id  UUID REFERENCES organizations (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS repo_id UUID REFERENCES connected_repos (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_tasks_org_id  ON agent_tasks (org_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_repo_id ON agent_tasks (repo_id);

-- ======================================================
-- Trigger updated_at para novas tabelas
-- ======================================================
DROP TRIGGER IF EXISTS trg_organizations_updated_at ON organizations;
CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_connected_repos_updated_at ON connected_repos;
CREATE TRIGGER trg_connected_repos_updated_at
  BEFORE UPDATE ON connected_repos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ======================================================
-- Row Level Security
-- ======================================================
ALTER TABLE organizations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_repos ENABLE ROW LEVEL SECURITY;

-- Service role: acesso total
DROP POLICY IF EXISTS "service_role_all_organizations"  ON organizations;
DROP POLICY IF EXISTS "service_role_all_org_members"    ON org_members;
DROP POLICY IF EXISTS "service_role_all_connected_repos" ON connected_repos;
DROP POLICY IF EXISTS "members_see_own_org"             ON organizations;
DROP POLICY IF EXISTS "members_see_own_membership"      ON org_members;
DROP POLICY IF EXISTS "members_see_own_repos"           ON connected_repos;
DROP POLICY IF EXISTS "admin_manage_repos"              ON connected_repos;

CREATE POLICY "service_role_all_organizations"
  ON organizations FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_org_members"
  ON org_members FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_connected_repos"
  ON connected_repos FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Usuário autenticado: vê apenas orgs das quais é membro
CREATE POLICY "members_see_own_org"
  ON organizations FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT org_id FROM org_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "members_see_own_membership"
  ON org_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "members_see_own_repos"
  ON connected_repos FOR SELECT TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM org_members WHERE user_id = auth.uid()
    )
  );

-- Owners/admins podem gerenciar repos da org
CREATE POLICY "admin_manage_repos"
  ON connected_repos FOR ALL TO authenticated
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

-- ======================================================
-- Função: criar org + owner na mesma transação
-- ======================================================
CREATE OR REPLACE FUNCTION create_organization(
  p_slug TEXT,
  p_name TEXT,
  p_user_id UUID
) RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  INSERT INTO organizations (slug, name)
  VALUES (p_slug, p_name)
  RETURNING id INTO v_org_id;

  INSERT INTO org_members (org_id, user_id, role, accepted_at)
  VALUES (v_org_id, p_user_id, 'owner', NOW());

  RETURN v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ======================================================
-- Função: incrementar contador de repos da org
-- ======================================================
CREATE OR REPLACE FUNCTION increment_repos_count(p_org_id UUID)
RETURNS void AS $$
  UPDATE organizations SET repos_count = repos_count + 1 WHERE id = p_org_id;
$$ LANGUAGE sql SECURITY DEFINER;

