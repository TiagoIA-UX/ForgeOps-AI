// ======================================================
// ZAEA — Sentinel Agent
// Monitora alertas e envia notificações via Telegram
// ======================================================

import { updateTaskStatus, getTasksByAgent } from "@/lib/orchestrator";
import type { AgentTask } from "@/lib/types/agent";

const TELEGRAM_API = "https://api.telegram.org";

// ----------------------------
// sendTelegramAlert
// ----------------------------
export async function sendTelegramAlert(
  message: string,
  parseMode: "HTML" | "Markdown" = "HTML"
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[Sentinel] Telegram não configurado — alerta ignorado");
    return false;
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });

    return res.ok;
  } catch (err) {
    console.error("[Sentinel] Falha ao enviar alerta:", err);
    return false;
  }
}

// ----------------------------
// runSentinel
// Verifica saúde dos agentes e alerta se necessário
// ----------------------------
export async function runSentinel(taskId: string): Promise<void> {
  await updateTaskStatus(taskId, "running");

  try {
    const failedTasks = await getTasksByAgent({
      status: "failed",
      hoursBack: 1,
    });
    const escalatedTasks = await getTasksByAgent({
      status: "escalated",
      hoursBack: 1,
    });
    const runningTasks = await getTasksByAgent({
      status: "running",
      hoursBack: 2,
    });

    // Detecta tarefas travadas (running por mais de 30 min)
    const stuckTasks = runningTasks.filter((t) => {
      if (!t.started_at) return false;
      const elapsed = Date.now() - new Date(t.started_at).getTime();
      return elapsed > 30 * 60 * 1000; // 30 minutos
    });

    const alerts: string[] = [];

    if (failedTasks.length > 0) {
      alerts.push(buildFailureAlert(failedTasks));
    }
    if (escalatedTasks.length > 0) {
      alerts.push(buildEscalationAlert(escalatedTasks));
    }
    if (stuckTasks.length > 0) {
      alerts.push(buildStuckAlert(stuckTasks));
    }

    for (const alert of alerts) {
      await sendTelegramAlert(alert);
    }

    const summary = {
      failed: failedTasks.length,
      escalated: escalatedTasks.length,
      stuck: stuckTasks.length,
      alerts_sent: alerts.length,
    };

    await updateTaskStatus(
      taskId,
      "completed",
      summary as unknown as Record<string, unknown>
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateTaskStatus(taskId, "failed", undefined, msg);
    throw err;
  }
}

// ----------------------------
// notifyPatchApplied
// ----------------------------
export async function notifyPatchApplied(params: {
  patchCount: number;
  prUrl: string | null;
  riskLevel: string;
  summary: string;
}): Promise<void> {
  const icon = params.riskLevel === "SAFE" ? "✅" : "⚠️";
  const message = `${icon} <b>ZAEA Surgeon — Patch Aplicado</b>

🔧 Correções: <b>${params.patchCount}</b>
📊 Risco: <b>${params.riskLevel}</b>
${params.prUrl ? `🔗 PR: ${params.prUrl}` : ""}

📝 ${params.summary}`;

  await sendTelegramAlert(message);
}

// ----------------------------
// Builders de mensagem
// ----------------------------
function buildFailureAlert(tasks: AgentTask[]): string {
  const list = tasks
    .slice(0, 5)
    .map((t) => `  • [${t.agent_name}] ${t.task_type}: ${t.error_message ?? "sem detalhe"}`)
    .join("\n");

  return `🔴 <b>ZAEA — ${tasks.length} tarefa(s) falharam na última hora</b>\n\n${list}${tasks.length > 5 ? `\n  ... e mais ${tasks.length - 5}` : ""}`;
}

function buildEscalationAlert(tasks: AgentTask[]): string {
  const list = tasks
    .slice(0, 5)
    .map((t) => `  • [${t.agent_name}] ${t.task_type}`)
    .join("\n");

  return `🟡 <b>ZAEA — ${tasks.length} tarefa(s) escaladas para revisão humana</b>\n\n${list}\n\n<i>Ação manual necessária.</i>`;
}

function buildStuckAlert(tasks: AgentTask[]): string {
  const list = tasks
    .map((t) => {
      const elapsed = t.started_at
        ? Math.round((Date.now() - new Date(t.started_at).getTime()) / 60000)
        : "?";
      return `  • [${t.agent_name}] ${t.task_type} — ${elapsed} min`;
    })
    .join("\n");

  return `🔵 <b>ZAEA — ${tasks.length} tarefa(s) travadas</b>\n\n${list}\n\n<i>Verificar o runner do GitHub Actions.</i>`;
}
