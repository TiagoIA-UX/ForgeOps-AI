from __future__ import annotations

import asyncio
import os
import shutil
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from typing import Any, Awaitable, Callable, Literal

import httpx

SUPABASE_URL: str = os.getenv("SUPABASE_URL", os.getenv("NEXT_PUBLIC_SUPABASE_URL", ""))
SUPABASE_SERVICE_ROLE_KEY: str = os.getenv(
    "SUPABASE_SERVICE_ROLE_KEY",
    os.getenv("SUPABASE_SECRET_KEY", ""),
)

ROOT_DIR = Path(__file__).resolve().parent.parent

AUTO_HOUSEKEEPING_ENABLED = os.getenv("AUTO_HOUSEKEEPING_ENABLED", "true").lower() in {
    "1",
    "true",
    "yes",
    "on",
}
AUTO_HOUSEKEEPING_INTERVAL_SECONDS = int(os.getenv("AUTO_HOUSEKEEPING_INTERVAL_SECONDS", "21600"))


@dataclass(frozen=True)
class CleanupTarget:
    label: str
    relative_path: str
    strategy: Literal["remove_path", "remove_old_children"]
    max_age_days: int | None = None


SAFE_CLEANUP_TARGETS: tuple[CleanupTarget, ...] = (
    CleanupTarget("Cache Next.js", ".next/cache", "remove_path"),
    CleanupTarget("Cache Python", "backend/__pycache__", "remove_path"),
    CleanupTarget("Cache Pytest backend", "backend/.pytest_cache", "remove_path"),
    CleanupTarget("Cache Pytest raiz", ".pytest_cache", "remove_path"),
    CleanupTarget("Relatórios Playwright antigos", "playwright-report", "remove_old_children", 2),
    CleanupTarget("Resultados de teste antigos", "test-results", "remove_old_children", 2),
    CleanupTarget(
        "Relatórios antigos do pipeline de imagens",
        "private/image-pipeline-reports",
        "remove_old_children",
        7,
    ),
)


def _sb_headers() -> dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "count=exact",
    }


def _sb_write_headers(prefer: str = "return=minimal") -> dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def format_bytes(size: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(size)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{int(value)}{unit}"
            return f"{value:.1f}{unit}"
        value /= 1024
    return f"{size}B"


def _resolve_path(relative_path: str) -> Path:
    return ROOT_DIR / relative_path


def _path_size(path: Path) -> int:
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size

    total = 0
    for child in path.rglob("*"):
        if child.is_file():
            try:
                total += child.stat().st_size
            except OSError:
                continue
    return total


def _safe_unlink(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
    else:
        path.unlink(missing_ok=True)


def _target_candidates(target: CleanupTarget) -> list[Path]:
    path = _resolve_path(target.relative_path)
    if not path.exists():
        return []

    if target.strategy == "remove_path":
        return [path]

    max_age_days = target.max_age_days or 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    candidates: list[Path] = []
    for child in path.iterdir():
        try:
            modified = datetime.fromtimestamp(child.stat().st_mtime, tz=timezone.utc)
        except OSError:
            continue
        if modified < cutoff:
            candidates.append(child)
    return candidates


def _summarize_cleanup(dry_run: bool) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    total_bytes = 0
    total_entries = 0

    for target in SAFE_CLEANUP_TARGETS:
        candidates = _target_candidates(target)
        if not candidates:
            continue

        bytes_size = sum(_path_size(candidate) for candidate in candidates)
        entry_count = len(candidates)
        total_bytes += bytes_size
        total_entries += entry_count

        if not dry_run:
            for candidate in candidates:
                _safe_unlink(candidate)

        items.append(
            {
                "label": target.label,
                "path": target.relative_path,
                "entries": entry_count,
                "bytes": bytes_size,
                "strategy": target.strategy,
                "max_age_days": target.max_age_days,
            }
        )

    return {
        "dry_run": dry_run,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "enabled": AUTO_HOUSEKEEPING_ENABLED,
        "total_entries": total_entries,
        "total_bytes": total_bytes,
        "total_human": format_bytes(total_bytes),
        "items": items,
    }


def audit_housekeeping() -> dict[str, Any]:
    return _summarize_cleanup(dry_run=True)


def execute_housekeeping() -> dict[str, Any]:
    return _summarize_cleanup(dry_run=False)


async def _query_rows(
    client: httpx.AsyncClient,
    table: str,
    params: dict[str, str],
) -> list[dict[str, Any]]:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return []

    resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        params=params,
        headers=_sb_headers(),
        timeout=15,
    )
    if resp.status_code != 200:
        return []

    data = resp.json()
    return data if isinstance(data, list) else []


async def _count_rows(
    client: httpx.AsyncClient,
    table: str,
    params: dict[str, str],
) -> int:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return 0

    resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        params={**params, "select": "id", "limit": "1"},
        headers=_sb_headers(),
        timeout=15,
    )
    if resp.status_code != 200:
        return 0

    content_range = resp.headers.get("content-range", "")
    if "/" not in content_range:
        data = resp.json()
        return len(data) if isinstance(data, list) else 0

    try:
        return int(content_range.rsplit("/", 1)[1])
    except ValueError:
        data = resp.json()
        return len(data) if isinstance(data, list) else 0


