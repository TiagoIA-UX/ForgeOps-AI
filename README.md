# ZAEA — Zairyx Autonomous Engineering Agent

<div align="center">
  <img src="https://img.shields.io/badge/Status-Active-brightgreen?style=flat-square" />
  <img src="https://img.shields.io/badge/Stack-Next.js_15_%2B_Supabase-black?style=flat-square&logo=nextdotjs" />
  <img src="https://img.shields.io/badge/AI-Groq_llama--3.3--70b-orange?style=flat-square" />
  <img src="https://img.shields.io/badge/Alerts-Telegram-blue?style=flat-square&logo=telegram" />
  <img src="https://img.shields.io/badge/CI-GitHub_Actions-black?style=flat-square&logo=githubactions" />
  <img src="https://img.shields.io/badge/License-MIT-purple?style=flat-square" />
</div>

<br/>

> **ZAEA** é um sistema de agentes autônomos de engenharia de software que monitora, diagnostica, corrige e valida plataformas Next.js + Supabase — com zero intervenção humana para falhas triviais.

---

## Visão geral

```
┌─────────────────────────────────────────────┐
│  MAESTRO            │  FORGE (este repo)     │
│  Chat AI Orchestrator│  TI/DevOps Orchestrator│
│  → Zai IA            │  → Scanner             │
│  → Suporte           │  → Surgeon             │
│  → Prospecção        │  → Validator           │
│  → Onboarding        │  → Sentinel            │
└─────────────────────────────────────────────┘
```

### Os dois orquestradores

| Nome | Função | Tecnologia |
|------|--------|-----------|
| **Maestro** | Orquestra agentes de conversação e IA | Groq + Supabase + WebSockets |
| **Forge** | Orquestra agentes de engenharia e DevOps | GitHub Actions + Groq + Supabase |

---

## Agentes do sistema Forge (ZAEA)

| Agente | Função | Trigger |
|--------|--------|---------|
| **Scanner** | Detecta erros de TypeScript, lint e build | Cron 10min |
| **Surgeon** | Gera e aplica patches automáticos via Groq | Pós-Scanner (erro encontrado) |
| **Validator** | Valida patches antes do merge em produção | Pós-Surgeon |
| **Sentinel** | Monitora alertas e notifica via Telegram | Contínuo (Python + Vercel) |
| **Orchestrator** | Coordena todos os agentes | Sempre |

### Classificação de risco

```
SAFE     → Forge aplica automaticamente + PR para revisão
MODERATE → Forge cria branch + aguarda aprovação
RISKY    → Forge documenta + escala para humano via Telegram
```

---

## Stack técnica

```
GitHub Actions     — Runner gratuito (2000min/mês) + cron scheduler
Groq llama-3.3-70b — Análise, diagnóstico, geração de patches
Supabase           — agent_tasks + agent_knowledge (base evolutiva)
Telegram Bot       — Alertas em tempo real (@ZaiSentinelBot)
Next.js 15         — API routes + admin dashboard
Python FastAPI     — Zai Sentinel local (backend/server.py)
```

---

## Database Schema

```sql
-- Fila de tarefas dos agentes
agent_tasks (
  id           UUID PRIMARY KEY,
  agent_name   TEXT  -- scanner|surgeon|validator|zai|sentinel|orchestrator
  status       TEXT  -- pending|running|completed|failed|escalated
  priority     TEXT  -- p0|p1|p2
  task_type    TEXT,
  input        JSONB,
  output       JSONB,
  github_pr_url TEXT,
  triggered_by  TEXT  -- cron|alert|manual|cascade
)

-- Base de conhecimento evolutiva
agent_knowledge (
  id          UUID PRIMARY KEY,
  pattern     TEXT,   -- padrão de erro identificado
  root_cause  TEXT,   -- causa raiz
  solution    TEXT,   -- solução aplicada
  confidence  INT,    -- 0-100%
  outcome     TEXT,   -- success|failed|escalated|partial
  occurrences INT     -- quantas vezes este padrão foi visto
)
```

---

## Workflow GitHub Actions

```yaml
# .github/workflows/zaea.yml
# Rodado a cada 10 minutos
on:
  schedule:
    - cron: '*/10 * * * *'
  workflow_dispatch:
    inputs:
      mode: [scan, fix, full]

jobs:
  scanner → surgeon → notifier
```

### Secrets necessários

| Secret | Descrição |
|--------|-----------|
| `GROQ_API_KEY` | Motor de IA para análise e patches |
| `SUPABASE_SERVICE_ROLE_KEY` | Acesso ao banco de tarefas |
| `TELEGRAM_BOT_TOKEN` | Bot de alertas |
| `TELEGRAM_CHAT_ID` | Chat de destino dos alertas |
| `INTERNAL_API_SECRET` | Autenticação interna da API |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave anon do Supabase |

---

## API

```
POST /api/agents/dispatch
Authorization: Bearer {INTERNAL_API_SECRET}

Body: {
  "agent": "scanner",
  "taskType": "quality_scan",
  "priority": "p1",
  "input": { "sha": "abc123" }
}

Response: { "success": true, "taskId": "uuid..." }
```

```
GET /api/agents/dispatch?agent=scanner&status=failed&hours=24
Authorization: Bearer {INTERNAL_API_SECRET}

Response: { tasks: [...], knowledge: [...], stats: {...} }
```

---

## ForgeOps Operation Contract (Official)

A partir da versão atual, a integração operacional do ForgeOps AI passa a ser regida por contrato global.

- Contrato oficial: `docs/operation-contract.md`
- Guia de integração: `docs/integration-guide.md`
- Checklist de adoção: `docs/adoption-checklist.md`
- Roadmap de rollout: `docs/rollout-roadmap.md`

SDK inicial do contrato operacional:

- `lib/forgeops/operation-tracker.ts`

Esse módulo padroniza:

- operationId e correlationId
- estados explícitos (`pending`, `processing`, `completed`, `failed`)
- transições válidas por matriz
- emissão de eventos estruturados (`<flow>.start|processing|completed|failed`)

---

## Admin Dashboard

Acesse em `/admin/agentes`:

- Cards de saúde por agente (Scanner, Surgeon, Validator, Sentinel, Orchestrator)
- Lista de tarefas com status em tempo real
- Base de conhecimento com confiança e histórico
- Filtros por agente, status e período

---

## Restrições absolutas (hard limits)

O Surgeon **nunca** toca em:
- Arquivos de pagamento (`payment`, `checkout`)
- Migrations SQL
- Arquivos de teste
- pasta `supabase/`
- Commits diretos em `main` sem passar pelo CI

---

## Estrutura de arquivos principais

```
lib/orchestrator.ts              → Forge: dispatchTask, recordOutcome, getKnowledge
backend/server.py                → Zai Sentinel Python agent (local + Docker)
.github/workflows/zaea.yml       → Pipeline Scanner → Surgeon → Notifier
app/api/agents/dispatch/route.ts → API REST para despacho de tarefas
app/admin/agentes/page.tsx       → Dashboard visual
supabase/migrations/047_agent_system.sql → Schema das tabelas
```

---

## Filosofia

> "A plataforma que não quebra não precisa de engenheiro às 3h da manhã."  
> — ZAEA foi construído para que a Zairyx escale sem escalar a equipe de TI.

---

## Licença

MIT © 2026 Zairyx / TiagoIA-UX
