-- ======================================================
-- ZAEA Migration 047 — Agent System
-- Schema das tabelas de tarefas e conhecimento dos agentes
-- ======================================================

-- Extensão UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ======================================================
-- agent_tasks — Fila de tarefas dos agentes
-- ======================================================
CREATE TABLE IF NOT EXISTS agent_tasks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_name    TEXT NOT NULL CHECK (agent_name IN ('scanner','surgeon','validator','sentinel','orchestrator')),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','completed','failed','escalated')),
  priority      TEXT NOT NULL DEFAULT 'p1'
                  CHECK (priority IN ('p0','p1','p2')),
  task_type     TEXT NOT NULL,
  input         JSONB NOT NULL DEFAULT '{}',
  output        JSONB,
  github_pr_url TEXT,
  triggered_by  TEXT NOT NULL DEFAULT 'manual'
                  CHECK (triggered_by IN ('cron','alert','manual','cascade')),
  error_message TEXT,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para queries frequentes
CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent_name  ON agent_tasks (agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status       ON agent_tasks (status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created_at   ON agent_tasks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_priority     ON agent_tasks (priority, created_at DESC);

-- ======================================================
-- agent_knowledge — Base de conhecimento evolutiva
-- ======================================================
CREATE TABLE IF NOT EXISTS agent_knowledge (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_name   TEXT NOT NULL CHECK (agent_name IN ('scanner','surgeon','validator','sentinel','orchestrator')),
  pattern      TEXT NOT NULL,
  root_cause   TEXT NOT NULL,
  solution     TEXT NOT NULL,
  confidence   INTEGER NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  outcome      TEXT NOT NULL CHECK (outcome IN ('success','failed','escalated','partial')),
  occurrences  INTEGER NOT NULL DEFAULT 1,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_knowledge_agent    ON agent_knowledge (agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_conf     ON agent_knowledge (confidence DESC);
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_pattern  ON agent_knowledge (pattern text_pattern_ops);

-- ======================================================
-- Trigger updated_at automático
-- ======================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_tasks_updated_at ON agent_tasks;
CREATE TRIGGER trg_agent_tasks_updated_at
  BEFORE UPDATE ON agent_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ======================================================
-- Row Level Security — apenas service role acessa
-- ======================================================
ALTER TABLE agent_tasks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_knowledge ENABLE ROW LEVEL SECURITY;

-- Políticas: somente service role (auth.role() = 'service_role')
DROP POLICY IF EXISTS "service_role_all_agent_tasks"    ON agent_tasks;
DROP POLICY IF EXISTS "service_role_all_agent_knowledge" ON agent_knowledge;
DROP POLICY IF EXISTS "authenticated_read_agent_tasks"   ON agent_tasks;
DROP POLICY IF EXISTS "authenticated_read_agent_knowledge" ON agent_knowledge;

CREATE POLICY "service_role_all_agent_tasks"
  ON agent_tasks FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_agent_knowledge"
  ON agent_knowledge FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Dashboard admin pode ler (sem escrever)
CREATE POLICY "authenticated_read_agent_tasks"
  ON agent_tasks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_read_agent_knowledge"
  ON agent_knowledge FOR SELECT
  TO authenticated
  USING (true);
