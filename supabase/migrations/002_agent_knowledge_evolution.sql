-- =============================================================================
-- 063_agent_knowledge_evolution.sql
-- Evolução da base de conhecimento do ForgeOps AI
--
-- Adiciona campos para:
--   • categorizar erros por tipo (lint, typescript, powershell, dockerfile…)
--   • registrar quem resolveu (human+copilot, surgeon, auto)
--   • identificar padrão de detecção (grep/regex para o scanner encontrar)
--   • marcar se o ForgeOps pode auto-corrigir sem revisão humana
-- =============================================================================

-- ── Novos campos em agent_knowledge ──────────────────────────────────────────
ALTER TABLE agent_knowledge
  ADD COLUMN IF NOT EXISTS error_type   TEXT,        -- aria|typescript|powershell|dockerfile|markdown|runtime|custom
  ADD COLUMN IF NOT EXISTS resolved_by  TEXT,        -- surgeon|human+copilot|auto|manual
  ADD COLUMN IF NOT EXISTS detection_pattern TEXT,   -- regex/grep que identifica o erro no output do scanner
  ADD COLUMN IF NOT EXISTS auto_fixable BOOLEAN NOT NULL DEFAULT false;
                                                     -- true = ForgeOps pode corrigir sem revisão humana

-- Índice para busca por tipo de erro (scanner usa isso para priorizar)
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_error_type
  ON agent_knowledge (error_type, confidence DESC);

-- Índice para padrões auto-corrigíveis
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_auto_fixable
  ON agent_knowledge (auto_fixable, confidence DESC)
  WHERE auto_fixable = true;

-- ─── Comentários ───────────────────────────────────────────────────────────
COMMENT ON COLUMN agent_knowledge.error_type IS
  'Categoria do erro: aria|typescript|powershell|dockerfile|markdown|runtime|custom';

COMMENT ON COLUMN agent_knowledge.resolved_by IS
  'Quem resolveu: surgeon (PR automático), human+copilot (sessão manual), auto (script)';

COMMENT ON COLUMN agent_knowledge.detection_pattern IS
  'Regex ou grep-string que o scanner usa para detectar este padrão no output de lint/tsc/build';

COMMENT ON COLUMN agent_knowledge.auto_fixable IS
  'Se true, o Surgeon pode aplicar a correção automaticamente sem revisão humana';
