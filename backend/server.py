"""
ZAEA — Zai Sentinel (Python FastAPI Backend)
Agente local de monitoramento contínuo
Monitora tarefas, envia alertas Telegram e dispara scans
"""

from __future__ import annotations

import asyncio
import os
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Header, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from supabase import create_client, Client

load_dotenv()

# ======================================================
# Configuração
# ======================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("zaea.sentinel")

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
INTERNAL_SECRET = os.environ["INTERNAL_API_SECRET"]
APP_URL = os.environ.get("NEXT_PUBLIC_APP_URL", "http://localhost:3000")

# Intervalo de polling (segundos)
SENTINEL_INTERVAL = int(os.environ.get("SENTINEL_INTERVAL", "60"))

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# ======================================================
# Schemas Pydantic
# ======================================================
class DispatchRequest(BaseModel):
    agent: str
    task_type: str
    priority: str = "p1"
    input: dict[str, Any] = {}
    triggered_by: str = "manual"

    @field_validator("agent")
    @classmethod
    def validate_agent(cls, v: str) -> str:
        valid = {"scanner", "surgeon", "validator", "sentinel", "orchestrator"}
        if v not in valid:
            raise ValueError(f"Agente inválido: {v}. Válidos: {valid}")
        return v

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: str) -> str:
        if v not in {"p0", "p1", "p2"}:
            raise ValueError(f"Prioridade inválida: {v}")
        return v


class AlertPayload(BaseModel):
    message: str
    parse_mode: str = "HTML"


# ======================================================
# Telegram
# ======================================================
async def send_telegram(message: str, parse_mode: str = "HTML") -> bool:
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        log.warning("Telegram não configurado — alerta ignorado")
        return False

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.post(
                f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
                json={
                    "chat_id": TELEGRAM_CHAT_ID,
                    "text": message,
                    "parse_mode": parse_mode,
                    "disable_web_page_preview": True,
                },
            )
            return res.status_code == 200
        except httpx.HTTPError as e:
            log.error("Telegram error: %s", e)
            return False


# ======================================================
# Monitoramento contínuo
# ======================================================
async def check_agent_health() -> None:
    """Verifica saúde dos agentes e alerta se necessário."""
    now = datetime.now(timezone.utc)

    # Tarefas com falha na última hora
    failed = (
        supabase.table("agent_tasks")
        .select("id, agent_name, task_type, error_message, created_at")
        .eq("status", "failed")
        .gte("created_at", now.replace(minute=now.minute - 60, second=0).isoformat())
        .execute()
    )

    # Tarefas escaladas
    escalated = (
        supabase.table("agent_tasks")
        .select("id, agent_name, task_type")
        .eq("status", "escalated")
        .gte("created_at", now.replace(minute=now.minute - 60, second=0).isoformat())
        .execute()
    )

    # Tarefas travadas (running > 30 min)
    running = (
        supabase.table("agent_tasks")
        .select("id, agent_name, task_type, started_at")
        .eq("status", "running")
        .execute()
    )

    stuck = []
    for task in running.data or []:
        if task.get("started_at"):
            started = datetime.fromisoformat(task["started_at"].replace("Z", "+00:00"))
            elapsed = (now - started).total_seconds() / 60
            if elapsed > 30:
                stuck.append({**task, "elapsed_min": round(elapsed)})

    # Envia alertas
    if failed.data:
        lines = "\n".join(
            f"  • [{t['agent_name']}] {t['task_type']}: {t.get('error_message', 'sem detalhe')}"
            for t in failed.data[:5]
        )
        msg = f"🔴 <b>ZAEA Sentinel — {len(failed.data)} falha(s)</b>\n\n{lines}"
        await send_telegram(msg)
        log.warning("Alertou %d falhas", len(failed.data))

    if escalated.data:
        lines = "\n".join(
            f"  • [{t['agent_name']}] {t['task_type']}" for t in escalated.data[:5]
        )
        msg = f"🟡 <b>ZAEA Sentinel — {len(escalated.data)} tarefa(s) escalada(s)</b>\n\n{lines}"
        await send_telegram(msg)

    if stuck:
        lines = "\n".join(
            f"  • [{t['agent_name']}] {t['task_type']} — {t['elapsed_min']} min"
            for t in stuck
        )
        msg = f"🔵 <b>ZAEA Sentinel — {len(stuck)} tarefa(s) travada(s)</b>\n\n{lines}"
        await send_telegram(msg)
        log.warning("Detectou %d tarefas travadas", len(stuck))


async def sentinel_loop() -> None:
    """Loop principal do Sentinel."""
    log.info("Sentinel iniciado — intervalo: %ds", SENTINEL_INTERVAL)
    await send_telegram(
        f"🟢 <b>ZAEA Sentinel Online</b>\n\nMonitoramento ativo. Intervalo: {SENTINEL_INTERVAL}s"
    )

    while True:
        try:
            await check_agent_health()
        except Exception as e:
            log.error("Erro no check de saúde: %s", e)
        await asyncio.sleep(SENTINEL_INTERVAL)


# ======================================================
# FastAPI App
# ======================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(sentinel_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    log.info("Sentinel encerrado")


app = FastAPI(
    title="ZAEA Sentinel",
    description="Agente de monitoramento contínuo do sistema ZAEA",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if os.environ.get("NODE_ENV") != "production" else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[APP_URL],
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


def _authenticate(authorization: str) -> None:
    """Valida o token interno — timing-safe."""
    token = authorization.removeprefix("Bearer ").strip()
    secret = INTERNAL_SECRET

    # Comparação timing-safe
    if len(token) != len(secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Não autorizado")

    mismatch = 0
    for a, b in zip(token, secret):
        mismatch |= ord(a) ^ ord(b)

    if mismatch:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Não autorizado")


# ======================================================
# Endpoints
# ======================================================
@app.get("/health")
async def health_check():
    """Health check sem autenticação."""
    return {"status": "ok", "agent": "sentinel", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.post("/dispatch")
async def dispatch_task(
    body: DispatchRequest,
    authorization: str = Header(...),
):
    """Despacha uma tarefa para o sistema ZAEA via API."""
    _authenticate(authorization)

    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(
            f"{APP_URL}/api/agents/dispatch",
            json={
                "agent": body.agent,
                "taskType": body.task_type,
                "priority": body.priority,
                "input": body.input,
                "triggeredBy": body.triggered_by,
            },
            headers={"Authorization": f"Bearer {INTERNAL_SECRET}"},
        )

    if not res.is_success:
        raise HTTPException(status_code=res.status_code, detail=res.text)

    return res.json()


@app.post("/alert")
async def send_alert(
    body: AlertPayload,
    authorization: str = Header(...),
):
    """Envia alerta Telegram manualmente."""
    _authenticate(authorization)
    sent = await send_telegram(body.message, body.parse_mode)
    return {"sent": sent}


@app.get("/tasks")
async def get_recent_tasks(
    hours: int = 24,
    authorization: str = Header(...),
):
    """Consulta tarefas recentes do Supabase."""
    _authenticate(authorization)

    from datetime import timedelta
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()

    result = (
        supabase.table("agent_tasks")
        .select("*")
        .gte("created_at", since)
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )

    return {"tasks": result.data, "count": len(result.data or [])}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8080)),
        reload=os.environ.get("NODE_ENV") != "production",
        log_level="info",
    )
