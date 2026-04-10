# Changelog — ForgeOps AI

All notable changes to ForgeOps AI are documented here.

---

## [1.0.0] — 2026-04-10

### 🚀 Initial Release — Autonomous Engineering Agent

First full production release of the ForgeOps AI autonomous engineering system for Next.js + Supabase platforms.

#### Core Agents
- **Scanner** — TypeScript, ESLint, Build analysis with Groq AI. Runs every 2h via GitHub Actions cron
- **Surgeon** — Auto-patch generation and application for SAFE-risk issues. Creates PRs automatically
- **Validator** — Daily health check of payment flows and critical API routes
- **Notifier** — Telegram alerts with human-readable summaries
- **Sentinel** — Python backend for continuous monitoring (FastAPI + Docker)

#### Scanner Extended Checks (new in 1.0.0)
- ARIA attribute violations (`jsx-a11y/aria-proptypes`)
- PowerShell unapproved verb detection (`Trigger-*` → `Invoke-*`)
- Markdown lint (MD033 inline HTML, MD040 code fences, MD045 alt text)
- Dockerfile base image vulnerability scanning (outdated Python/Node versions)
- **Knowledge base cross-check** — Scanner queries `agent_knowledge` to detect patterns already solved by the team

#### Self-Learning System (new in 1.0.0)
- `POST /api/agents/learn` — upsert resolved patterns into knowledge base
- `GET /api/agents/learn` — query knowledge by `error_type`, `auto_fixable`, text
- `scripts/forge-seed-knowledge.ts` — seed script to feed the knowledge base from resolved sessions
- Surgeon auto-records every successful PR into `agent_knowledge`
- `agent_knowledge` evolved: new fields `error_type`, `resolved_by`, `detection_pattern`, `auto_fixable`

#### Database
- `supabase/migrations/001_agent_system.sql` — Core tables: `agent_tasks`, `agent_knowledge`, views, RLS
- `supabase/migrations/002_agent_knowledge_evolution.sql` — Evolution fields for self-learning

#### Infrastructure
- GitHub Actions workflow: Scanner → Surgeon → Notifier → Validator
- Python FastAPI backend with Docker support
- AI routing: Vercel AI Gateway (primary) → Groq direct (fallback)
- Rate limiting and internal API authentication via `INTERNAL_API_SECRET`

---

## Upgrade Notes (for Zairyx/Cardápio Digital)

If upgrading from the embedded ZAEA system:
1. Run `supabase/migrations/002_agent_knowledge_evolution.sql` on your Supabase project
2. Add `NEXT_PUBLIC_APP_URL` to your GitHub Actions secrets (used by Surgeon to call `/api/agents/learn`)
3. Run `npm run forge:seed` once to pre-populate the knowledge base with known patterns
