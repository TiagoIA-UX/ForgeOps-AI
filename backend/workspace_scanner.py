"""
backend/workspace_scanner.py
ForgeOps AI — Scanner de Workspace

Responsabilidades:
  1. Clonar/atualizar repositório via GitHub App token
  2. Escanear arquivos por categoria (TS, Python, SQL, config)
  3. Detectar problemas: segurança, qualidade, testes, padrões
  4. Retornar relatório estruturado para o code_surgeon agir
"""

from __future__ import annotations

import os
import re
import tempfile
import asyncio
from dataclasses import dataclass, field
from typing import Any
from pathlib import Path

import httpx

GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GITHUB_API = "https://api.github.com"
GITHUB_TOKEN: str = os.getenv("GITHUB_TOKEN", "")

# Padrões adicionais por persona
UX_PATTERNS = [
    (r"loading\.\.\.(?!.*<)", "loading state sem feedback visual adequado"),
    (r"<button(?![^>]*aria-label)", "botão sem aria-label (acessibilidade)"),
    (r"disabled(?!.*tooltip)", "elemento desabilitado sem feedback ao usuário"),
    (r'''href=['"]#['"](?!.*onClick)''', "link vazio sem handler — frustra navegação"),
    (r"catch.*console\.error", "erro tratado mas não exibido pro usuário"),
]

BUSINESS_PATTERNS = [
    (r"price\s*[\*\+\-/]\s*(?!.*server)", "cálculo de preço no cliente (risco de manipulação)"),
    (r'''status\s*===?\s*['"]paid['"]\s*(?!.*server)''', "validação de pagamento no cliente"),
    (r"TODO.*pagar|TODO.*pagamento|TODO.*cobrar", "lógica de cobrança pendente (TODO)"),
    (r"isPremium|hasPlan|canAccess.*true", "entitlement hardcoded como true"),
    (r"trial.*\b30\b|trial.*\b7\b", "período de trial hardcoded — usar constante"),
]

MARKETING_LEGAL_PATTERNS = [
    (r"garantid[oa]|garantia de resultado", "promessa absoluta de resultado — risco legal de marketing"),
    (r"sem risco|risco zero|100% seguro", "afirmação absoluta sem ressalva — risco de publicidade enganosa"),
    (r"líder absoluto|o melhor do brasil|n[ºo] ?1 do brasil", "claim comparativo absoluto sem fonte verificável"),
    (r"depoimento|testimonial|case real", "verificar se há comprovação documental para prova social"),
    (r"economia de r\$|r\$\s?\d+[\.,]?\d*\+", "valor monetário em copy — confirmar fonte, contexto e ressalva"),
    (r"até \d+%|\d+% de comissão", "percentual em copy — confirmar fonte e data da consulta"),
    (r"consulta em|consultado em", "copy com fonte temporal — validar se ainda está atualizada"),
]

# Extensões analisadas
SCAN_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".py", ".sql", ".json", ".mjs"}

# Padrões de risco direto (regex)
SECURITY_PATTERNS = [
    (r"console\.log\(.*(?:password|secret|token|key|auth)", "credencial exposta em console.log"),
    (r"eval\s*\(", "uso de eval() — risco de injection"),
    (r"innerHTML\s*=", "innerHTML direto — risco de XSS"),
    (r"dangerouslySetInnerHTML", "dangerouslySetInnerHTML sem sanitização"),
    (r"Math\.random\(\).*(?:token|secret|key|id)", "Math.random() para geração de tokens — não criptográfico"),
    (r"SELECT \*\s+FROM", "SELECT * — expõe todos os campos"),
    (r"(?:password|senha|secret)\s*=\s*['\"][^'\"]{3,}['\"]", "credencial hardcoded"),
    (r"http://(?!localhost|127\.0\.0\.1)", "URL HTTP sem TLS em produção"),
]

# Padrões de qualidade
QUALITY_PATTERNS = [
    (r"TODO|FIXME|HACK|XXX", "comentário pendente"),
    (r"any\b", "uso de `any` — tipo explícito recomendado"),
    (r"@ts-ignore", "@ts-ignore — supressão de erro TypeScript"),
    (r"eslint-disable", "eslint-disable — supressão de lint"),
    (r"\.catch\s*\(\s*\)", "catch vazio — erro silenciado"),
    (r"setTimeout.*0\b", "setTimeout(fn, 0) — anti-pattern de timing"),
]


