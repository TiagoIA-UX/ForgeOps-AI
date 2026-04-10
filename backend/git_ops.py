"""
backend/git_ops.py
ForgeOps AI — Git Ops — Automação de fluxos Git com IA (Groq).

Responsabilidades:
  1. Executar operações Git via subprocess (stage, commit, push, status, diff)
  2. Gerar mensagens de commit inteligentes via Groq
  3. Detectar conflitos de merge automaticamente
  4. Pipeline completo auto_ship(): stage → commit → push em um comando

Integração:
  - Chamado diretamente pelo server.py via endpoints /api/git/*
  - Pode ser importado por outros agentes do ForgeOps AI (Surgeon, Validator)
  - Todas as operações assíncronas via asyncio.to_thread (não bloqueia o event loop)
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
from pathlib import Path
from typing import Any

import httpx

# ── Config ────────────────────────────────────────────────────────────────────
GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
ROOT_DIR = Path(__file__).resolve().parent.parent

# Limite de diff enviado ao Groq para não estourar contexto
DIFF_MAX_CHARS = 8000


# ── Git helpers (síncronos — rodam em thread) ─────────────────────────────────

def _git_run(
    *args: str,
    cwd: Path | str | None = None,
    check: bool = False,
) -> tuple[int, str, str]:
    """Executa um comando git e retorna (returncode, stdout, stderr)."""
    cmd = ["git", *args]
    result = subprocess.run(
        cmd,
        cwd=str(cwd or ROOT_DIR),
        capture_output=True,
        text=True,
    )
    if check and result.returncode != 0:
        raise RuntimeError(
            f"git {' '.join(args)} falhou (code {result.returncode}): {result.stderr.strip()}"
        )
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def _sync_status(cwd: Path | str | None = None) -> dict[str, Any]:
    """Retorna status git: arquivos staged, modified, untracked e branch atual."""
    _, branch_out, _ = _git_run("rev-parse", "--abbrev-ref", "HEAD", cwd=cwd)
    _, staged_out, _ = _git_run("diff", "--name-only", "--cached", cwd=cwd)
    _, modified_out, _ = _git_run("diff", "--name-only", cwd=cwd)
    _, untracked_out, _ = _git_run(
        "ls-files", "--others", "--exclude-standard", cwd=cwd
    )
    _, conflict_out, _ = _git_run(
        "diff", "--name-only", "--diff-filter=U", cwd=cwd
    )

    return {
        "branch": branch_out or "unknown",
        "staged": [f for f in staged_out.splitlines() if f],
        "modified": [f for f in modified_out.splitlines() if f],
        "untracked": [f for f in untracked_out.splitlines() if f],
        "conflicts": [f for f in conflict_out.splitlines() if f],
        "has_changes": bool(staged_out or modified_out or untracked_out),
    }


def _sync_diff(staged: bool = True, cwd: Path | str | None = None) -> str:
    """Retorna o diff git (staged ou working tree). Limita a DIFF_MAX_CHARS."""
    args = ["diff", "--cached"] if staged else ["diff"]
    _, diff_out, _ = _git_run(*args, cwd=cwd)
    return diff_out[:DIFF_MAX_CHARS]


def _sync_stage(files: list[str] | None, cwd: Path | str | None = None) -> None:
    """Faz stage dos arquivos especificados (ou git add -A se files=None)."""
    if files:
        _git_run("add", "--", *files, cwd=cwd, check=True)
    else:
        _git_run("add", "-A", cwd=cwd, check=True)


def _sync_commit(message: str, cwd: Path | str | None = None) -> str:
    """Commita com a mensagem fornecida. Retorna o hash do commit."""
    _git_run("commit", "-m", message, cwd=cwd, check=True)
    _, hash_out, _ = _git_run("rev-parse", "--short", "HEAD", cwd=cwd)
    return hash_out


def _sync_push(branch: str, cwd: Path | str | None = None) -> None:
    """Push para origin/branch."""
    _git_run("push", "origin", branch, cwd=cwd, check=True)


# ── Versões assíncronas ───────────────────────────────────────────────────────

async def git_status(cwd: Path | str | None = None) -> dict[str, Any]:
    return await asyncio.to_thread(_sync_status, cwd)


async def git_diff(staged: bool = True, cwd: Path | str | None = None) -> str:
    return await asyncio.to_thread(_sync_diff, staged, cwd)


async def git_stage(files: list[str] | None = None, cwd: Path | str | None = None) -> None:
    await asyncio.to_thread(_sync_stage, files, cwd)


async def git_commit(message: str, cwd: Path | str | None = None) -> str:
    return await asyncio.to_thread(_sync_commit, message, cwd)


async def git_push(branch: str, cwd: Path | str | None = None) -> None:
    await asyncio.to_thread(_sync_push, branch, cwd)


async def git_detect_conflicts(cwd: Path | str | None = None) -> list[str]:
    status = await git_status(cwd)
    return status["conflicts"]


# ── Groq: geração de mensagem de commit ──────────────────────────────────────

async def generate_commit_message(diff: str) -> str:
    """
    Usa o Groq (llama-3.3-70b) para gerar uma mensagem de commit concisa
    em português a partir do diff staged.
    Retorna mensagem genérica se Groq não estiver configurado ou falhar.
    """
    if not GROQ_API_KEY:
        return "chore: atualização automática via ForgeOps AI"

    if not diff.strip():
        return "chore: sem alterações detectadas"

    prompt = (
        "Você é um assistente de engenharia de software especialista em Git.\n"
        "Analise o diff abaixo e gere UMA única mensagem de commit em português.\n"
        "Use o formato Conventional Commits: tipo(escopo opcional): descrição.\n"
        "Tipos válidos: feat, fix, chore, refactor, test, docs, style, perf.\n"
        "A mensagem deve ter no máximo 72 caracteres. Responda APENAS com a mensagem, sem explicações.\n\n"
        f"DIFF:\n{diff}"
    )

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": GROQ_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 80,
                    "temperature": 0.3,
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                message = data["choices"][0]["message"]["content"].strip()
                # Remove aspas ou prefixo que o modelo às vezes adiciona
                message = message.strip('"').strip("'")
                return message[:72] if message else "chore: atualização automática via ForgeOps AI"
    except Exception as exc:
        print(f"[git_ops] Groq falhou ao gerar mensagem de commit: {exc}")

    return "chore: atualização automática via ForgeOps AI"


# ── Pipeline completo ─────────────────────────────────────────────────────────

async def auto_ship(
    branch: str = "main",
    files: list[str] | None = None,
    commit_message: str | None = None,
    cwd: Path | str | None = None,
) -> dict[str, Any]:
    """
    Pipeline completo: stage → gera mensagem (IA) → commit → push.

    Args:
        branch: branch de destino para o push (default: main)
        files: lista de arquivos para stage (None = git add -A)
        commit_message: mensagem manual (None = gera via Groq)
        cwd: diretório do repositório (None = raiz do projeto)

    Returns:
        dict com status, commit_hash, branch, message e detalhes de erros.
    """
    result: dict[str, Any] = {
        "success": False,
        "branch": branch,
        "commit_hash": None,
        "commit_message": None,
        "staged_files": [],
        "error": None,
    }

    try:
        # 1. Stage
        await git_stage(files, cwd)

        # 2. Verifica se há algo staged
        status = await git_status(cwd)
        if not status["staged"]:
            result["error"] = "Nenhum arquivo staged para commitar."
            return result

        result["staged_files"] = status["staged"]

        # 3. Gera ou usa mensagem de commit
        if commit_message:
            message = commit_message
        else:
            diff = await git_diff(staged=True, cwd=cwd)
            message = await generate_commit_message(diff)

        result["commit_message"] = message

        # 4. Commit
        commit_hash = await git_commit(message, cwd)
        result["commit_hash"] = commit_hash

        # 5. Push
        await git_push(branch, cwd)

        result["success"] = True
        return result

    except RuntimeError as exc:
        result["error"] = str(exc)
        return result
    except Exception as exc:
        result["error"] = f"Erro inesperado: {exc}"
        return result