async def fetch_recent_agent_failures(limit: int = 5) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=15) as client:
        since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        return await _query_rows(
            client,
            "agent_tasks",
            {
                "select": "agent_name,task_type,error_message,created_at,priority",
                "status": "eq.failed",
                "created_at": f"gte.{since}",
                "order": "created_at.desc",
                "limit": str(limit),
            },
        )


async def fetch_pending_alerts(limit: int = 5) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=15) as client:
        return await _query_rows(
            client,
            "system_alerts",
            {
                "select": "severity,title,body,created_at",
                "read": "eq.false",
                "order": "created_at.asc",
                "limit": str(limit),
            },
        )


async def fetch_learning_summary(limit: int = 5) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=15) as client:
        return await _query_rows(
            client,
            "agent_knowledge",
            {
                "select": "pattern,confidence,occurrences,outcome,last_seen_at",
                "order": "confidence.desc,last_seen_at.desc",
                "limit": str(limit),
            },
        )


async def fetch_negocios_summary() -> dict[str, Any]:
    """Counts de tenants e subscriptions por status."""
    async with httpx.AsyncClient(timeout=15) as client:
        total, ativos, trial, cancelados, inadimplentes = await asyncio.gather(
            _count_rows(client, "tenants", {"ativo": "eq.true"}),
            _count_rows(client, "subscriptions", {"status": "eq.active"}),
            _count_rows(client, "subscriptions", {"status": "eq.trial"}),
            _count_rows(client, "subscriptions", {"status": "eq.canceled"}),
            _count_rows(client, "subscriptions", {"status": "in.(expired,past_due)"}),
        )
    return {
        "deliverys_ativos": total,
        "assinaturas_ativas": ativos,
        "em_trial": trial,
        "canceladas": cancelados,
        "inadimplentes_vencidas": inadimplentes,
    }


async def fetch_receita_summary(days: int = 7) -> dict[str, Any]:
    """Faturamento dos últimos N dias a partir da tabela orders."""
    async with httpx.AsyncClient(timeout=15) as client:
        since_period = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()

        rows_period, rows_today = await asyncio.gather(
            _query_rows(
                client,
                "orders",
                {
                    "select": "total",
                    "status": "neq.cancelado",
                    "created_at": f"gte.{since_period}",
                },
            ),
            _query_rows(
                client,
                "orders",
                {
                    "select": "total",
                    "status": "neq.cancelado",
                    "created_at": f"gte.{today_start}",
                },
            ),
        )

    faturamento_periodo = sum(float(r.get("total") or 0) for r in rows_period)
    faturamento_hoje = sum(float(r.get("total") or 0) for r in rows_today)
    ticket_medio = faturamento_periodo / len(rows_period) if rows_period else 0.0

    return {
        "hoje_total": faturamento_hoje,
        "hoje_pedidos": len(rows_today),
        "periodo_dias": days,
        "periodo_total": faturamento_periodo,
        "periodo_pedidos": len(rows_period),
        "ticket_medio": ticket_medio,
    }


async def fetch_ipca_context(months: int = 12) -> dict[str, Any]:
    """Contexto inflacionário real a partir da série 433 do Banco Central (IPCA mensal)."""
    url = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, timeout=15)
            resp.raise_for_status()
            rows = resp.json()
    except Exception as exc:
        return {
            "source": "BCB SGS 433",
            "error": str(exc)[:200],
        }

    if not isinstance(rows, list) or not rows:
        return {
            "source": "BCB SGS 433",
            "error": "sem dados",
        }

    parsed: list[tuple[str, float]] = []
    for row in rows:
        try:
            parsed.append((str(row.get("data") or ""), float(str(row.get("valor") or "0").replace(",", "."))))
        except Exception:
            continue

    if not parsed:
        return {
            "source": "BCB SGS 433",
            "error": "sem dados válidos",
        }

    recent = parsed[-months:]
    fator = 1.0
    for _, valor in recent:
        fator *= 1 + (valor / 100)

    last_date, last_value = parsed[-1]
    return {
        "source": "BCB SGS 433",
        "reference_date": last_date,
        "last_month_pct": round(last_value, 2),
        "last_12m_pct": round((fator - 1) * 100, 2),
        "months_used": len(recent),
    }