@dataclass
class ScanIssue:
    file: str
    line: int
    category: str   # "security" | "quality" | "test" | "pattern"
    severity: str   # "critical" | "warning" | "info"
    message: str
    snippet: str = ""


@dataclass
class ScanReport:
    owner: str
    repo: str
    ref: str
    total_files: int = 0
    issues: list[ScanIssue] = field(default_factory=list)
    summary: str = ""

    @property
    def critical(self) -> list[ScanIssue]:
        return [i for i in self.issues if i.severity == "critical"]

    @property
    def warnings(self) -> list[ScanIssue]:
        return [i for i in self.issues if i.severity == "warning"]

    def to_markdown(self) -> str:
        lines = [
            f"## Relatório ForgeOps AI — `{self.owner}/{self.repo}` @ `{self.ref}`\n",
            f"**Arquivos escaneados:** {self.total_files}  ",
            f"**Críticos:** {len(self.critical)}  ",
            f"**Avisos:** {len(self.warnings)}\n",
        ]
        if self.summary:
            lines += [f"\n### Análise IA\n{self.summary}\n"]
        if self.critical:
            lines.append("\n### Críticos\n")
            for i in self.critical:
                lines.append(f"- **[{i.file}:{i.line}]** {i.message}")
                if i.snippet:
                    lines.append(f"  ```\n  {i.snippet}\n  ```")
        if self.warnings:
            lines.append("\n### Avisos\n")
            for i in self.warnings[:20]:  # limita output
                lines.append(f"- [{i.file}:{i.line}] {i.message}")
        return "\n".join(lines)


# ── Funções principais ────────────────────────────────────────────────────────

async def fetch_repo_tree(owner: str, repo: str, token: str, ref: str = "main") -> list[dict]:
    """Busca árvore completa de arquivos do repositório via API."""
    url = f"{GITHUB_API}/repos/{owner}/{repo}/git/trees/{ref}?recursive=1"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
        })
        r.raise_for_status()
        data = r.json()
    return [f for f in data.get("tree", []) if f.get("type") == "blob"]


async def fetch_file_content(owner: str, repo: str, path: str, token: str) -> str:
    """Busca conteúdo de um arquivo via API (base64 decode)."""
    import base64
    url = f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}"
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
        })
        if r.status_code == 200:
            data = r.json()
            if data.get("encoding") == "base64":
                return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
    return ""


def scan_file_content(filepath: str, content: str) -> list[ScanIssue]:
    """Aplica todos os padrões de scan em um arquivo."""
    issues: list[ScanIssue] = []
    lines = content.splitlines()

    for lineno, line in enumerate(lines, start=1):
        # Segurança
        for pattern, message in SECURITY_PATTERNS:
            if re.search(pattern, line, re.IGNORECASE):
                issues.append(ScanIssue(
                    file=filepath,
                    line=lineno,
                    category="security",
                    severity="critical",
                    message=message,
                    snippet=line.strip()[:120],
                ))
        # Qualidade
        for pattern, message in QUALITY_PATTERNS:
            if re.search(pattern, line):
                issues.append(ScanIssue(
                    file=filepath,
                    line=lineno,
                    category="quality",
                    severity="warning",
                    message=message,
                    snippet=line.strip()[:120],
                ))

    return issues


PERSONA_PROMPTS: dict[str, str] = {
    "dev_auditor": (
        "Você é um Desenvolvedor Sênior auditando o código do repositório `{repo}`. "
        "Foque em: segurança, arquitetura, dívida técnica, padrões e manutenção. "
        "Escreva um resumo executivo em português de 3-4 frases com os riscos mais críticos:"
    ),
    "ux_inspector": (
        "Você é um Designer UX auditando a experiência do usuário no repositório `{repo}`. "
        "Foque em: consistência de fluxos, feedback visual, acessibilidade, erros silenciados. "
        "Escreva um resumo executivo em português de 3-4 frases com os problemas de UX:"
    ),
    "business_analyst": (
        "Você é um Analista de Negócio auditando o repositório `{repo}`. "
        "Foque em: regras de pagamento, entitlements, planos, onboarding e lógicas críticas de negócio. "
        "Escreva um resumo executivo em português de 3-4 frases com os riscos de negócio:"
    ),
    "marketing_legal_auditor": (
        "Você é um Auditor de Marketing e Compliance auditando o repositório `{repo}`. "
        "Foque em: claims absolutos, prova social não comprovada, comparativos sem fonte, "
        "promessas financeiras, datas de consulta e riscos de publicidade enganosa. "
        "Escreva um resumo executivo em português de 3-4 frases com os riscos legais e de copy:"
    ),
}


