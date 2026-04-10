from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha1
from typing import Any


HEADER_RE = re.compile(
    r"^\[(?P<date>\d{2}/\d{2}/\d{4})\s+(?P<time>\d{2}:\d{2})\]\s+(?P<sender>.*?):\s*(?P<body>.*)$"
)


@dataclass
class ParsedMessage:
    raw: str
    sender: str
    body: str
    timestamp_label: str
    category: str
    severity: str
    signature: str
    probable_causes: list[str]


def _normalize_text(text: str) -> str:
    compact = re.sub(r"\s+", " ", text.strip())
    compact = re.sub(r"\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}(?::\d{2})?\s*UTC", "<timestamp>", compact)
    compact = re.sub(r"\b\d+ erro\(s\)\b", "<ts-errors>", compact, flags=re.IGNORECASE)
    compact = re.sub(r"\b\d+ críticos?\b", "<critical-count>", compact, flags=re.IGNORECASE)
    compact = re.sub(r"\b\d+ avisos?\b", "<warning-count>", compact, flags=re.IGNORECASE)
    compact = re.sub(r"\b\d+ alertas não lidos\b", "<unread-alerts>", compact, flags=re.IGNORECASE)
    compact = re.sub(r"rgphffvugmkeyyxiwjvv", "<project-id>", compact, flags=re.IGNORECASE)
    return compact.lower()


def _classify_message(body: str) -> tuple[str, str, list[str]]:
    lower = body.lower()
    probable_causes: list[str] = []

    if "verificação do sistema" in lower and "tudo funcionando" in lower:
        return "health_ok", "info", probable_causes

    if "análise do código" in lower:
        if "node_env" in lower:
            probable_causes.append("tipagem de ProcessEnv em testes")
        if "user_metadata" in lower or "property `email`" in lower or "propriedades 'email'" in lower:
            probable_causes.append("tipagem incorreta de usuário/sessão Supabase")
        if "horariofuncionamento" in lower:
            probable_causes.append("tipo HorarioFuncionamento fora de escopo")
        if "@/lib/supabase/server" in lower:
            probable_causes.append("import legado ou alias quebrado de Supabase server")
        return "code_analysis", "warning", probable_causes

    if "cron falhou" in lower:
        if "auto_suspend_overdue_restaurants" in lower:
            probable_causes.append("migration SQL não aplicada no Supabase")
        return "cron_failure", "critical", probable_causes

    if "platform monitor" in lower:
        if "alertas não lidos" in lower:
            probable_causes.append("backlog de alertas sem tratamento")
        if "rls sem policies" in lower:
            probable_causes.append("tabelas com RLS incompleto")
        if "policy permissiva" in lower:
            probable_causes.append("políticas admin excessivamente abertas")
        return "platform_monitor", "critical" if "🔴" in body else "warning", probable_causes

    if "critical" in lower or "🔴" in body:
        return "generic_critical", "critical", probable_causes

    return "generic", "warning", probable_causes


def parse_alert_transcript(transcript: str) -> list[ParsedMessage]:
    entries: list[ParsedMessage] = []
    current_lines: list[str] = []

    def flush() -> None:
        if not current_lines:
            return
        block = "\n".join(current_lines).strip()
        current_lines.clear()
        if not block:
            return

        first_line, *rest = block.splitlines()
        match = HEADER_RE.match(first_line)
        if not match:
            return

        sender = match.group("sender").strip()
        first_body = match.group("body").strip()
        body = "\n".join([first_body, *rest]).strip()
        category, severity, causes = _classify_message(body)
        signature = sha1(_normalize_text(body).encode("utf-8")).hexdigest()[:12]

        entries.append(
            ParsedMessage(
                raw=block,
                sender=sender,
                body=body,
                timestamp_label=f"{match.group('date')} {match.group('time')}",
                category=category,
                severity=severity,
                signature=signature,
                probable_causes=causes,
            )
        )

    for line in transcript.splitlines():
        if HEADER_RE.match(line):
            flush()
        current_lines.append(line)
    flush()
    return entries


def analyze_alert_transcript(transcript: str) -> dict[str, Any]:
    messages = parse_alert_transcript(transcript)

    signature_groups: dict[str, list[ParsedMessage]] = {}
    for message in messages:
        signature_groups.setdefault(message.signature, []).append(message)

    categories = Counter(message.category for message in messages)
    severities = Counter(message.severity for message in messages)
    probable_causes = Counter(cause for message in messages for cause in message.probable_causes)

    incidents: list[dict[str, Any]] = []
    duplicate_count = 0
    for signature, group in sorted(signature_groups.items(), key=lambda item: len(item[1]), reverse=True):
        duplicate_count += max(len(group) - 1, 0)
        first = group[0]
        incidents.append(
            {
                "signature": signature,
                "category": first.category,
                "severity": first.severity,
                "count": len(group),
                "first_seen": group[0].timestamp_label,
                "last_seen": group[-1].timestamp_label,
                "sender": first.sender,
                "summary": first.body.splitlines()[0][:180],
                "probable_causes": first.probable_causes,
            }
        )

    recommendations: list[str] = []
    if categories.get("code_analysis", 0) >= 3:
        recommendations.append(
            "Ativar supressão de alertas duplicados para falhas de TypeScript/build e abrir incidente único por assinatura."
        )
    if any("tipagem incorreta de usuário/sessão Supabase" == cause for cause, _ in probable_causes.items()):
        recommendations.append(
            "Corrigir tipagem de user/session Supabase, porque ela reaparece como causa dominante dos builds falhos."
        )
    if any("migration SQL não aplicada no Supabase" == cause for cause, _ in probable_causes.items()):
        recommendations.append(
            "Aplicar ou validar a migration da função auto_suspend_overdue_restaurants no ambiente real."
        )
    if categories.get("platform_monitor", 0) > 0:
        recommendations.append(
            "Tratar backlog de alertas e revisar policies permissivas/RLS incompleto antes que o monitor continue escalando ruído."
        )
    if duplicate_count >= 2:
        recommendations.append(
            "Habilitar deduplicação por assinatura e janela de tempo no robô para evitar tempestade de mensagens repetidas."
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "message_count": len(messages),
        "duplicate_count": duplicate_count,
        "categories": dict(categories),
        "severities": dict(severities),
        "top_probable_causes": [
            {"cause": cause, "count": count} for cause, count in probable_causes.most_common(10)
        ],
        "incidents": incidents,
        "recommendations": recommendations,
    }