async def fetch_plan_consistency_summary(days: int = 90) -> dict[str, Any]:
    """Avalia planos e mensalidades com base em dados internos observados, sem hipóteses comerciais."""
    async with httpx.AsyncClient(timeout=20) as client:
        since_period = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        plans_rows, restaurants_rows, orders_rows, products_rows = await asyncio.gather(
            _query_rows(
                client,
                "plans",
                {
                    "select": "slug,nome,preco_mensal,preco_anual,limites",
                    "order": "slug.asc",
                },
            ),
            _query_rows(
                client,
                "restaurants",
                {
                    "select": "id,plan_slug,created_at",
                },
            ),
            _query_rows(
                client,
                "orders",
                {
                    "select": "restaurant_id,total,status,created_at",
                    "created_at": f"gte.{since_period}",
                },
            ),
            _query_rows(
                client,
                "products",
                {
                    "select": "restaurant_id,ativo",
                },
            ),
        )

    plan_map: dict[str, dict[str, Any]] = {}
    for row in plans_rows:
        slug = str(row.get("slug") or "").strip()
        if not slug:
            continue
        plan_map[slug] = row

    restaurant_plan: dict[str, str] = {}
    for row in restaurants_rows:
        rid = str(row.get("id") or "").strip()
        if not rid:
            continue
        restaurant_plan[rid] = str(row.get("plan_slug") or "unknown").strip() or "unknown"

    cancelled_statuses = {"cancelled", "canceled", "cancelado", "rejected", "rejeitado"}
    order_stats: dict[str, dict[str, float]] = {}
    for row in orders_rows:
        restaurant_id = str(row.get("restaurant_id") or "").strip()
        if not restaurant_id:
            continue
        status = str(row.get("status") or "").strip().lower()
        if status in cancelled_statuses:
            continue
        bucket = order_stats.setdefault(restaurant_id, {"orders": 0.0, "gmv": 0.0})
        bucket["orders"] += 1
        bucket["gmv"] += float(row.get("total") or 0)

    product_stats: dict[str, int] = {}
    for row in products_rows:
        restaurant_id = str(row.get("restaurant_id") or "").strip()
        if not restaurant_id:
            continue
        ativo = row.get("ativo")
        if ativo is False:
            continue
        product_stats[restaurant_id] = product_stats.get(restaurant_id, 0) + 1

    grouped: dict[str, dict[str, Any]] = {}
    for restaurant_id, plan_slug in restaurant_plan.items():
        bucket = grouped.setdefault(
            plan_slug,
            {
                "restaurants": 0,
                "restaurants_with_orders": 0,
                "orders_30d_samples": [],
                "gmv_30d_samples": [],
                "ticket_samples": [],
                "active_products_samples": [],
            },
        )
        bucket["restaurants"] += 1

        observed_orders = order_stats.get(restaurant_id, {}).get("orders", 0.0)
        observed_gmv = order_stats.get(restaurant_id, {}).get("gmv", 0.0)
        orders_30d = observed_orders * (30 / days)
        gmv_30d = observed_gmv * (30 / days)
        products_count = product_stats.get(restaurant_id, 0)

        bucket["active_products_samples"].append(products_count)
        if observed_orders > 0:
            bucket["restaurants_with_orders"] += 1
            bucket["orders_30d_samples"].append(orders_30d)
            bucket["gmv_30d_samples"].append(gmv_30d)
            bucket["ticket_samples"].append(observed_gmv / observed_orders)

    summarized_plans: dict[str, Any] = {}
    alerts: list[dict[str, Any]] = []
    data_gaps: list[str] = []

    if not plan_map:
        data_gaps.append("Tabela plans sem retorno via API.")
    if not restaurant_plan:
        data_gaps.append("Tabela restaurants sem dados suficientes para análise por plano.")
    if not orders_rows:
        data_gaps.append(f"Sem pedidos observados nos últimos {days} dias.")

    for plan_slug, data in grouped.items():
        plan_row = plan_map.get(plan_slug, {})
        raw_limits = plan_row.get("limites")
        limites = raw_limits if isinstance(raw_limits, dict) else {}
        orders_samples = data["orders_30d_samples"]
        gmv_samples = data["gmv_30d_samples"]
        ticket_samples = data["ticket_samples"]
        product_samples = data["active_products_samples"]

        avg_orders_30d = sum(orders_samples) / len(orders_samples) if orders_samples else 0.0
        avg_gmv_30d = sum(gmv_samples) / len(gmv_samples) if gmv_samples else 0.0
        avg_ticket = sum(ticket_samples) / len(ticket_samples) if ticket_samples else 0.0
        avg_products = sum(product_samples) / len(product_samples) if product_samples else 0.0
        median_orders_30d = median(orders_samples) if orders_samples else 0.0
        price_monthly = float(plan_row.get("preco_mensal") or 0)
        revenue_share_pct = (price_monthly / avg_gmv_30d * 100) if price_monthly > 0 and avg_gmv_30d > 0 else None

        summarized_plans[plan_slug] = {
            "plan_name": plan_row.get("nome") or plan_slug,
            "restaurants": data["restaurants"],
            "restaurants_with_orders": data["restaurants_with_orders"],
            "avg_orders_30d": round(avg_orders_30d, 1),
            "median_orders_30d": round(float(median_orders_30d), 1),
            "avg_gmv_30d": round(avg_gmv_30d, 2),
            "avg_ticket": round(avg_ticket, 2),
            "avg_active_products": round(avg_products, 1),
            "monthly_price": round(price_monthly, 2),
            "price_over_gmv_pct": round(revenue_share_pct, 2) if revenue_share_pct is not None else None,
            "product_limit": limites.get("maxProducts"),
            "order_limit": limites.get("maxOrdersPerMonth"),
            "evidence_level": "low" if data["restaurants"] < 3 else "moderate",
        }

        product_limit = limites.get("maxProducts")
        order_limit = limites.get("maxOrdersPerMonth")
        if isinstance(product_limit, (int, float)) and product_limit > 0 and avg_products >= product_limit * 0.85:
            alerts.append(
                {
                    "type": "product_limit_pressure",
                    "plan_slug": plan_slug,
                    "message": f"Uso médio de produtos do plano {plan_slug} encostou em {round(avg_products, 1)} de {product_limit}.",
                }
            )
        if isinstance(order_limit, (int, float)) and order_limit > 0 and avg_orders_30d >= order_limit * 0.85:
            alerts.append(
                {
                    "type": "order_limit_pressure",
                    "plan_slug": plan_slug,
                    "message": f"Volume médio do plano {plan_slug} encostou em {round(avg_orders_30d, 1)} de {order_limit} pedidos/mês.",
                }
            )

    semente = summarized_plans.get("semente")
    basico = summarized_plans.get("basico")
    if semente and basico and semente["restaurants_with_orders"] > 0 and basico["restaurants_with_orders"] > 0:
        overlap_orders = semente["avg_orders_30d"] >= basico["avg_orders_30d"] * 0.7 if basico["avg_orders_30d"] else False
        overlap_products = semente["avg_active_products"] >= basico["avg_active_products"] * 0.8 if basico["avg_active_products"] else False
        if overlap_orders or overlap_products:
            alerts.append(
                {
                    "type": "plan_overlap",
                    "plan_slug": "semente",
                    "message": "Dados observados mostram sobreposição operacional relevante entre semente e básico.",
                }
            )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "period_days": days,
        "plans": summarized_plans,
        "alerts": alerts,
        "data_gaps": data_gaps,
        "source": "Supabase REST + observação real de uso",
    }


