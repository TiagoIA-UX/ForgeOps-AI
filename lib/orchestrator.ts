// ======================================================
// ForgeOps AI — Orchestrator (Forge)
// Responsável por despachar tarefas, registrar outcomes
// e consultar a base de conhecimento evolutiva
// ======================================================

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  AgentName,
  AgentTask,
  AgentKnowledge,
  TaskPriority,
  TaskStatus,
  OutcomeResult,
} from "@/lib/types/agent";

const supabase = createAdminClient();

// ----------------------------
// dispatchTask
// Cria uma nova tarefa na fila e retorna o ID
// ----------------------------
export async function dispatchTask(params: {
  agentName: AgentName;
  taskType: string;
  priority: TaskPriority;
  input: Record<string, unknown>;
  triggeredBy?: AgentTask["triggered_by"];
  parentTaskId?: string;
}): Promise<string> {
  const {
    agentName,
    taskType,
    priority,
    input,
    triggeredBy = "manual",
    parentTaskId,
  } = params;

  const { data, error } = await supabase
    .from("agent_tasks")
    .insert({
      agent_name: agentName,
      task_type: taskType,
      priority,
      status: "pending" as TaskStatus,
      input: { ...input, parent_task_id: parentTaskId ?? null },
      triggered_by: triggeredBy,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Falha ao despachar tarefa [${agentName}]: ${error.message}`);
  }

  return data.id;
}

// ----------------------------
// updateTaskStatus
// Atualiza status de uma tarefa em andamento
// ----------------------------
export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  output?: Record<string, unknown>,
  errorMessage?: string,
  githubPrUrl?: string
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    output: output ?? null,
    error_message: errorMessage ?? null,
    github_pr_url: githubPrUrl ?? null,
  };

  if (status === "running") {
    update.started_at = new Date().toISOString();
  }
  if (["completed", "failed", "escalated"].includes(status)) {
    update.completed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("agent_tasks")
    .update(update)
    .eq("id", taskId);

  if (error) {
    throw new Error(`Falha ao atualizar tarefa ${taskId}: ${error.message}`);
  }
}

// ----------------------------
// recordOutcome
// Registra/atualiza padrão na base de conhecimento
// ----------------------------
export async function recordOutcome(params: {
  agentName: AgentName;
  pattern: string;
  rootCause: string;
  solution: string;
  outcome: OutcomeResult;
  confidenceDelta?: number;
}): Promise<void> {
  const { agentName, pattern, rootCause, solution, outcome, confidenceDelta = 5 } = params;

  // Verifica se já existe este padrão
  const { data: existing } = await supabase
    .from("agent_knowledge")
    .select("id, confidence, occurrences")
    .eq("agent_name", agentName)
    .eq("pattern", pattern)
    .maybeSingle();

  if (existing) {
    // Incrementa confiança em caso de sucesso, reduz em falha
    const delta = outcome === "success" ? confidenceDelta : -confidenceDelta;
    const newConfidence = Math.min(100, Math.max(0, existing.confidence + delta));

    await supabase
      .from("agent_knowledge")
      .update({
        confidence: newConfidence,
        occurrences: existing.occurrences + 1,
        outcome,
        solution,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    const initialConfidence = outcome === "success" ? 60 : 30;

    await supabase.from("agent_knowledge").insert({
      agent_name: agentName,
      pattern,
      root_cause: rootCause,
      solution,
      confidence: initialConfidence,
      outcome,
      occurrences: 1,
      last_seen_at: new Date().toISOString(),
    });
  }
}

// ----------------------------
// getKnowledge
// Consulta base de conhecimento para um padrão similar
// ----------------------------
export async function getKnowledge(
  agentName: AgentName,
  pattern: string,
  minConfidence = 50
): Promise<AgentKnowledge[]> {
  const { data, error } = await supabase
    .from("agent_knowledge")
    .select("*")
    .eq("agent_name", agentName)
    .gte("confidence", minConfidence)
    .ilike("pattern", `%${pattern.substring(0, 50)}%`)
    .order("confidence", { ascending: false })
    .limit(5);

  if (error) {
    console.error("[Orchestrator] getKnowledge error:", error.message);
    return [];
  }

  return data ?? [];
}

// ----------------------------
// getTasksByAgent
// Lista tarefas com filtros
// ----------------------------
export async function getTasksByAgent(params: {
  agentName?: AgentName;
  status?: TaskStatus;
  hoursBack?: number;
  limit?: number;
}): Promise<AgentTask[]> {
  const { agentName, status, hoursBack = 24, limit = 50 } = params;

  let query = supabase
    .from("agent_tasks")
    .select("*")
    .gte(
      "created_at",
      new Date(Date.now() - hoursBack * 3600 * 1000).toISOString()
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (agentName) query = query.eq("agent_name", agentName);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;

  if (error) {
    console.error("[Orchestrator] getTasksByAgent error:", error.message);
    return [];
  }

  return data ?? [];
}

// ----------------------------
// getAgentStats
// Retorna estatísticas consolidadas por agente
// ----------------------------
export async function getAgentStats(hoursBack = 24) {
  const { data: tasks } = await supabase
    .from("agent_tasks")
    .select("agent_name, status, created_at, updated_at")
    .gte(
      "created_at",
      new Date(Date.now() - hoursBack * 3600 * 1000).toISOString()
    );

  if (!tasks) return [];

  const agents: AgentName[] = [
    "scanner",
    "surgeon",
    "validator",
    "sentinel",
    "orchestrator",
  ];

  return agents.map((agent) => {
    const agentTasks = tasks.filter((t) => t.agent_name === agent);
    const completed = agentTasks.filter((t) => t.status === "completed").length;
    const failed = agentTasks.filter((t) => t.status === "failed").length;
    const escalated = agentTasks.filter((t) => t.status === "escalated").length;
    const running = agentTasks.filter((t) => t.status === "running").length;
    const total = agentTasks.length;
    const done = completed + failed + escalated;

    return {
      agent,
      total,
      completed,
      failed,
      escalated,
      running,
      successRate: done > 0 ? Math.round((completed / done) * 100) : 0,
      lastActivity:
        agentTasks[0]?.updated_at ?? agentTasks[0]?.created_at ?? null,
    };
  });
}
