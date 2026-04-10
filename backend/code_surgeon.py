"""
backend/code_surgeon.py
ForgeOps AI — Cirurgião de Código

Responsabilidades:
  1. Receber issues do workspace_scanner
  2. Usar Groq para gerar correções precisas (diff-style)
  3. Aplicar correções em branch separada via GitHub API
  4. Retornar lista de arquivos modificados para o pr_factory
"""

from __future__ import annotations

import base64
import os
import re
from dataclasses import dataclass, field
from typing import Any

import httpx

from workspace_scanner import ScanIssue, ScanReport

GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GITHUB_API = "https://api.github.com"

# Máximo de issues que o cirurgião tenta corrigir por execução
MAX_FIXES_PER_RUN = 10


@dataclass
class FileChange:
    path: str
    original: str
    patched: str
    issue: ScanIssue
    fix_description: str = ""


@dataclass
class SurgeryResult:
    branch: str
    changes: list[FileChange] = field(default_factory=list)
    skipped: list[ScanIssue] = field(default_factory=list)

    @property
    def success(self) -> bool:
        return len(self.changes) > 0


# ── Groq: geração de correção ─────────────────────────────────────────────────

async def generate_fix(content: str, issue: ScanIssue) -> tuple[str, str]:
    """
    Pede ao Groq para corrigir a issue no arquivo.
    Retorna (conteúdo_corrigido, descrição_da_correção).
    """
    if not GROQ_API_KEY:
        return content, ""

    # Contexto: ±5 linhas ao redor da issue
    lines = content.splitlines()
    start = max(0, issue.line - 6)
    end = min(len(lines), issue.line + 5)
    context = "\n".join(f"{i+1}: {l}" for i, l in enumerate(lines[start:end], start=start))

    prompt = (
        f"Você é um engenheiro sênior corrigindo um problema de código.\n\n"
        f"**Arquivo**: `{issue.file}`\n"
        f"**Problema**: {issue.message} (linha {issue.line})\n"
        f"**Categoria**: {issue.category} ({issue.severity})\n\n"
        f"**Contexto do arquivo** (linhas {start+1}-{end}):\n```\n{context}\n```\n\n"
        f"Retorne APENAS o arquivo completo corrigido, sem markdown, sem explicação antes ou depois. "
        f"Na última linha, adicione um comentário: `# FIX: <descrição curta da correção>`"
        f"\n\nArquivo completo:\n```\n{content[:6000]}\n```"
    )

    async with httpx.AsyncClient(timeout=45) as client:
        r = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": GROQ_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 4096,
                "temperature": 0.1,
            },
        )
        if r.status_code != 200:
            return content, ""

    raw = r.json()["choices"][0]["message"]["content"].strip()

    # Extrai descrição do fix
    fix_desc = ""
    match = re.search(r"# FIX: (.+)$", raw, re.MULTILINE)
    if match:
        fix_desc = match.group(1).strip()

    # Remove blocos de código markdown se o modelo os incluiu
    if raw.startswith("```"):
        raw = re.sub(r"^```[^\n]*\n", "", raw)
        raw = re.sub(r"\n```$", "", raw)

    return raw.strip(), fix_desc


# ── GitHub API helpers ────────────────────────────────────────────────────────

async def get_file_sha(owner: str, repo: str, path: str, token: str) -> str:
    """Busca SHA atual do arquivo (necessário para update via API)."""
    url = f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
        })
        if r.status_code == 200:
            return r.json().get("sha", "")
    return ""


async def create_branch(owner: str, repo: str, branch: str, base_sha: str, token: str) -> bool:
    """Cria branch a partir do SHA base."""
    url = f"{GITHUB_API}/repos/{owner}/{repo}/git/refs"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(url, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        }, json={"ref": f"refs/heads/{branch}", "sha": base_sha})
        return r.status_code in (201, 422)  # 422 = branch já existe


async def get_default_branch_sha(owner: str, repo: str, ref: str, token: str) -> str:
    """Busca SHA do commit mais recente do branch."""
    url = f"{GITHUB_API}/repos/{owner}/{repo}/git/ref/heads/{ref}"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(url, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
        })
        if r.status_code == 200:
            return r.json()["object"]["sha"]
    return ""


async def push_file(
    owner: str, repo: str, path: str,
    content: str, sha: str, branch: str,
    commit_msg: str, token: str,
) -> bool:
    """Atualiza arquivo no repositório via GitHub API."""
    url = f"{GITHUB_API}/repos/{owner}/{repo}/contents/{path}"
    encoded = base64.b64encode(content.encode()).decode()
    body: dict[str, Any] = {
        "message": commit_msg,
        "content": encoded,
        "branch": branch,
    }
    if sha:
        body["sha"] = sha

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.put(url, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        }, json=body)
        return r.status_code in (200, 201)


# ── Pipeline principal ────────────────────────────────────────────────────────

async def fetch_file_content(owner: str, repo: str, path: str, token: str) -> str:
    """Busca conteúdo de arquivo via API."""
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


async def apply_fixes(
    report: ScanReport,
    token: str,
    branch_name: str | None = None,
) -> SurgeryResult:
    """
    Pipeline principal do cirurgião:
    1. Prioriza issues críticas
    2. Para cada arquivo afetado, busca conteúdo e aplica fix via Groq
    3. Faz push dos arquivos corrigidos em nova branch
    4. Retorna SurgeryResult com todas as mudanças
    """
    from datetime import datetime
    owner = report.owner
    repo = report.repo
    ref = report.ref

    branch = branch_name or f"forgeops/auto-fix-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"

    # Pega SHA do branch base
    base_sha = await get_default_branch_sha(owner, repo, ref, token)
    if not base_sha:
        return SurgeryResult(branch=branch)

    # Cria branch para as correções
    await create_branch(owner, repo, branch, base_sha, token)

    result = SurgeryResult(branch=branch)

    # Prioriza críticos, depois warnings — máximo MAX_FIXES_PER_RUN
    prioritized = sorted(report.issues, key=lambda i: 0 if i.severity == "critical" else 1)
    prioritized = prioritized[:MAX_FIXES_PER_RUN]

    # Agrupa por arquivo para não buscar o mesmo arquivo 2x
    files_seen: dict[str, str] = {}  # path → conteúdo atual (já patchado)

    for issue in prioritized:
        path = issue.file

        # Busca conteúdo (cache por arquivo)
        if path not in files_seen:
            files_seen[path] = await fetch_file_content(owner, repo, path, token)

        original = files_seen[path]
        if not original:
            result.skipped.append(issue)
            continue

        # Gera correção via Groq
        patched, fix_desc = await generate_fix(original, issue)

        if not patched or patched == original:
            result.skipped.append(issue)
            continue

        # Busca SHA para update
        sha = await get_file_sha(owner, repo, path, token)

        # Faz push
        commit_msg = f"fix({path}): {fix_desc or issue.message} [ForgeOps AI]"
        pushed = await push_file(owner, repo, path, patched, sha, branch, commit_msg, token)

        if pushed:
            result.changes.append(FileChange(
                path=path,
                original=original,
                patched=patched,
                issue=issue,
                fix_description=fix_desc or issue.message,
            ))
            files_seen[path] = patched  # atualiza cache
        else:
            result.skipped.append(issue)

    return result