async def fetch_affiliate_program_summary(days: int = 45) -> dict[str, Any]:
    """Resumo operacional do programa de afiliados para observabilidade do ForgeOps."""
    now = datetime.now(timezone.utc)
    approval_cutoff = now - timedelta(days=30)
    payout_backlog_cutoff = now - timedelta(days=16)
    since_period = (now - timedelta(days=days)).isoformat()

    async with httpx.AsyncClient(timeout=20) as client:
        affiliates_rows, referrals_rows, bonuses_rows, payout_batches = await asyncio.gather(
            _query_rows(
                client,
                "affiliates",
                {
                    "select": "id,status,code,chave_pix,created_at,last_response_at",
                    "order": "created_at.desc",
                },
            ),
            _query_rows(
                client,
                "affiliate_referrals",
                {
                    "select": "id,affiliate_id,status,comissao,created_at,approved_at,lider_id,lider_status,lider_comissao,lider_approved_at",
                    "created_at": f"gte.{since_period}",
                    "order": "created_at.desc",
                },
            ),
            _query_rows(
                client,
                "affiliate_bonuses",
                {
                    "select": "id,affiliate_id,status,valor_bonus,created_at",
                    "created_at": f"gte.{since_period}",
                    "order": "created_at.desc",
                },
            ),
            _query_rows(
                client,
                "payout_batches",
                {
                    "select": "id,referencia,status,total_amount,items_count,created_at",
                    "order": "created_at.desc",
                    "limit": "6",
                },
            ),
        )

    status_counts = {
        "ativo": 0,
        "inativo": 0,
        "suspenso": 0,
        "outros": 0,
    }
    active_without_pix = 0
    active_without_code = 0

    for row in affiliates_rows:
        status = str(row.get("status") or "").strip().lower()
        if status in status_counts:
            status_counts[status] += 1
        else:
            status_counts["outros"] += 1

        is_active = status == "ativo"
        if is_active and not str(row.get("chave_pix") or "").strip():
            active_without_pix += 1
        if is_active and not str(row.get("code") or "").strip():
            active_without_code += 1

    direct_counts = {"pendente": 0, "aprovado": 0, "pago": 0, "outros": 0}
    leader_counts = {"pendente": 0, "aprovado": 0, "pago": 0, "outros": 0}
    direct_amounts = {"pendente": 0.0, "aprovado": 0.0, "pago": 0.0}
    leader_amounts = {"pendente": 0.0, "aprovado": 0.0, "pago": 0.0}
    overdue_pending_approval = 0
    overdue_approved_payout = 0

    def _safe_parse_date(value: Any) -> datetime | None:
        if not value:
            return None
        try:
            raw = str(value)
            if raw.endswith("Z"):
                raw = raw[:-1] + "+00:00"
            parsed = datetime.fromisoformat(raw)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except Exception:
            return None

    for row in referrals_rows:
        direct_status = str(row.get("status") or "").strip().lower()
        direct_amount = float(row.get("comissao") or 0)
        created_at = _safe_parse_date(row.get("created_at"))
        approved_at = _safe_parse_date(row.get("approved_at"))

        if direct_status in direct_counts:
            direct_counts[direct_status] += 1
            if direct_status in direct_amounts:
                direct_amounts[direct_status] += direct_amount
        else:
            direct_counts["outros"] += 1

        if direct_status == "pendente" and created_at and created_at < approval_cutoff:
            overdue_pending_approval += 1
        if direct_status == "aprovado" and approved_at and approved_at < payout_backlog_cutoff:
            overdue_approved_payout += 1

        leader_status = str(row.get("lider_status") or "").strip().lower()
        leader_amount = float(row.get("lider_comissao") or 0)
        leader_approved_at = _safe_parse_date(row.get("lider_approved_at"))

        if leader_status:
            if leader_status in leader_counts:
                leader_counts[leader_status] += 1
                if leader_status in leader_amounts:
                    leader_amounts[leader_status] += leader_amount
            else:
                leader_counts["outros"] += 1

            if leader_status == "aprovado" and leader_approved_at and leader_approved_at < payout_backlog_cutoff:
                overdue_approved_payout += 1

    bonus_counts = {"pendente": 0, "pago": 0, "outros": 0}
    bonus_amounts = {"pendente": 0.0, "pago": 0.0}
    overdue_pending_bonus = 0

    for row in bonuses_rows:
        status = str(row.get("status") or "").strip().lower()
        amount = float(row.get("valor_bonus") or 0)
        created_at = _safe_parse_date(row.get("created_at"))

        if status in bonus_counts:
            bonus_counts[status] += 1
            if status in bonus_amounts:
                bonus_amounts[status] += amount
        else:
            bonus_counts["outros"] += 1

        if status == "pendente" and created_at and created_at < payout_backlog_cutoff:
            overdue_pending_bonus += 1

    active_affiliates = status_counts["ativo"]
    total_direct_referrals = sum(v for k, v in direct_counts.items() if k != "outros")
    approval_rate = (
        (direct_counts["aprovado"] + direct_counts["pago"]) / total_direct_referrals * 100
        if total_direct_referrals > 0
        else None
    )

    alerts: list[dict[str, Any]] = []
    data_gaps: list[str] = []
    if not affiliates_rows:
        data_gaps.append("Tabela affiliates sem dados para observação operacional.")
    if not referrals_rows:
        data_gaps.append(f"Sem indicações observadas nos últimos {days} dias.")

    if active_affiliates > 0 and active_without_pix > 0:
        alerts.append(
            {
                "type": "affiliate_pix_missing",
                "message": f"{active_without_pix} afiliado(s) ativo(s) estão sem chave PIX para recebimento.",
            }
        )
    if active_affiliates > 0 and active_without_code > 0:
        alerts.append(
            {
                "type": "affiliate_code_missing",
                "message": f"{active_without_code} afiliado(s) ativo(s) estão sem código de indicação válido.",
            }
        )
    if overdue_pending_approval > 0:
        alerts.append(
            {
                "type": "affiliate_approval_backlog",
                "message": f"{overdue_pending_approval} indicação(ões) ainda pendentes além da janela de 30 dias.",
            }
        )
    if overdue_approved_payout > 0 or overdue_pending_bonus > 0:
        alerts.append(
            {
                "type": "affiliate_payout_backlog",
                "message": (
                    f"Backlog de pagamento detectado: {overdue_approved_payout} comissão(ões) aprovadas "
                    f"e {overdue_pending_bonus} bônus pendente(s) além da janela operacional."
                ),
            }
        )

    last_batch = payout_batches[0] if payout_batches else None

    return {
        "generated_at": now.isoformat(),
        "period_days": days,
        "source": "Supabase REST + observação operacional de afiliados",
        "status_counts": status_counts,
        "active_without_pix": active_without_pix,
        "active_without_code": active_without_code,
        "direct_referrals": {
            "counts": direct_counts,
            "amounts": {k: round(v, 2) for k, v in direct_amounts.items()},
            "approval_rate_pct": round(approval_rate, 1) if approval_rate is not None else None,
            "overdue_pending_approval": overdue_pending_approval,
            "overdue_approved_payout": overdue_approved_payout,
        },
        "leader_referrals": {
            "counts": leader_counts,
            "amounts": {k: round(v, 2) for k, v in leader_amounts.items()},
        },
        "bonuses": {
            "counts": bonus_counts,
            "amounts": {k: round(v, 2) for k, v in bonus_amounts.items()},
            "overdue_pending": overdue_pending_bonus,
        },
        "last_batch": {
            "referencia": last_batch.get("referencia") if last_batch else None,
            "status": last_batch.get("status") if last_batch else None,
            "total_amount": round(float(last_batch.get("total_amount") or 0), 2) if last_batch else 0.0,
            "items_count": int(last_batch.get("items_count") or 0) if last_batch else 0,
            "created_at": last_batch.get("created_at") if last_batch else None,
        },
        "alerts": alerts,
        "data_gaps": data_gaps,
        "program_state": "partial_public_experience",
    }


