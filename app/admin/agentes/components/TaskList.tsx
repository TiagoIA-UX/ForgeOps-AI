"use client";

import { AgentTask } from "@/lib/types/agent";
import { Clock, CheckCircle, XCircle, AlertTriangle, Loader2, ExternalLink } from "lucide-react";

const STATUS_CONFIG = {
  pending:   { label: "Aguardando",  color: "text-forge-muted",   bg: "bg-forge-muted/10",   icon: Clock },
  running:   { label: "Rodando",     color: "text-forge-info",    bg: "bg-forge-info/10",    icon: Loader2 },
  completed: { label: "Concluído",   color: "text-forge-success", bg: "bg-forge-success/10", icon: CheckCircle },
  failed:    { label: "Falhou",      color: "text-forge-danger",  bg: "bg-forge-danger/10",  icon: XCircle },
  escalated: { label: "Escalado",    color: "text-forge-warning", bg: "bg-forge-warning/10", icon: AlertTriangle },
} as const;

const PRIORITY_CONFIG = {
  p0: { label: "P0 — Crítico",  color: "text-forge-danger" },
  p1: { label: "P1 — Normal",   color: "text-forge-info" },
  p2: { label: "P2 — Baixo",    color: "text-forge-muted" },
} as const;

interface TaskListProps {
  tasks: AgentTask[];
}

export function TaskList({ tasks }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-12 text-forge-muted text-sm">
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
    <div className="flex items-start gap-3 p-3 rounded-lg border border-forge-border bg-forge-surface hover:border-forge-accent/30 transition-colors">
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
          <span className="text-xs font-semibold text-white bg-forge-bg px-2 py-0.5 rounded">
            {task.agent_name}
          </span>
          <span className="text-xs text-forge-muted truncate">{task.task_type}</span>
          <span className={`text-xs ${priority.color}`}>{priority.label}</span>
          {task.github_pr_url && (
            <a
              href={task.github_pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-forge-accent hover:underline flex items-center gap-0.5"
            >
              PR <ExternalLink size={10} />
            </a>
          )}
        </div>

        {task.error_message && (
          <p className="text-xs text-forge-danger mt-1 truncate" title={task.error_message}>
            {task.error_message}
          </p>
        )}

        <div className="flex items-center gap-3 mt-1 text-xs text-forge-muted">
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
