// ======================================================
// ZAEA — GET /api/admin/data
// Proxy server-side para dados do dashboard admin.
// Requer sessão Supabase autenticada — secret nunca
// chega ao bundle do cliente.
// ======================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTasksByAgent, getAgentStats, getKnowledge } from "@/lib/orchestrator";
import { z } from "zod";

export const dynamic = "force-dynamic";

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

export async function GET(req: NextRequest) {
  // Em desenvolvimento sem Supabase configurado, libera sem auth
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseConfigured =
    supabaseUrl.length > 0 && !supabaseUrl.includes("seu-projeto");

  if (supabaseConfigured) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
  }

  const { searchParams } = req.nextUrl;
  const parsed = QuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Parâmetros inválidos", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { agent, status, hours, limit } = parsed.data;

  const [tasks, stats, knowledge] = await Promise.all([
    getTasksByAgent({ agentName: agent, status, hoursBack: hours, limit }),
    getAgentStats(hours),
    getKnowledge(agent ?? "scanner", "", 0),
  ]);

  return NextResponse.json({ tasks, stats, knowledge });
}