async def fetch_briefings_summary() -> dict[str, Any]:
    """Contagem de onboarding_submissions por status."""
    async with httpx.AsyncClient(timeout=15) as client:
        pendentes, em_producao, concluidos = await asyncio.gather(
            _count_rows(client, "onboarding_submissions", {"status": "eq.pending"}),
            _count_rows(client, "onboarding_submissions", {"status": "eq.in_production"}),
            _count_rows(client, "onboarding_submissions", {"status": "eq.completed"}),
        )
    return {
        "pendentes": pendentes,
        "em_producao": em_producao,
        "concluidos": concluidos,
    }


async def fetch_pagamentos_summary() -> dict[str, Any]:
    """Resumo de cobranças PIX recentes."""
    async with httpx.AsyncClient(timeout=15) as client:
        since_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

        pendentes, pagas_24h, falhas_24h, recentes = await asyncio.gather(
            _count_rows(client, "cobrancas_pix", {"status": "eq.pendente"}),
            _count_rows(client, "cobrancas_pix", {"status": "eq.paga", "confirmada_em": f"gte.{since_24h}"}),
            _count_rows(client, "cobrancas_pix", {"status": "in.(cancelada,expirada)", "created_at": f"gte.{since_24h}"}),
            _query_rows(
                client,
                "cobrancas_pix",
                {
                    "select": "valor,status,created_at",
                    "order": "created_at.desc",
                    "limit": "5",
                },
            ),
        )

    return {
        "pendentes": pendentes,
        "pagas_24h": pagas_24h,
        "falhas_24h": falhas_24h,
        "recentes": recentes,
    }


