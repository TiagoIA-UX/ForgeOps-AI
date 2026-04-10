// ======================================================
// ForgeOps AI — lib/agent-config.ts
// Lê credenciais dos agentes por org (do banco) com
// fallback para variáveis de ambiente globais
// ======================================================

import { createAdminClient } from "@/lib/supabase/admin";

export interface AgentConfig {
  github_token:       string | null;
  github_repo_owner:  string | null;
  github_repo_name:   string | null;
  groq_api_key:       string | null;
  telegram_bot_token: string | null;
  telegram_chat_id:   string | null;
  notify_email:       string | null;
  auto_fix_enabled:   boolean;
  max_fixes_per_run:  number;
  risk_level_allowed: "SAFE" | "MODERATE" | "RISKY";
  notify_on_fix:      boolean;
  notify_on_error:    boolean;
  setup_completed:    boolean;
}

/**
 * Retorna a config dos agentes para uma org.
 * Prioridade: banco (org) > variáveis de ambiente globais.
 */
export async function getAgentConfig(orgId: string): Promise<AgentConfig> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("org_agent_config")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();

  return {
    github_token:       data?.github_token       ?? process.env.GITHUB_TOKEN ?? null,
    github_repo_owner:  data?.github_repo_owner  ?? process.env.GITHUB_REPO_OWNER ?? null,
    github_repo_name:   data?.github_repo_name   ?? process.env.GITHUB_REPO_NAME ?? null,
    groq_api_key:       data?.groq_api_key        ?? process.env.GROQ_API_KEY ?? null,
    telegram_bot_token: data?.telegram_bot_token  ?? process.env.TELEGRAM_BOT_TOKEN ?? null,
    telegram_chat_id:   data?.telegram_chat_id    ?? process.env.TELEGRAM_CHAT_ID ?? null,
    notify_email:       data?.notify_email        ?? null,
    auto_fix_enabled:   data?.auto_fix_enabled    ?? false,
    max_fixes_per_run:  data?.max_fixes_per_run   ?? 5,
    risk_level_allowed: data?.risk_level_allowed  ?? "SAFE",
    notify_on_fix:      data?.notify_on_fix       ?? true,
    notify_on_error:    data?.notify_on_error     ?? true,
    setup_completed:    data?.setup_completed     ?? false,
  };
}

/**
 * Salva (upsert) a config dos agentes para uma org.
 * Não sobrescreve campos que vier null/undefined.
 */
export async function saveAgentConfig(
  orgId: string,
  config: Partial<Omit<AgentConfig, "setup_completed">>
): Promise<void> {
  const supabase = createAdminClient();

  // Remove campos undefined para não sobrescrever com null
  const patch: Record<string, unknown> = { org_id: orgId };
  for (const [k, v] of Object.entries(config)) {
    if (v !== undefined) patch[k] = v;
  }

  // Marca setup como completo se os campos essenciais estão preenchidos
  const allNeeded = ["github_token", "github_repo_owner", "github_repo_name", "groq_api_key"];
  const currentConfig = await getAgentConfig(orgId);
  const merged = { ...currentConfig, ...config };
  const isComplete = allNeeded.every((k) => !!(merged as Record<string, unknown>)[k]);
  patch.setup_completed = isComplete;

  await supabase.from("org_agent_config").upsert(patch, { onConflict: "org_id" });
}
