"use client";

import { AgentStats } from "@/lib/types/agent";
import { CheckCircle, XCircle, Clock, AlertTriangle, Zap } from "lucide-react";

const AGENT_META: Record<string, { label: string; emoji: string; description: string }> = {
  scanner:     { label: "Scanner",     emoji: "🔍", description: "Detecta erros e lint" },
  surgeon:     { label: "Surgeon",     emoji: "🔧", description: "Gera patches automáticos" },
  validator:   { label: "Validator",   emoji: "✅", description: "Valida antes do merge" },
  sentinel:    { label: "Sentinel",    emoji: "🛡️", description: "Monitora e alerta" },
  orchestrator:{ label: "Orchestrator",emoji: "🎼", description: "Coordena todos os agentes" },
};

interface AgentCardProps {
  stats: AgentStats;
}

export function AgentCard({ stats }: AgentCardProps) {
  const meta = AGENT_META[stats.agent] ?? { label: stats.agent, emoji: "🤖", description: "" };
  const isHealthy = stats.successRate >= 80 || stats.total === 0;
  const hasIssues = stats.failed > 0 || stats.escalated > 0;

  return (
    <div
      className={`rounded-xl border p-5 bg-zaea-surface transition-all duration-200 hover:border-zaea-accent/50 ${
        hasIssues ? "border-zaea-warning/40" : "border-zaea-border"
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{meta.emoji}</span>
          <div>
            <h3 className="font-semibold text-white text-sm">{meta.label}</h3>
            <p className="text-xs text-zaea-muted">{meta.description}</p>
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-1.5">
          {stats.running > 0 ? (
            <span className="flex items-center gap-1 text-xs text-zaea-info">
              <Zap size={12} className="animate-pulse" />
              Ativo
            </span>
          ) : isHealthy ? (
            <span className="flex items-center gap-1 text-xs text-zaea-success">
              <CheckCircle size={12} />
              Saudável
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-zaea-warning">
              <AlertTriangle size={12} />
              Atenção
            </span>
          )}
        </div>
      </div>

      {/* Success rate bar */}
      {stats.total > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-zaea-muted">Taxa de sucesso</span>
            <span className={stats.successRate >= 80 ? "text-zaea-success" : "text-zaea-warning"}>
              {stats.successRate}%
            </span>
          </div>
          <div className="h-1.5 bg-zaea-bg rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                stats.successRate >= 80 ? "bg-zaea-success" : "bg-zaea-warning"
              }`}
              style={{ width: `${stats.successRate}%` }}
            />
          </div>
        </div>
      )}

      {/* Counters */}
      <div className="grid grid-cols-4 gap-2">
        <Metric label="Total" value={stats.total} color="text-white" />
        <Metric
          label="OK"
          value={stats.completed}
          color="text-zaea-success"
          icon={<CheckCircle size={10} />}
        />
        <Metric
          label="Falha"
          value={stats.failed}
          color="text-zaea-danger"
          icon={<XCircle size={10} />}
        />
        <Metric
          label="Escal."
          value={stats.escalated}
          color="text-zaea-warning"
          icon={<AlertTriangle size={10} />}
        />
      </div>

      {/* Last activity */}
      {stats.lastActivity && (
        <div className="mt-3 flex items-center gap-1 text-xs text-zaea-muted">
          <Clock size={10} />
          <span>
            Última atividade:{" "}
            {new Date(stats.lastActivity).toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="text-center">
      <div className={`text-lg font-bold ${color} flex items-center justify-center gap-0.5`}>
        {icon}
        {value}
      </div>
      <div className="text-xs text-zaea-muted">{label}</div>
    </div>
  );
}
