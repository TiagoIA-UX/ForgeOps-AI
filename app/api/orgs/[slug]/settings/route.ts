// ======================================================
// ZAEA — GET/POST /api/orgs/[slug]/settings
// Lê e salva as configurações dos agentes da org
// ======================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrgBySlug, getUserRole } from "@/lib/tenant";
import { getAgentConfig, saveAgentConfig } from "@/lib/agent-config";

type Params = { params: Promise<{ slug: string }> };

// GET — carrega config atual (mascara tokens com ***)
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const org = await getOrgBySlug(slug);
  if (!org) return NextResponse.json({ error: "Org não encontrada" }, { status: 404 });

  const role = await getUserRole(user.id, org.id);
  if (!role || !["owner", "admin"].includes(role)) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const config = await getAgentConfig(org.id);

  // Mascara tokens sensíveis — nunca retorna o valor real ao cliente
  function mask(val: string | null): string {
    if (!val) return "";
    if (val.length <= 8) return "••••••••";
    return val.substring(0, 4) + "••••••••" + val.substring(val.length - 4);
  }

  return NextResponse.json({
    github_token:       mask(config.github_token),
    github_repo_owner:  config.github_repo_owner  ?? "",
    github_repo_name:   config.github_repo_name   ?? "",
    groq_api_key:       mask(config.groq_api_key),
    telegram_bot_token: mask(config.telegram_bot_token),
    telegram_chat_id:   config.telegram_chat_id    ?? "",
    notify_email:       config.notify_email        ?? "",
    auto_fix_enabled:   config.auto_fix_enabled,
    max_fixes_per_run:  config.max_fixes_per_run,
    risk_level_allowed: config.risk_level_allowed,
    notify_on_fix:      config.notify_on_fix,
    notify_on_error:    config.notify_on_error,
    setup_completed:    config.setup_completed,
    // Flag: tem valor real salvo (sem expor o valor)
    has_github_token:       !!config.github_token,
    has_groq_key:           !!config.groq_api_key,
    has_telegram_token:     !!config.telegram_bot_token,
  });
}

// POST — salva credenciais
const Schema = z.object({
  github_token:       z.string().optional(),
  github_repo_owner:  z.string().optional(),
  github_repo_name:   z.string().optional(),
  groq_api_key:       z.string().optional(),
  telegram_bot_token: z.string().optional(),
  telegram_chat_id:   z.string().optional(),
  notify_email:       z.string().email().or(z.literal("")).optional(),
  auto_fix_enabled:   z.boolean().optional(),
  max_fixes_per_run:  z.number().int().min(1).max(20).optional(),
  risk_level_allowed: z.enum(["SAFE", "MODERATE", "RISKY"]).optional(),
  notify_on_fix:      z.boolean().optional(),
  notify_on_error:    z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const org = await getOrgBySlug(slug);
  if (!org) return NextResponse.json({ error: "Org não encontrada" }, { status: 404 });

  const role = await getUserRole(user.id, org.id);
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "Apenas owner/admin pode alterar configurações" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", details: parsed.error.flatten() }, { status: 422 });
  }

  // Ignora campos que vieram como string mascarada (contendo ••••)
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (typeof v === "string" && v.includes("••••")) continue;
    if (v === "" || v === undefined) continue;
    clean[k] = v;
  }

  await saveAgentConfig(org.id, clean as Parameters<typeof saveAgentConfig>[1]);

  return NextResponse.json({ success: true });
}
