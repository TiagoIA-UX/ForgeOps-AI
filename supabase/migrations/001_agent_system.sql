-- ============================================================
-- 047 — ZAEA: Tabelas do sistema de agentes autônomos
-- Criado em: 2026-04-04
-- Tabelas: agent_tasks, agent_knowledge
-- ============================================================
-- ── agent_tasks: fila de tarefas dos agentes ──────────────────────────────
CREATE TABLE IF NOT EXISTS agent_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name TEXT NOT NULL CHECK (
        agent_name IN (
            'orchestrator',
            'scanner',
            'surgeon',
            'validator',
            'zai',
            'sentinel'
        )
    ),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN (
            'pending',
            'running',
            'completed',
            'failed',
            'escalated'
        )
    ),
    priority TEXT NOT NULL DEFAULT 'p2' CHECK (priority IN ('p0', 'p1', 'p2')),
    task_type TEXT NOT NULL DEFAULT 'generic',
    input JSONB NOT NULL DEFAULT '{}',
    output JSONB NOT NULL DEFAULT '{}',
    error_message TEXT,
    github_pr_url TEXT,
    triggered_by TEXT,
    -- 'cron'|'alert'|'manual'|'cascade'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);
-- Índices para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks (status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent_name ON agent_tasks (agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_priority ON agent_tasks (priority);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created_at ON agent_tasks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_pending ON agent_tasks (status, priority, created_at)
WHERE status = 'pending';
-- ── agent_knowledge: base de conhecimento evolutiva dos agentes ───────────
CREATE TABLE IF NOT EXISTS agent_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern TEXT NOT NULL,
    -- padrão de erro/situação identificado
    root_cause TEXT,
    -- causa raiz descoberta
    solution TEXT,
    -- solução aplicada
    files_changed TEXT [] NOT NULL DEFAULT '{}',
    confidence INTEGER NOT NULL DEFAULT 50 CHECK (
        confidence BETWEEN 0 AND 100
    ),
    outcome TEXT CHECK (
        outcome IN ('success', 'failed', 'escalated', 'partial')
    ),
    occurrences INTEGER NOT NULL DEFAULT 1,
    last_task_id UUID REFERENCES agent_tasks(id) ON DELETE
    SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Índices
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_pattern ON agent_knowledge USING gin (to_tsvector('portuguese', pattern));
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_outcome ON agent_knowledge (outcome);
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_confidence ON agent_knowledge (confidence DESC);
-- ── RLS: apenas service_role acessa estas tabelas ─────────────────────────
ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_knowledge ENABLE ROW LEVEL SECURITY;
-- Sem policies de usuário final: acesso exclusivo via service role key
-- (GitHub Actions, Python backend, API routes com admin-auth)
-- ── Views de acompanhamento ───────────────────────────────────────────────
-- Resumo de tasks por agente/status (último 7 dias)
CREATE OR REPLACE VIEW agent_tasks_summary WITH (security_invoker = true) AS
SELECT agent_name,
    status,
    COUNT(*) AS total,
    COUNT(*) FILTER (
        WHERE priority = 'p0'
    ) AS p0_count,
    COUNT(*) FILTER (
        WHERE priority = 'p1'
    ) AS p1_count,
    MAX(created_at) AS last_created_at
FROM agent_tasks
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY agent_name,
    status;
-- Top padrões conhecidos com maior confiança
CREATE OR REPLACE VIEW agent_knowledge_top WITH (security_invoker = true) AS
SELECT id,
    pattern,
    root_cause,
    solution,
    confidence,
    outcome,
    occurrences,
    last_seen_at
FROM agent_knowledge
ORDER BY confidence DESC,
    occurrences DESC
LIMIT 50;
-- ============================================================
-- FIM DA MIGRATION 047
-- ============================================================