#!/usr/bin/env tsx
/**
 * forge-seed-knowledge.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Script de evolução contínua do ForgeOps AI.
 *
 * USO:
 *   npx tsx scripts/forge-seed-knowledge.ts               # seed padrões embutidos
 *   npx tsx scripts/forge-seed-knowledge.ts --dry-run     # mostra sem gravar
 *   npx tsx scripts/forge-seed-knowledge.ts --url <base>  # URL customizada
 *
 * COMO FUNCIONA:
 *   1. Mantém um catálogo de padrões conhecidos (KNOWN_PATTERNS abaixo)
 *   2. Para cada padrão, chama POST /api/agents/learn
 *   3. O ForgeOps passa a detectar e corrigir automaticamente
 *
 * ADICIONAR UM NOVO PADRÃO:
 *   Basta adicionar um objeto ao array KNOWN_PATTERNS seguindo o tipo KnownPattern.
 *   Execute o script para propagar para o banco.
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface KnownPattern {
  pattern: string
  error_type:
    | 'aria'
    | 'typescript'
    | 'powershell'
    | 'dockerfile'
    | 'markdown'
    | 'runtime'
    | 'custom'
  root_cause: string
  solution: string
  files_changed: string[]
  detection_pattern: string
  auto_fixable: boolean
  confidence: number
  resolved_by: string
}

// ─────────────────────────────────────────────────────────────────────────────
// CATÁLOGO DE PADRÕES CONHECIDOS
// Adicione aqui cada problema que você e o Copilot resolverem.
// O script propaga para a base do ForgeOps e ele passa a detectar/corrigir.
// ─────────────────────────────────────────────────────────────────────────────
const KNOWN_PATTERNS: KnownPattern[] = [
  // ── Sessão 2026-04-10 ────────────────────────────────────────────────────
  {
    pattern:
      'jsx-a11y/aria-proptypes: aria-selected com expressão dinâmica booleana em componente de tab/carousel',
    error_type: 'aria',
    root_cause:
      'O linter jsx-a11y/aria-proptypes não consegue inferir que uma expressão `{i === current}` sempre resulta em boolean. Reporta "Invalid ARIA attribute value: aria-selected={expression}".',
    solution:
      'Forçar booleano explícito: `aria-selected={cond ? true : false}`. Se o linter ainda rejeitar (expressão dinâmica), adicionar `// eslint-disable-next-line jsx-a11y/aria-proptypes` imediatamente acima do atributo. O código é semanticamente correto — é limitação do analisador estático.',
    files_changed: ['components/sections/TestimonialsSection.tsx'],
    detection_pattern: 'Invalid ARIA attribute value: aria-selected=',
    auto_fixable: true,
    confidence: 90,
    resolved_by: 'human+copilot',
  },
  {
    pattern: 'PowerShell: verbo não aprovado em nome de função (Trigger-*)',
    error_type: 'powershell',
    root_cause:
      'PSScriptAnalyzer e o VS Code PowerShell Extension reportam "uses an unapproved verb" para funções como `Trigger-X`. O PowerShell exige verbos aprovados (Get, Set, New, Invoke, Start, Stop, etc.).',
    solution:
      'Renomear a função usando um verbo aprovado. `Trigger-*` → `Invoke-*`. Atualizar todas as chamadas no mesmo arquivo. Lista de verbos aprovados: https://docs.microsoft.com/powershell/scripting/developer/cmdlet/approved-verbs-for-windows-powershell-commands',
    files_changed: ['scripts/dns-watch.ps1'],
    detection_pattern: "uses an unapproved verb|The cmdlet '.*' uses an unapproved verb",
    auto_fixable: true,
    confidence: 95,
    resolved_by: 'human+copilot',
  },
  {
    pattern: 'Markdown: HTML inline em README/docs (div, img, br sem alt text)',
    error_type: 'markdown',
    root_cause:
      'Markdownlint (MD033) proíbe HTML inline em arquivos .md. Badges criados como `<img src="shields.io/...">` violam MD033 e MD045 (sem alt text). Code fences sem linguagem violam MD040.',
    solution:
      'Substituir `<img src="shields.io/...">` por sintaxe markdown: `![AltText](url)`. Remover tags `<div>` e `<br/>`. Para code fences, adicionar linguagem (text, sql, yaml, http, bash, etc.). Alt text deve descrever o badge: "Status", "Stack", "License".',
    files_changed: ['ZAEA_README.md'],
    detection_pattern:
      'MD033/no-inline-html|MD045/no-alt-text|MD040/fenced-code-language|Inline HTML',
    auto_fixable: true,
    confidence: 88,
    resolved_by: 'human+copilot',
  },
  {
    pattern: 'Dockerfile: imagem base python:3.12-slim com vulnerabilidade high',
    error_type: 'dockerfile',
    root_cause:
      'A imagem `python:3.12-slim` possui pelo menos 1 vulnerabilidade de severidade HIGH no momento. Scanners como Docker Scout, Snyk e Trivy a detectam.',
    solution:
      'Atualizar para `python:3.13-slim` (versão mais recente) ou fixar em `python:3.12-slim-bookworm` com digest fixo. Verificar com `docker scout cves local://python:3.13-slim` antes de finalizar. Revisar periodicamente com cron mensal.',
    files_changed: ['backend/Dockerfile'],
    detection_pattern: 'image contains.*high vulnerability|HIGH.*CVE|CRITICAL.*CVE',
    auto_fixable: true,
    confidence: 85,
    resolved_by: 'human+copilot',
  },

  // ── Padrões gerais do projeto ─────────────────────────────────────────────
  {
    pattern: 'Next.js: "params" ou "searchParams" devem ser awaited em Server Components',
    error_type: 'typescript',
    root_cause:
      'No Next.js 15+ App Router, `params` e `searchParams` retornam `Promise<{...}>`. Acessar diretamente sem await causa erro de tipo `Type Promise<...> is not assignable to type...`.',
    solution:
      'Adicionar `await` ao desestruturar: `const { id } = await params`. Para `searchParams`: `const { q } = await searchParams ?? {}`. Marcar a função da página como `async` se ainda não estiver.',
    files_changed: [],
    detection_pattern:
      "Type 'Promise<.*>' is not assignable to type|params.*Promise.*must be awaited",
    auto_fixable: true,
    confidence: 90,
    resolved_by: 'human+copilot',
  },
  {
    pattern: 'ESLint: diagnóstico de cache desatualizado — erro reportado ainda aparece após correção',
    error_type: 'custom',
    root_cause:
      'O VS Code e outros IDEs mantêm cache de diagnósticos. Após corrigir um arquivo, o marcador de erro pode persistir até o servidor de linguagem re-analisar. Isso não indica erro real no código.',
    solution:
      'Não reverter a correção. Aguardar re-análise automática (5-30s) ou forçar com Command Palette → "TypeScript: Restart TS Server" / "ESLint: Restart ESLint Server". No CI, a questão não existe pois o lint roda do zero.',
    files_changed: [],
    detection_pattern: 'CACHE_STALE|diagnostic.*cache',
    auto_fixable: false,
    confidence: 75,
    resolved_by: 'human+copilot',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────
async function run() {
  const args = process.argv.slice(2)
  const isDryRun = args.includes('--dry-run')
  const urlFlag = args.indexOf('--url')
  const baseUrl =
    urlFlag !== -1 ? args[urlFlag + 1] : process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const secret = process.env.INTERNAL_API_SECRET

  if (!secret && !isDryRun) {
    console.error(
      '❌  INTERNAL_API_SECRET não definido. Configure no .env.local ou exporte antes de rodar.'
    )
    process.exit(1)
  }

  console.log(`\n🧠 ForgeOps — Seed de conhecimento (${KNOWN_PATTERNS.length} padrões)`)
  console.log(`   Base URL : ${baseUrl}`)
  console.log(`   Modo     : ${isDryRun ? 'DRY RUN (sem gravação)' : 'LIVE'}`)
  console.log(`   Data     : ${new Date().toLocaleString('pt-BR')}\n`)

  if (isDryRun) {
    for (const p of KNOWN_PATTERNS) {
      console.log(`  [DRY] ${p.error_type.padEnd(12)} | auto:${String(p.auto_fixable).padEnd(5)} | conf:${p.confidence}% | ${p.pattern.slice(0, 70)}`)
    }
    console.log('\n✅  Dry run concluído — nenhum dado gravado.')
    return
  }

  const res = await fetch(`${baseUrl}/api/agents/learn`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(KNOWN_PATTERNS),
  })

  if (!res.ok) {
    const txt = await res.text()
    console.error(`❌  Erro ${res.status}: ${txt.slice(0, 300)}`)
    process.exit(1)
  }

  const json = (await res.json()) as {
    recorded: number
    errors?: { index: number; error: string }[]
    results: { id: string; created: boolean; occurrences: number; pattern: string }[]
  }

  console.log(`✅  ${json.recorded}/${KNOWN_PATTERNS.length} padrões gravados com sucesso.\n`)

  for (const r of json.results) {
    const action = r.created ? '  NEW  ' : 'UPDATE '
    console.log(`  [${action}] occ:${r.occurrences} | ${r.pattern.slice(0, 80)}`)
  }

  if (json.errors?.length) {
    console.warn(`\n⚠  ${json.errors.length} erro(s) ao gravar:`)
    for (const e of json.errors) {
      console.warn(`  [${e.index}] ${e.error}`)
    }
  }

  console.log('\n🔥  ForgeOps agora conhece esses padrões e vai detectá-los automaticamente.\n')
}

run().catch((e) => {
  console.error('Falha no seed:', e)
  process.exit(1)
})