async def ai_summarize(report: ScanReport, persona: str = "dev_auditor") -> str:
    """Usa Groq para gerar análise em linguagem natural do relatório."""
    if not GROQ_API_KEY or not report.issues:
        return ""

    snippet = "\n".join(
        f"- [{i.severity}] {i.file}:{i.line} — {i.message}"
        for i in report.issues[:30]
    )
    base_prompt = PERSONA_PROMPTS.get(persona, PERSONA_PROMPTS["dev_auditor"]).format(
        repo=f"{report.owner}/{report.repo}"
    )
    prompt = f"{base_prompt}\n\n{snippet}"

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": GROQ_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 300,
                "temperature": 0.3,
            },
        )
        if r.status_code == 200:
            return r.json()["choices"][0]["message"]["content"].strip()
    return ""


def scan_file_content_for_persona(
    filepath: str,
    content: str,
    persona: str,
) -> list[ScanIssue]:
    """Aplica padrões específicos de persona em um arquivo."""
    issues = scan_file_content(filepath, content)
    extra_patterns: list[tuple[str, str]] = []
    if persona == "ux_inspector":
        extra_patterns = UX_PATTERNS
    elif persona == "business_analyst":
        extra_patterns = BUSINESS_PATTERNS
    elif persona == "marketing_legal_auditor":
        extra_patterns = MARKETING_LEGAL_PATTERNS
    if extra_patterns:
        lines = content.splitlines()
        for lineno, line in enumerate(lines, start=1):
            for pattern, message in extra_patterns:
                if re.search(pattern, line, re.IGNORECASE):
                    issues.append(ScanIssue(
                        file=filepath,
                        line=lineno,
                        category="persona",
                        severity="warning",
                        message=message,
                        snippet=line.strip()[:120],
                    ))
    return issues


async def scan_repository(
    owner: str,
    repo: str,
    token: str | None = None,
    ref: str = "main",
    max_files: int = 200,
    persona: str = "dev_auditor",
) -> ScanReport:
    """
    Pipeline completo: busca árvore → filtra arquivos relevantes →
    escaneia conteúdo → gera relatório com resumo IA.
    Aceita `persona` para adaptar o foco da análise:
      - dev_auditor: segurança + qualidade (padrão)
      - ux_inspector: UX + acessibilidade
      - business_analyst: regras de negócio + pagamentos
    """
    resolved_token = token or GITHUB_TOKEN
    if not resolved_token:
        raise ValueError("GITHUB_TOKEN não configurado e nenhum token foi fornecido.")

    report = ScanReport(owner=owner, repo=repo, ref=ref)

    # 1. Busca árvore
    tree = await fetch_repo_tree(owner, repo, resolved_token, ref)

    # 2. Filtra por extensão e exclui node_modules/dist/build
    EXCLUDE = {"node_modules", ".next", "dist", "build", ".git", "__pycache__", ".venv"}
    # Persona business_analyst foca em TS/TSX; ux_inspector também em TSX
    focus_exts = SCAN_EXTENSIONS
    if persona == "ux_inspector":
        focus_exts = {".tsx", ".ts", ".jsx", ".js"}
    elif persona == "business_analyst":
        focus_exts = {".ts", ".tsx", ".js"}
    elif persona == "marketing_legal_auditor":
        focus_exts = {".tsx", ".ts", ".jsx", ".js", ".md"}

    relevant = [
        f for f in tree
        if Path(f["path"]).suffix in focus_exts
        and not any(part in EXCLUDE for part in Path(f["path"]).parts)
    ][:max_files]

    report.total_files = len(relevant)

    # 3. Busca e escaneia arquivos em paralelo (lotes de 10)
    async def scan_one(file_info: dict) -> list[ScanIssue]:
        content = await fetch_file_content(owner, repo, file_info["path"], resolved_token)
        if not content:
            return []
        return scan_file_content_for_persona(file_info["path"], content, persona)

    batch_size = 10
    for i in range(0, len(relevant), batch_size):
        batch = relevant[i:i + batch_size]
        results = await asyncio.gather(*[scan_one(f) for f in batch])
        for issues in results:
            report.issues.extend(issues)

    # 4. Resumo IA com prompt de persona
    report.summary = await ai_summarize(report, persona=persona)

    return report
