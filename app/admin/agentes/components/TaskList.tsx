"use client";

import { AgentTask } from "@/lib/types/agent";
import { Clock, CheckCircle, XCircle, AlertTriangle, Loader2, ExternalLink } from "lucide-react";

const STATUS_CONFIG = {
  pending:   { label: "Aguardando",  color: "text-zaea-muted",   bg: "bg-zaea-muted/10",   icon: Clock },
  running:   { label: "Rodando",     color: "text-zaea-info",    bg: "bg-zaea-info/10",    icon: Loader2 },
  completed: { label: "Concluído",   color: "text-zaea-success", bg: "bg-zaea-success/10", icon: CheckCircle },
  failed:    { label: "Falhou",      color: "text-zaea-danger",  bg: "bg-zaea-danger/10",  icon: XCircle },
  escalated: { label: "Escalado",    color: "text-zaea-warning", bg: "bg-zaea-warning/10", icon: AlertTriangle },
} as const;

const PRIORITY_CONFIG = {
  p0: { label: "P0 — Crítico",  color: "text-zaea-danger" },
  p1: { label: "P1 — Normal",   color: "text-zaea-info" },
  p2: { label: "P2 — Baixo",    color: "text-zaea-muted" },
} as const;

interface TaskListProps {
  tasks: AgentTask[];
}

export function TaskList({ tasks }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-12 text-zaea-muted text-sm">
        Nenhuma tarefa encontrada no período selecionado.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </div>
  );
}

function TaskRow({ task }: { task: AgentTask }) {
  const status = STATUS_CONFIG[task.status];
  const priority = PRIORITY_CONFIG[task.priority];
  const StatusIcon = status.icon;

  const elapsed =
    task.started_at && task.completed_at
      ? Math.round(
          (new Date(task.completed_at).getTime() -
            new Date(task.started_at).getTime()) /
            1000
        )
      : null;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-zaea-border bg-zaea-surface hover:border-zaea-accent/30 transition-colors">
      {/* Status icon */}
      <div className={`mt-0.5 p-1.5 rounded-md ${status.bg}`}>
        <StatusIcon
          size={14}
          className={`${status.color} ${task.status === "running" ? "animate-spin" : ""}`}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-white bg-zaea-bg px-2 py-0.5 rounded">
            {task.agent_name}
          </span>
          <span className="text-xs text-zaea-muted truncate">{task.task_type}</span>
          <span className={`text-xs ${priority.color}`}>{priority.label}</span>
          {task.github_pr_url && (
            <a
              href={task.github_pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-zaea-accent hover:underline flex items-center gap-0.5"
            >
              PR <ExternalLink size={10} />
            </a>
          )}
        </div>

        {task.error_message && (
          <p className="text-xs text-zaea-danger mt-1 truncate" title={task.error_message}>
            {task.error_message}
          </p>
        )}

        <div className="flex items-center gap-3 mt-1 text-xs text-zaea-muted">
          <span>
            {new Date(task.created_at).toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {elapsed !== null && (
            <span>Duração: {elapsed}s</span>
          )}
          <span className="uppercase text-xs">{task.triggered_by}</span>
        </div>
      </div>

      {/* Status badge */}
      <span className={`text-xs px-2 py-0.5 rounded-full ${status.bg} ${status.color} whitespace-nowrap`}>
        {status.label}
      </span>
    </div>
  );
}