async def fetch_forgeops_summary() -> dict[str, Any]:
    """Saúde e métricas do agente ForgeOps AI (GitHub App)."""
    MERGEFORGE_URL = os.getenv("FORGEOPS_URL", os.getenv("MERGEFORGE_URL", "https://mergeforge-backend.onrender.com"))

    # Checa se o backend está vivo
    status = "offline"
    try:
        async with httpx.AsyncClient(timeout=8) as health_client:
            resp = await health_client.get(f"{MERGEFORGE_URL}/", timeout=8)
            if resp.status_code < 500:
                status = "online"
    except Exception:
        status = "offline"

    # Métricas de tarefas do forge_agent nas últimas 24h
    async with httpx.AsyncClient(timeout=15) as client:
        since_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

        prs_ok, prs_fail, recent_tasks = await asyncio.gather(
            _count_rows(
                client,
                "agent_tasks",
                {
                    "agent_name": "eq.forge_agent",
                    "status": "eq.completed",
                    "created_at": f"gte.{since_24h}",
                },
            ),
            _count_rows(
                client,
                "agent_tasks",
                {
                    "agent_name": "eq.forge_agent",
                    "status": "eq.failed",
                    "created_at": f"gte.{since_24h}",
                },
            ),
            _query_rows(
                client,
                "agent_tasks",
                {
                    "select": "task_type,status,created_at",
                    "agent_name": "eq.forge_agent",
                    "order": "created_at.desc",
                    "limit": "5",
                },
            ),
        )

    return {
        "status": status,
        "backend_url": MERGEFORGE_URL,
        "prs_processados_24h": prs_ok,
        "prs_falhos_24h": prs_fail,
        "tarefas_recentes": recent_tasks,
    }


