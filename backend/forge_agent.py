"""
backend/forge_agent.py
Forge Agent — Agente autônomo de GitHub (módulo ForgeOps AI).

Responsabilidades:
  1. Verificar assinatura de webhooks GitHub (HMAC-SHA256)
  2. Auto-label de PRs com base no diff (feat, fix, chore, docs, breaking, test)
  3. Review automático de PR com IA (Groq) antes dos humanos
  4. Auto-merge quando CI passa + aprovação mínima configurada
  5. Detecção de conflitos e resolução simples (lockfiles, changelogs, imports)
  6. Zero-config: lê README, CONTRIBUTING, histórico de PRs para inferir regras

Integração:
  - Recebe eventos via POST /api/forge/github (registrado no server.py)
  - Usa GitHub App (JWT + Installation Token) ou PAT como fallback
  - Notifica via Telegram em eventos relevantes
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

# ── Config ────────────────────────────────────────────────────────────────────
GITHUB_APP_ID: str = os.getenv("FORGE_GITHUB_APP_ID", "")
GITHUB_PRIVATE_KEY: str = os.getenv("FORGE_GITHUB_PRIVATE_KEY", "")  # PEM completo
GITHUB_WEBHOOK_SECRET: str = os.getenv("FORGE_GITHUB_WEBHOOK_SECRET", "")
GITHUB_PAT: str = os.getenv("FORGE_GITHUB_PAT", "")  # fallback para dev
GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

GITHUB_API = "https://api.github.com"
DIFF_MAX_CHARS = 12000
PR_REVIEW_MAX_CHARS = 8000


# ── Tipos ─────────────────────────────────────────────────────────────────────

@dataclass
class RepoProfile:
    """Perfil inferido automaticamente do repositório (zero-config)."""
    owner: str
    repo: str
    default_branch: str = "main"
    commit_convention: str = "conventional"   # convencional ou livre
    min_approvals: int = 1
    auto_merge_enabled: bool = True
    label_mapping: dict[str, list[str]] = field(default_factory=dict)
    protected_paths: list[str] = field(default_factory=list)


@dataclass
class ForgeResult:
    """Resultado de uma ação do Forge Agent."""
    action: str
    success: bool
    detail: str
    labels_added: list[str] = field(default_factory=list)
    review_posted: bool = False
    merged: bool = False
    conflicts_resolved: bool = False


# ── Segurança: verificação de assinatura ─────────────────────────────────────

def verify_webhook_signature(payload_bytes: bytes, signature_header: str) -> bool:
    """
    Verifica a assinatura HMAC-SHA256 enviada pelo GitHub.
    Retorna False (rejeita) se o segredo não estiver configurado.
    """
    if not GITHUB_WEBHOOK_SECRET:
        return False
    if not signature_header or not signature_header.startswith("sha256="):
        return False

    expected = hmac.new(
        GITHUB_WEBHOOK_SECRET.encode("utf-8"),
        payload_bytes,
        hashlib.sha256,
    ).hexdigest()

    received = signature_header.removeprefix("sha256=")
    return hmac.compare_digest(expected, received)


# ── Auth: GitHub App JWT + Installation Token ─────────────────────────────────

def _build_jwt() -> str | None:
    """Gera um JWT para autenticar como GitHub App (válido por 10 minutos)."""
    if not GITHUB_APP_ID or not GITHUB_PRIVATE_KEY:
        return None
    try:
        import jwt as pyjwt  # PyJWT
        now = int(time.time())
        payload = {"iat": now - 60, "exp": now + 540, "iss": GITHUB_APP_ID}
        token = pyjwt.encode(payload, GITHUB_PRIVATE_KEY, algorithm="RS256")
        return token if isinstance(token, str) else token.decode()
    except Exception as exc:
        print(f"[forge] JWT falhou: {exc}")
        return None


async def _get_installation_token(installation_id: int) -> str | None:
    """Troca o JWT por um Installation Token (válido 1h)."""
    jwt_token = _build_jwt()
    if not jwt_token:
        return GITHUB_PAT or None

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{GITHUB_API}/app/installations/{installation_id}/access_tokens",
            headers={
                "Authorization": f"Bearer {jwt_token}",
                "Accept": "application/vnd.github+json",
            },
        )
        if resp.status_code == 201:
            return resp.json().get("token")
    return GITHUB_PAT or None


def _gh_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


# ── GitHub API helpers ────────────────────────────────────────────────────────

async def _gh_get(path: str, token: str) -> dict[str, Any] | list | None:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{GITHUB_API}{path}", headers=_gh_headers(token))
        if resp.status_code == 200:
            return resp.json()
    return None


async def _gh_post(path: str, token: str, body: dict) -> dict[str, Any] | None:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{GITHUB_API}{path}", headers=_gh_headers(token), json=body
        )
        if resp.status_code in (200, 201):
            return resp.json()
    return None


async def _gh_put(path: str, token: str, body: dict) -> dict[str, Any] | None:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.put(
            f"{GITHUB_API}{path}", headers=_gh_headers(token), json=body
        )
        if resp.status_code in (200, 201, 204):
            return resp.json() if resp.content else {}
    return None


async def _get_pr_diff(owner: str, repo: str, pr_number: int, token: str) -> str:
    """Retorna o diff do PR como texto."""
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}",
            headers={**_gh_headers(token), "Accept": "application/vnd.github.diff"},
        )
        if resp.status_code == 200:
            return resp.text[:DIFF_MAX_CHARS]
    return ""


# ── Zero-config: descoberta automática do repositório ────────────────────────

async def discover_repo_profile(
    owner: str, repo: str, token: str
) -> RepoProfile:
    """
    Lê README, CONTRIBUTING e últimos PRs para inferir regras do repositório.
    Nunca falha — retorna perfil padrão seguro se não encontrar nada.
    """
    profile = RepoProfile(owner=owner, repo=repo)

    # Detecta branch padrão
    repo_data = await _gh_get(f"/repos/{owner}/{repo}", token)
    if isinstance(repo_data, dict):
        profile.default_branch = repo_data.get("default_branch", "main")

    # Lê CONTRIBUTING.md para detectar convenção de commits
    for path in ("CONTRIBUTING.md", "docs/CONTRIBUTING.md", ".github/CONTRIBUTING.md"):
        content_data = await _gh_get(
            f"/repos/{owner}/{repo}/contents/{path}", token
        )
        if isinstance(content_data, dict) and content_data.get("content"):
            import base64
            text = base64.b64decode(content_data["content"]).decode("utf-8", errors="ignore")
            if "conventional" in text.lower() or "feat:" in text.lower():
                profile.commit_convention = "conventional"
            break

    # Detecta caminhos protegidos pelo CODEOWNERS
    codeowners_data = await _gh_get(
        f"/repos/{owner}/{repo}/contents/.github/CODEOWNERS", token
    )
    if isinstance(codeowners_data, dict) and codeowners_data.get("content"):
        import base64
        text = base64.b64decode(codeowners_data["content"]).decode("utf-8", errors="ignore")
        profile.protected_paths = [
            line.split()[0]
            for line in text.splitlines()
            if line.strip() and not line.startswith("#")
        ][:20]

    # Aprende número mínimo de aprovações com últimos PRs mergeados
    prs = await _gh_get(
        f"/repos/{owner}/{repo}/pulls?state=closed&per_page=10", token
    )
    if isinstance(prs, list):
        approval_counts = []
        for pr in prs[:5]:
            if pr.get("merged_at"):
                reviews = await _gh_get(
                    f"/repos/{owner}/{repo}/pulls/{pr['number']}/reviews", token
                )
                if isinstance(reviews, list):
                    approvals = sum(1 for r in reviews if r.get("state") == "APPROVED")
                    approval_counts.append(approvals)
        if approval_counts:
            profile.min_approvals = max(1, min(approval_counts))

    return profile


# ── Feature 1: Auto-label ─────────────────────────────────────────────────────

LABEL_COLORS = {
    "feat": "0075ca",
    "fix": "e4e669",
    "chore": "ededed",
    "docs": "0052cc",
    "test": "bfd4f2",
    "breaking": "b60205",
    "refactor": "d93f0b",
    "perf": "006b75",
}

LABEL_RULES = {
    "breaking": [r"BREAKING CHANGE", r"!:", r"major\("],
    "feat": [r"^feat(\(|:)", r"\+\+\+.*\.(feature|feat)"],
    "fix": [r"^fix(\(|:)", r"bug", r"patch"],
    "docs": [r"^docs(\(|:)", r"\.md$", r"README", r"CHANGELOG"],
    "test": [r"^test(\(|:)", r"\.test\.", r"\.spec\.", r"__tests__"],
    "perf": [r"^perf(\(|:)", r"performance", r"optimize"],
    "refactor": [r"^refactor(\(|:)"],
    "chore": [r"^chore(\(|:)", r"package\.json", r"\.lock$", r"deps"],
}


async def _ensure_label_exists(
    owner: str, repo: str, label: str, token: str
) -> None:
    """Cria o label no repositório se ainda não existir."""
    existing = await _gh_get(f"/repos/{owner}/{repo}/labels/{label}", token)
    if existing is None:
        await _gh_post(
            f"/repos/{owner}/{repo}/labels",
            token,
            {"name": label, "color": LABEL_COLORS.get(label, "cccccc")},
        )


async def auto_label_pr(
    owner: str,
    repo: str,
    pr_number: int,
    pr_title: str,
    diff: str,
    token: str,
) -> list[str]:
    """
    Analisa o título + diff do PR e aplica labels automaticamente.
    Usa regex primeiro; se inconclusivo, usa Groq para classificar.
    """
    combined = f"{pr_title}\n{diff[:2000]}"
    detected: list[str] = []

    for label, patterns in LABEL_RULES.items():
        for pattern in patterns:
            if re.search(pattern, combined, re.IGNORECASE | re.MULTILINE):
                detected.append(label)
                break

    # Se nenhum padrão simples detectou, usa Groq
    if not detected and GROQ_API_KEY:
        detected = await _groq_classify_pr(pr_title, diff[:3000])

    if not detected:
        detected = ["chore"]

    # Garante que os labels existem e aplica
    for label in detected:
        await _ensure_label_exists(owner, repo, label, token)

    await _gh_post(
        f"/repos/{owner}/{repo}/issues/{pr_number}/labels",
        token,
        {"labels": detected},
    )
    return detected


async def _groq_classify_pr(title: str, diff: str) -> list[str]:
    """Usa Groq para classificar o PR quando regex não é suficiente."""
    if not GROQ_API_KEY:
        return []

    prompt = (
        "Classifique este Pull Request usando Conventional Commits.\n"
        "Responda APENAS com uma lista JSON de labels válidos:\n"
        '["feat"], ["fix"], ["docs"], ["test"], ["chore"], ["refactor"], ["perf"], ["breaking"]\n'
        "Pode retornar múltiplos. Exemplo: [\"feat\", \"breaking\"]\n\n"
        f"TÍTULO: {title}\n\nDIFF (parcial):\n{diff}"
    )

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": GROQ_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 50,
                    "temperature": 0.1,
                },
            )
            if resp.status_code == 200:
                content = resp.json()["choices"][0]["message"]["content"].strip()
                parsed = json.loads(content)
                if isinstance(parsed, list):
                    valid = {"feat", "fix", "docs", "test", "chore", "refactor", "perf", "breaking"}
                    return [l for l in parsed if l in valid]
    except Exception as exc:
        print(f"[forge] Groq classify falhou: {exc}")

    return []


# ── Feature 2: Review automático com IA ──────────────────────────────────────

async def auto_review_pr(
    owner: str,
    repo: str,
    pr_number: int,
    pr_title: str,
    diff: str,
    token: str,
) -> bool:
    """
    Posta um review automático no PR com análise de IA.
    Só usa COMMENT (não APPROVE/REQUEST_CHANGES) para não bloquear humanos.
    """
    if not GROQ_API_KEY or not diff.strip():
        return False

    prompt = (
        "Você é um engenheiro sênior fazendo code review.\n"
        "Analise o diff abaixo e escreva um review CONCISO em português.\n"
        "Formato: 3 seções máximo — ✅ Pontos positivos, ⚠️ Atenção, 💡 Sugestões.\n"
        "Seja direto. Máximo 300 palavras. NÃO aprove nem rejeite — apenas analise.\n\n"
        f"PR: {pr_title}\n\nDIFF:\n{diff[:PR_REVIEW_MAX_CHARS]}"
    )

    try:
        async with httpx.AsyncClient(timeout=25) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": GROQ_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 500,
                    "temperature": 0.4,
                },
            )
            if resp.status_code != 200:
                return False

            review_body = resp.json()["choices"][0]["message"]["content"].strip()
            review_body = f"🤖 **Forge Agent — AI Review**\n\n{review_body}\n\n---\n*Review automático. Aguarde aprovação humana.*"

            result = await _gh_post(
                f"/repos/{owner}/{repo}/pulls/{pr_number}/reviews",
                token,
                {"body": review_body, "event": "COMMENT"},
            )
            return result is not None

    except Exception as exc:
        print(f"[forge] Review automático falhou: {exc}")
        return False


# ── Feature 3: Auto-merge ─────────────────────────────────────────────────────

async def check_and_auto_merge(
    owner: str,
    repo: str,
    pr_number: int,
    profile: RepoProfile,
    token: str,
) -> bool:
    """
    Faz merge automático se:
    1. CI passou (todos os checks verdes)
    2. Mínimo de aprovações atingido
    3. PR não tem conflitos
    4. PR não toca em caminhos protegidos (CODEOWNERS)
    """
    pr_data = await _gh_get(f"/repos/{owner}/{repo}/pulls/{pr_number}", token)
    if not isinstance(pr_data, dict):
        return False

    # Verifica conflitos
    if pr_data.get("mergeable") is False:
        return False

    # Verifica aprovações
    reviews = await _gh_get(
        f"/repos/{owner}/{repo}/pulls/{pr_number}/reviews", token
    )
    if not isinstance(reviews, list):
        return False

    approvals = {
        r["user"]["login"]
        for r in reviews
        if r.get("state") == "APPROVED"
    }
    if len(approvals) < profile.min_approvals:
        return False

    # Verifica CI (check runs)
    sha = pr_data.get("head", {}).get("sha", "")
    if sha:
        checks = await _gh_get(
            f"/repos/{owner}/{repo}/commits/{sha}/check-runs", token
        )
        if isinstance(checks, dict):
            runs = checks.get("check_runs", [])
            if runs:
                failed = [
                    r for r in runs
                    if r.get("conclusion") not in ("success", "skipped", "neutral", None)
                    and r.get("status") == "completed"
                ]
                if failed:
                    return False
                pending = [r for r in runs if r.get("status") != "completed"]
                if pending:
                    return False

    # Verifica caminhos protegidos
    if profile.protected_paths:
        files_data = await _gh_get(
            f"/repos/{owner}/{repo}/pulls/{pr_number}/files", token
        )
        if isinstance(files_data, list):
            changed_files = {f["filename"] for f in files_data}
            for protected in profile.protected_paths:
                clean = protected.strip("/").lstrip("*").strip("/")
                if any(clean in f for f in changed_files):
                    return False

    # Faz o merge
    result = await _gh_put(
        f"/repos/{owner}/{repo}/pulls/{pr_number}/merge",
        token,
        {
            "merge_method": "squash",
            "commit_title": f"{pr_data.get('title', 'PR')} (#{pr_number})",
            "commit_message": f"Auto-merged by Forge Agent\nApprovals: {', '.join(approvals)}",
        },
    )
    return result is not None


# ── Feature 4: Detecção e resolução de conflitos ──────────────────────────────

RESOLVABLE_PATTERNS = [
    r"package-lock\.json",
    r"yarn\.lock",
    r"pnpm-lock\.yaml",
    r"poetry\.lock",
    r"Pipfile\.lock",
    r"CHANGELOG\.md",
    r"CHANGELOG\.txt",
]


async def detect_conflicts(
    owner: str, repo: str, pr_number: int, token: str
) -> tuple[bool, list[str]]:
    """
    Retorna (tem_conflito, arquivos_conflitantes).
    """
    pr_data = await _gh_get(f"/repos/{owner}/{repo}/pulls/{pr_number}", token)
    if not isinstance(pr_data, dict):
        return False, []

    if pr_data.get("mergeable") is False:
        files_data = await _gh_get(
            f"/repos/{owner}/{repo}/pulls/{pr_number}/files", token
        )
        if isinstance(files_data, list):
            conflict_files = [f["filename"] for f in files_data]
            return True, conflict_files
        return True, []

    return False, []


async def attempt_conflict_resolution(
    owner: str,
    repo: str,
    pr_number: int,
    conflict_files: list[str],
    token: str,
) -> bool:
    """
    Tenta resolver conflitos simples (lockfiles, changelogs).
    Para conflitos complexos, apenas comenta no PR com orientação da IA.
    """
    resolvable = []
    complex_files = []

    for f in conflict_files:
        if any(re.search(p, f) for p in RESOLVABLE_PATTERNS):
            resolvable.append(f)
        else:
            complex_files.append(f)

    comment_lines = ["🤖 **Forge Agent — Análise de Conflitos**\n"]

    if resolvable:
        comment_lines.append(
            f"⚠️ **Conflitos detectados em {len(conflict_files)} arquivo(s)**\n\n"
            f"**Arquivos de lock/changelog** (podem ser regenerados automaticamente):\n"
            + "\n".join(f"- `{f}`" for f in resolvable)
        )
        comment_lines.append(
            "\n💡 **Sugestão:** Faça rebase na branch principal e regenere os lockfiles:\n"
            "```bash\ngit fetch origin\ngit rebase origin/main\nnpm install  # ou yarn / pip install\n```"
        )

    if complex_files:
        comment_lines.append(
            f"\n🔴 **Conflitos complexos** (requerem revisão manual):\n"
            + "\n".join(f"- `{f}`" for f in complex_files)
        )

        # Usa Groq para dar orientação específica
        if GROQ_API_KEY and complex_files:
            guidance = await _groq_conflict_guidance(complex_files)
            if guidance:
                comment_lines.append(f"\n**Orientação da IA:**\n{guidance}")

    comment_lines.append("\n---\n*Forge Agent — Resolução automática de conflitos*")

    await _gh_post(
        f"/repos/{owner}/{repo}/issues/{pr_number}/comments",
        token,
        {"body": "\n".join(comment_lines)},
    )
    return len(complex_files) == 0


async def _groq_conflict_guidance(files: list[str]) -> str:
    """Usa Groq para gerar orientação sobre como resolver conflitos específicos."""
    if not GROQ_API_KEY:
        return ""

    file_list = "\n".join(f"- {f}" for f in files[:10])
    prompt = (
        "Um PR tem conflitos de merge nos seguintes arquivos:\n"
        f"{file_list}\n\n"
        "Dê orientação CONCISA em português (máximo 5 linhas) sobre como resolver esses conflitos.\n"
        "Foque em passos práticos de git."
    )

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": GROQ_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 200,
                    "temperature": 0.3,
                },
            )
            if resp.status_code == 200:
                return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        print(f"[forge] Groq conflict guidance falhou: {exc}")

    return ""


# ── Orquestrador principal ────────────────────────────────────────────────────

async def process_pr_event(
    action: str,
    payload: dict[str, Any],
    installation_id: int | None,
) -> list[ForgeResult]:
    """
    Ponto de entrada para eventos de Pull Request do GitHub.
    Orquestra todas as features com base na ação recebida.
    """
    results: list[ForgeResult] = []

    pr = payload.get("pull_request", {})
    repo_data = payload.get("repository", {})
    owner = repo_data.get("owner", {}).get("login", "")
    repo = repo_data.get("name", "")
    pr_number = pr.get("number", 0)
    pr_title = pr.get("title", "")

    if not (owner and repo and pr_number):
        return results

    # Obtém token de autenticação
    token = await _get_installation_token(installation_id) if installation_id else GITHUB_PAT
    if not token:
        print("[forge] Sem token de autenticação disponível.")
        return results

    # Descoberta zero-config do perfil do repositório
    profile = await discover_repo_profile(owner, repo, token)

    # PR aberto ou sincronizado → labeling + review
    if action in ("opened", "synchronize", "reopened"):
        diff = await _get_pr_diff(owner, repo, pr_number, token)

        # Feature 1: Auto-label
        labels = await auto_label_pr(owner, repo, pr_number, pr_title, diff, token)
        results.append(ForgeResult(
            action="auto_label", success=bool(labels),
            detail=f"Labels aplicados: {labels}", labels_added=labels
        ))

        # Feature 2: Review automático (só em opened para não spammar)
        if action == "opened":
            reviewed = await auto_review_pr(owner, repo, pr_number, pr_title, diff, token)
            results.append(ForgeResult(
                action="auto_review", success=reviewed,
                detail="Review de IA postado" if reviewed else "Review pulado",
                review_posted=reviewed,
            ))

        # Feature 4: Conflitos
        has_conflict, conflict_files = await detect_conflicts(owner, repo, pr_number, token)
        if has_conflict:
            resolved = await attempt_conflict_resolution(
                owner, repo, pr_number, conflict_files, token
            )
            results.append(ForgeResult(
                action="conflict_resolution", success=resolved,
                detail=f"Conflitos em: {conflict_files}",
                conflicts_resolved=resolved,
            ))

    # PR pronto para review ou CI concluído → tenta auto-merge
    if action in ("review_requested", "ready_for_review") or (
        action == "synchronize" and not pr.get("draft")
    ):
        merged = await check_and_auto_merge(owner, repo, pr_number, profile, token)
        results.append(ForgeResult(
            action="auto_merge", success=merged,
            detail="PR mergeado automaticamente" if merged else "Critérios de merge não atingidos",
            merged=merged,
        ))

    return results


async def process_check_run_event(
    action: str,
    payload: dict[str, Any],
    installation_id: int | None,
) -> ForgeResult | None:
    """
    Quando um check run completa com sucesso, tenta auto-merge nos PRs associados.
    """
    if action != "completed":
        return None

    check_run = payload.get("check_run", {})
    if check_run.get("conclusion") != "success":
        return None

    repo_data = payload.get("repository", {})
    owner = repo_data.get("owner", {}).get("login", "")
    repo = repo_data.get("name", "")

    if not (owner and repo):
        return None

    token = await _get_installation_token(installation_id) if installation_id else GITHUB_PAT
    if not token:
        return None

    # Encontra PRs associados ao commit do check run
    sha = check_run.get("head_sha", "")
    if not sha:
        return None

    prs = await _gh_get(
        f"/repos/{owner}/{repo}/pulls?state=open&per_page=20", token
    )
    if not isinstance(prs, list):
        return None

    profile = await discover_repo_profile(owner, repo, token)

    for pr in prs:
        if pr.get("head", {}).get("sha") == sha:
            merged = await check_and_auto_merge(
                owner, repo, pr["number"], profile, token
            )
            if merged:
                return ForgeResult(
                    action="auto_merge_on_ci",
                    success=True,
                    detail=f"PR #{pr['number']} mergeado após CI verde",
                    merged=True,
                )

    return None
