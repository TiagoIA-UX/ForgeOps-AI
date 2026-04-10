// ======================================================
// ForgeOps AI — API Route: POST/GET /api/agents/dispatch
// Despacha tarefas para os agentes e consulta resultados
// ======================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateApiSecret } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  dispatchTask,
  getTasksByAgent,
  getAgentStats,
  getKnowledge,
} from "@/lib/orchestrator";

// ----------------------------
// Schemas Zod
// ----------------------------
const DispatchSchema = z.object({
  agent: z.enum(["scanner", "surgeon", "validator", "sentinel", "orchestrator"]),
  taskType: z.string().min(1).max(100),
  priority: z.enum(["p0", "p1", "p2"]).default("p1"),
  input: z.record(z.unknown()).default({}),
  triggeredBy: z
    .enum(["cron", "alert", "manual", "cascade"])
    .default("manual"),
});

const QuerySchema = z.object({
  agent: z
    .enum(["scanner", "surgeon", "validator", "sentinel", "orchestrator"])
    .optional(),
  status: z
    .enum(["pending", "running", "completed", "failed", "escalated"])
    .optional(),
  hours: z.coerce.number().min(1).max(168).default(24),
  limit: z.coerce.number().min(1).max(200).default(50),
});

// ----------------------------
// POST — Despacha nova tarefa
// ----------------------------
export async function POST(req: NextRequest) {
  // Autenticação
  if (!validateApiSecret(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // Rate limiting: 30 req/min por IP
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const limit = rateLimit(`dispatch:${ip}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Muitas requisições. Tente novamente em breve." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  // Parse e validação do body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = DispatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { agent, taskType, priority, input, triggeredBy } = parsed.data;

  try {
    const taskId = await dispatchTask({
      agentName: agent,
      taskType,
      priority,
      input,
      triggeredBy,
    });

    return NextResponse.json({ success: true, taskId }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro interno";
    console.error("[API dispatch] POST error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ----------------------------
// GET — Consulta tarefas e stats
// ----------------------------
export async function GET(req: NextRequest) {
  // Autenticação
  if (!validateApiSecret(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const limit = rateLimit(`dispatch-get:${ip}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Muitas requisições" }, { status: 429 });
  }

  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = QuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Parâmetros inválidos", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { agent, status, hours, limit: taskLimit } = parsed.data;

  try {
    const [tasks, stats, knowledge] = await Promise.all([
      getTasksByAgent({
        agentName: agent,
        status,
        hoursBack: hours,
        limit: taskLimit,
      }),
      getAgentStats(hours),
      agent ? getKnowledge(agent, "", 30) : Promise.resolve([]),
    ]);

    return NextResponse.json(
      { tasks, stats, knowledge },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-RateLimit-Remaining": String(limit.remaining),
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro interno";
    console.error("[API dispatch] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
