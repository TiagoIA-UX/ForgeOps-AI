from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from hashlib import sha1
import re
from typing import Any


RESOLUTION_REASONS = {
    "manual_ack": "Reconhecido manualmente",
    "false_positive": "Falso positivo",
    "mitigated": "Mitigado operacionalmente",
    "deployed_fix": "Correção aplicada em deploy",
    "config_fix": "Configuração corrigida",
    "provider_recovered": "Provedor externo recuperado",
    "auto_expired": "Encerrado por expiração da janela",
}


@dataclass
class IncidentState:
    incident_key: str
    category: str
    severity: str
    title: str
    summary: str
    first_seen: str
    last_seen: str
    occurrences: int
    suppressed_duplicates: int
    notification_count: int
    last_notification_at: str | None = None
    zaea_task_id: str | None = None


def severity_rank(severity: str) -> int:
    return {"info": 1, "warning": 2, "critical": 3}.get(severity, 0)


def normalize_incident_text(text: str) -> str:
    normalized = " ".join(text.lower().split())
    replacements = [
        (r"\b\d{2}/\d{2}/\d{4}\b", "<date>"),
        (r"\b\d{2}:\d{2}(?::\d{2})?\b", "<time>"),
        (r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", "<uuid>"),
        (r"\b\d{6,}\b", "<long-number>"),
        (r"\b\d+\b", "<number>"),
        (r"https?://\S+", "<url>"),
    ]
    for pattern, replacement in replacements:
        normalized = re.sub(pattern, replacement, normalized)
    return normalized[:600]


def classify_incident(title: str, body: str, severity: str) -> str:
    lower = f"{title}\n{body}".lower()
    if "cron" in lower and "falhou" in lower:
        return "cron_failure"
    if "análise do código" in lower or "typescript" in lower or "build" in lower:
        return "code_analysis"
    if "platform monitor" in lower or "rls" in lower or "policy" in lower:
        return "platform_monitor"
    if "nfc-e" in lower or "sefaz" in lower:
        return "fiscal"
    if "sentinel" in lower or "scan" in lower:
        return "sentinel"
    if severity == "critical":
        return "critical_generic"
    return "generic"


def prune_incidents(active_incidents: dict[str, IncidentState], incident_window_seconds: int, now_ts: float | None = None) -> list[str]:
    now = now_ts or datetime.now(timezone.utc).timestamp()
    expired: list[str] = []
    for incident_key, incident in active_incidents.items():
        last_seen_ts = datetime.fromisoformat(incident.last_seen).timestamp()
        if now - last_seen_ts > incident_window_seconds:
            expired.append(incident_key)

    for incident_key in expired:
        active_incidents.pop(incident_key, None)

    return expired


def incident_key(title: str, body: str, severity: str) -> tuple[str, str, str]:
    category = classify_incident(title, body, severity)
    normalized_title = normalize_incident_text(title)
    normalized_summary = normalize_incident_text(body.splitlines()[0] if body else title)
    signature = sha1(f"{category}|{normalized_title}|{normalized_summary}".encode("utf-8")).hexdigest()[:16]
    summary = (body.splitlines()[0] if body else title).strip()[:180]
    return signature, category, summary


def track_incident(active_incidents: dict[str, IncidentState], title: str, body: str, severity: str, now: datetime | None = None) -> tuple[IncidentState, str]:
    current_time = now or datetime.now(timezone.utc)
    now_iso = current_time.isoformat()

    resolved_key, category, summary = incident_key(title, body, severity)
    existing = active_incidents.get(resolved_key)
    if existing is None:
        incident = IncidentState(
            incident_key=resolved_key,
            category=category,
            severity=severity,
            title=title,
            summary=summary,
            first_seen=now_iso,
            last_seen=now_iso,
            occurrences=1,
            suppressed_duplicates=0,
            notification_count=0,
        )
        active_incidents[resolved_key] = incident
        return incident, "new"

    existing.last_seen = now_iso
    existing.occurrences += 1
    if severity_rank(severity) > severity_rank(existing.severity):
        existing.severity = severity
    if title:
        existing.title = title[:200]
    if summary:
        existing.summary = summary
    return existing, "update"


def find_incident_by_reference(active_incidents: dict[str, IncidentState], reference: str) -> IncidentState | None:
    normalized = reference.strip().lower()
    if not normalized:
        return None

    exact = active_incidents.get(normalized)
    if exact:
        return exact

    matches = [
        incident
        for current_key, incident in active_incidents.items()
        if current_key.lower().startswith(normalized)
    ]
    if len(matches) == 1:
        return matches[0]
    return None


def incident_snapshot(active_incidents: dict[str, IncidentState], limit: int = 5) -> dict[str, Any]:
    incidents = sorted(
        active_incidents.values(),
        key=lambda incident: (incident.severity == "critical", incident.occurrences, incident.last_seen),
        reverse=True,
    )
    return {
        "active_count": len(incidents),
        "critical_count": sum(1 for incident in incidents if incident.severity == "critical"),
        "warning_count": sum(1 for incident in incidents if incident.severity == "warning"),
        "suppressed_duplicates": sum(incident.suppressed_duplicates for incident in incidents),
        "items": [asdict(incident) for incident in incidents[:limit]],
    }


def incident_record(incident: IncidentState, status: str = "active", metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        **asdict(incident),
        "status": status,
        "resolved_at": None,
        "metadata": metadata or {},
    }


def build_reopen_metadata(previous_record: dict[str, Any] | None) -> dict[str, Any]:
    metadata = previous_record.get("metadata") if previous_record else None
    if not isinstance(metadata, dict):
        metadata = {}

    previous_reopen_count = int(metadata.get("reopen_count") or 0)
    return {
        "reopened": True,
        "reopen_count": previous_reopen_count + 1,
        "previous_status": previous_record.get("status") if previous_record else None,
        "previous_resolved_at": previous_record.get("resolved_at") if previous_record else None,
        "previous_resolution_reason": metadata.get("resolution_reason"),
        "previous_resolution_label": metadata.get("resolution_label"),
    }


def should_dispatch_zaea_task(
    incident: IncidentState,
    incident_mode: str,
    escalation_threshold: int,
    previous_record: dict[str, Any] | None = None,
) -> bool:
    if incident.zaea_task_id:
        return False
    if previous_record and previous_record.get("status") == "resolved" and incident_mode == "new":
        return True
    if incident.severity == "critical" and incident_mode == "new":
        return True
    if incident.occurrences >= escalation_threshold and severity_rank(incident.severity) >= severity_rank("warning"):
        return True
    return False


def build_zaea_task_input(
    incident: IncidentState,
    previous_record: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "incident_key": incident.incident_key,
        "category": incident.category,
        "severity": incident.severity,
        "title": incident.title,
        "summary": incident.summary,
        "occurrences": incident.occurrences,
        "suppressed_duplicates": incident.suppressed_duplicates,
        "last_seen": incident.last_seen,
    }
    if previous_record and previous_record.get("status") == "resolved":
        payload["reopen_context"] = build_reopen_metadata(previous_record)
    return payload


def build_zaea_resolution_metadata(reason: str, note: str | None, source: str) -> dict[str, Any]:
    normalized_reason = reason if reason in RESOLUTION_REASONS else "manual_ack"
    return {
        "resolution_reason": normalized_reason,
        "resolution_label": RESOLUTION_REASONS[normalized_reason],
        "resolution_source": source,
        "resolution_note": (note or "").strip(),
    }


def build_zaea_knowledge_payload(incident: IncidentState, reason: str) -> dict[str, Any]:
    normalized_reason = reason if reason in RESOLUTION_REASONS else "manual_ack"
    return {
        "pattern": f"incident:{incident.category}:{incident.title[:80]}",
        "rootCause": incident.summary,
        "solution": RESOLUTION_REASONS[normalized_reason],
        "filesChanged": [],
        "confidence": 70 if incident.severity == "critical" else 60,
        "outcome": "success",
    }