async def fetch_persisted_incidents(limit: int = 20) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=15) as client:
        return await _query_rows(
            client,
            "ops_incidents",
            {
                "select": (
                    "incident_key,category,severity,status,title,summary,first_seen,last_seen,"
                    "occurrences,suppressed_duplicates,notification_count,last_notification_at,resolved_at,metadata"
                ),
                "status": "eq.active",
                "order": "last_seen.desc",
                "limit": str(limit),
            },
        )


async def fetch_incident_state(incident_key: str) -> dict[str, Any] | None:
    if not incident_key:
        return None

    async with httpx.AsyncClient(timeout=15) as client:
        rows = await _query_rows(
            client,
            "ops_incidents",
            {
                "select": (
                    "incident_key,category,severity,status,title,summary,first_seen,last_seen,"
                    "occurrences,suppressed_duplicates,notification_count,last_notification_at,resolved_at,metadata"
                ),
                "incident_key": f"eq.{incident_key}",
                "limit": "1",
            },
        )
    return rows[0] if rows else None


async def dispatch_zaea_incident_task(
    agent_name: str,
    incident_key: str,
    payload: dict[str, Any],
    priority: str = "p1",
    triggered_by: str = "alert",
) -> str | None:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return None

    task_payload = {
        "agent_name": agent_name,
        "status": "pending",
        "priority": priority,
        "task_type": "incident_response",
        "input": {"incident_key": incident_key, **payload},
        "triggered_by": triggered_by,
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/agent_tasks",
            headers=_sb_write_headers("return=representation"),
            json=task_payload,
        )
        if resp.status_code not in (200, 201):
            return None

        rows = resp.json()
        if isinstance(rows, list) and rows:
            return rows[0].get("id")
        if isinstance(rows, dict):
            return rows.get("id")
        return None


