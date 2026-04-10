"""
backend/pr_factory.py
ForgeOps AI — Fábrica de Pull Requests

Responsabilidades:
  1. Criar PRs com as correções do code_surgeon
  2. Montar descrição detalhada em markdown (lista de fixes, severidade)
  3. Adicionar labels automaticamente
  4. Postar comentário de boas-vindas com resumo no PR
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx

from code_surgeon import SurgeryResult
from workspace_scanner import ScanReport

GITHUB_API = "https://api.github.com"


@dataclass
class PullRequest:
    number: int
    url: str
    title: str
    branch: str


# ── Helpers GitHub API ────────────────────────────────────────────────────────

async def ensure_labels(owner: str, repo: str, token: str) -> None:
    """Cria labels do ForgeOps AI se ainda não existem no repositório."""
    labels = [
        {"name": "forgeops-ai", "color": "0075ca", "description": "Criado pelo ForgeOps AI"},
        {"name": "auto-fix", "color": "e4e669", "description": "Correção automática de código"},
        {"name": "security", "color": "d93f0b", "description": "Problema de segurança"},
        {"name": "quality", "color": "bfd4f2", "description": "Qualidade de código"},
    ]
    async with httpx.AsyncClient(timeout=15) as client:
        for label in labels:
            await client.post(
                f"{GITHUB_API}/repos/{owner}/{repo}/labels",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
                json=label,
            )  # ignora 422 (já existe)


async def create_pull_request(
    owner: str, repo: str, token: str,
    title: str, body: str, head: str, base: str,
) -> dict[str, Any]:
    """Cria PR via GitHub API."""
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            f"{GITHUB_API}/repos/{owner}/{repo}/pulls",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "Content-Type": "application/json",
            },
            json={"title": title, "body": body, "head": head, "base": base},
        )
        if r.status_code == 201:
            return r.json()
    return {}


async def add_labels(owner: str, repo: str, pr_number: int, labels: list[str], token: str) -> None:
    """Adiciona labels ao PR."""
    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(
            f"{GITHUB_API}/repos/{owner}/{repo}/issues/{pr_number}/labels",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
            json={"labels": labels},
        )


async def post_comment(owner: str, repo: str, pr_number: int, body: str, token: str) -> None:
    """Posta comentário no PR."""
    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(
            f"{GITHUB_API}/repos/{owner}/{repo}/issues/{pr_number}/comments",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
            json={"body": body},
        )


# ── Geração do conteúdo do PR ─────────────────────────────────────────────────

def build_pr_title(result: SurgeryResult, report: ScanReport) -> str:
    n = len(result.changes)
    critical = sum(1 for c in result.changes if c.issue.severity == "critical")
    if critical:
        return f"fix: ForgeOps AI corrigiu {n} problema(s) — {critical} crítico(s)"
    return f"fix: ForgeOps AI aplicou {n} melhoria(s) de qualidade"


def build_pr_body(result: SurgeryResult, report: ScanReport) -> str:
    lines = [
        "## ForgeOps AI Auto-Fix\n",
        f"> Scan de `{report.owner}/{report.repo}` — {report.total_files} arquivos analisados\n",
    ]

    if report.summary:
        lines += [f"### Análise\n{report.summary}\n"]

    lines.append("### Correções aplicadas\n")
    for change in result.changes:
        icon = "🔴" if change.issue.severity == "critical" else "🟡"
        lines.append(
            f"- {icon} **[{change.issue.category}]** `{change.path}:{change.issue.line}` — "
            f"{change.fix_description or change.issue.message}"
        )

    if result.skipped:
        lines.append(f"\n### Ignorados ({len(result.skipped)})\n")
        lines.append("Os problemas abaixo precisam de revisão manual:\n")
        for issue in result.skipped[:10]:
            lines.append(f"- `{issue.file}:{issue.line}` — {issue.message}")

    lines += [
        "\n---",
        "_Este PR foi criado automaticamente pelo [ForgeOps AI](https://mergeforge-backend.onrender.com). "
        "Revise as alterações antes de fazer merge._",
    ]
    return "\n".join(lines)


def build_welcome_comment(result: SurgeryResult) -> str:
    return (
        "### ForgeOps AI analisou este PR\n\n"
        f"Apliquei **{len(result.changes)}** correção(ões) automática(s) nesta branch.\n\n"
        "**O que fazer agora:**\n"
        "1. Revise cada arquivo modificado no diff acima\n"
        "2. Rode os testes localmente se necessário\n"
        "3. Aprove e faça merge quando estiver satisfeito\n\n"
        "_ForgeOps AI nunca faz merge automático de suas próprias correções._"
    )


# ── Pipeline principal ────────────────────────────────────────────────────────

async def open_fix_pr(
    report: ScanReport,
    result: SurgeryResult,
    token: str,
    base_branch: str = "main",
) -> PullRequest | None:
    """
    Cria PR com todas as correções do SurgeryResult.
    Adiciona labels e posta comentário inicial.
    """
    if not result.success:
        return None

    owner = report.owner
    repo = report.repo

    # Garante que os labels existem
    await ensure_labels(owner, repo, token)

    title = build_pr_title(result, report)
    body = build_pr_body(result, report)

    pr_data = await create_pull_request(owner, repo, token, title, body, result.branch, base_branch)
    if not pr_data:
        return None

    pr_number = pr_data["number"]
    pr_url = pr_data["html_url"]

    # Labels
    labels = ["forgeops-ai", "auto-fix"]
    has_critical = any(c.issue.severity == "critical" for c in result.changes)
    has_security = any(c.issue.category == "security" for c in result.changes)
    if has_critical or has_security:
        labels.append("security")
    else:
        labels.append("quality")

    await add_labels(owner, repo, pr_number, labels, token)
    await post_comment(owner, repo, pr_number, build_welcome_comment(result), token)

    return PullRequest(
        number=pr_number,
        url=pr_url,
        title=title,
        branch=result.branch,
    )