async def close_zaea_incident_task(
    task_id: str,
    output: dict[str, Any],
    knowledge: dict[str, Any] | None = None,
    status: str = "completed",
) -> bool:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return False

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.patch(
            f"{SUPABASE_URL}/rest/v1/agent_tasks",
            params={"id": f"eq.{task_id}"},
            headers=_sb_write_headers(),
            json={
                "status": status,
                "output": output,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        if resp.status_code not in (200, 204):
            return False

        if not knowledge:
            return True

        knowledge_payload = {
            "pattern": knowledge.get("pattern"),
            "root_cause": knowledge.get("rootCause"),
            "solution": knowledge.get("solution"),
            "files_changed": knowledge.get("filesChanged") or [],
            "confidence": knowledge.get("confidence", 60),
            "outcome": knowledge.get("outcome", "success"),
            "last_task_id": task_id,
            "last_seen_at": datetime.now(timezone.utc).isoformat(),
        }

        existing = await client.get(
            f"{SUPABASE_URL}/rest/v1/agent_knowledge",
            params={"pattern": f"eq.{knowledge_payload['pattern']}", "select": "id,occurrences"},
            headers=_sb_headers(),
        )
        if existing.status_code != 200:
            return True

        rows = existing.json()
        if isinstance(rows, list) and rows:
            row = rows[0]
            await client.patch(
                f"{SUPABASE_URL}/rest/v1/agent_knowledge",
                params={"id": f"eq.{row['id']}"},
                headers=_sb_write_headers(),
                json={
                    **knowledge_payload,
                    "occurrences": int(row.get("occurrences") or 1) + 1,
                },
            )
            return True

        await client.post(
            f"{SUPABASE_URL}/rest/v1/agent_knowledge",
            headers=_sb_write_headers(),
            json={**knowledge_payload, "occurrences": 1},
        )
        return True


async def persist_incident_state(incident: dict[str, Any]) -> bool:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return False

    payload = {
        "incident_key": incident["incident_key"],
        "category": incident["category"],
        "severity": incident["severity"],
        "status": incident.get("status", "active"),
        "title": incident["title"],
        "summary": incident["summary"],
        "first_seen": incident["first_seen"],
        "last_seen": incident["last_seen"],
        "occurrences": incident["occurrences"],
        "suppressed_duplicates": incident.get("suppressed_duplicates", 0),
        "notification_count": incident.get("notification_count", 0),
        "last_notification_at": incident.get("last_notification_at"),
        "resolved_at": incident.get("resolved_at"),
        "metadata": incident.get("metadata", {}),
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/ops_incidents",
            params={"on_conflict": "incident_key"},
            headers=_sb_write_headers("resolution=merge-duplicates,return=minimal"),
            json=payload,
        )
        return resp.status_code in (200, 201)


async def resolve_incident_state(
    incident_key: str,
    resolved_at: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> bool:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return False

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.patch(
            f"{SUPABASE_URL}/rest/v1/ops_incidents",
            params={"incident_key": f"eq.{incident_key}"},
            headers=_sb_write_headers(),
            json={
                "status": "resolved",
                "resolved_at": resolved_at or datetime.now(timezone.utc).isoformat(),
                "metadata": metadata or {},
            },
        )
        return resp.status_code in (200, 204)


async def fetch_runtime_snapshot() -> dict[str, Any]:
    channels = {
        "supabase": bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY),
        "telegram": bool(os.getenv("TELEGRAM_BOT_TOKEN") and os.getenv("TELEGRAM_CHAT_ID")),
        "whatsapp_evolution": bool(os.getenv("EVOLUTION_API_URL") and os.getenv("EVOLUTION_API_KEY")),
        "groq": bool(os.getenv("GROQ_API_KEY")),
        "github_actions": True,
    }

    housekeeping = audit_housekeeping()

    async with httpx.AsyncClient(timeout=15) as client:
        since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        pending_alerts, failed_tasks, escalated_tasks, pending_p0_p1, knowledge_entries = await asyncio.gather(
            _count_rows(client, "system_alerts", {"read": "eq.false"}),
            _count_rows(client, "agent_tasks", {"status": "eq.failed", "created_at": f"gte.{since}"}),
            _count_rows(client, "agent_tasks", {"status": "eq.escalated", "created_at": f"gte.{since}"}),
            _count_rows(
                client,
                "agent_tasks",
                {"status": "eq.pending", "priority": "in.(p0,p1)", "created_at": f"gte.{since}"},
            ),
            _count_rows(client, "agent_knowledge", {}),
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "channels": channels,
        "counts": {
            "pending_alerts": pending_alerts,
            "failed_tasks_24h": failed_tasks,
            "escalated_tasks_24h": escalated_tasks,
            "pending_priority_tasks_24h": pending_p0_p1,
            "knowledge_entries": knowledge_entries,
        },
        "housekeeping": housekeeping,
        "auto_housekeeping": {
            "enabled": AUTO_HOUSEKEEPING_ENABLED,
            "interval_seconds": AUTO_HOUSEKEEPING_INTERVAL_SECONDS,
        },
    }


async def housekeeping_loop(
    notifier: Callable[[str, str, str], Awaitable[dict[str, bool]]] | None = None,
) -> None:
    if not AUTO_HOUSEKEEPING_ENABLED:
        print("[ops] Housekeeping automático desativado.")
        return

    print(
        f"[ops] Housekeeping automático iniciado — intervalo: {AUTO_HOUSEKEEPING_INTERVAL_SECONDS}s"
    )
    await asyncio.sleep(120)

    while True:
        try:
            result = execute_housekeeping()
            if result["total_bytes"] > 0:
                print(
                    f"[ops] Housekeeping removeu {result['total_entries']} item(ns) e liberou {result['total_human']}"
                )
                if notifier:
                    await notifier(
                        "Housekeeping automático executado",
                        (
                            f"Itens removidos: {result['total_entries']}\n"
                            f"Espaço liberado: {result['total_human']}\n"
                            "Origem: cache, relatórios e artefatos transitórios"
                        ),
                        "info",
                    )
        except asyncio.CancelledError:
            print("[ops] Housekeeping encerrado.")
            return
        except Exception as exc:
            print(f"[ops] Erro no housekeeping: {exc}")

        await asyncio.sleep(AUTO_HOUSEKEEPING_INTERVAL_SECONDS)