"use client";

import { AgentKnowledge } from "@/lib/types/agent";

const OUTCOME_CONFIG = {
  success:   { label: "Sucesso",  color: "text-forge-success", bg: "bg-forge-success/10" },
  failed:    { label: "Falhou",   color: "text-forge-danger",  bg: "bg-forge-danger/10" },
  escalated: { label: "Escalado", color: "text-forge-warning", bg: "bg-forge-warning/10" },
  partial:   { label: "Parcial",  color: "text-forge-info",    bg: "bg-forge-info/10" },
} as const;

interface KnowledgeBaseProps {
  knowledge: AgentKnowledge[];
}

export function KnowledgeBase({ knowledge }: KnowledgeBaseProps) {
  if (knowledge.length === 0) {
    return (
      <div className="text-center py-8 text-forge-muted text-sm">
        Base de conhecimento vazia. Os agentes aprenderão com o tempo.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {knowledge.map((k) => (
        <KnowledgeRow key={k.id} item={k} />
      ))}
    </div>
  );
}

function KnowledgeRow({ item }: { item: AgentKnowledge }) {
  const outcome = OUTCOME_CONFIG[item.outcome];
  const confColor =
    item.confidence >= 80
      ? "text-forge-success"
      : item.confidence >= 50
      ? "text-forge-warning"
      : "text-forge-danger";

  return (
    <div className="p-4 rounded-lg border border-forge-border bg-forge-surface space-y-2">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-white bg-forge-bg px-2 py-0.5 rounded">
            {item.agent_name}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${outcome.bg} ${outcome.color}`}
          >
            {outcome.label}
          </span>
          <span className="text-xs text-forge-muted">{item.occurrences}x observado</span>
        </div>
        {/* Confidence badge */}
        <div className="flex flex-col items-end">
          <span className={`text-sm font-bold ${confColor}`}>
            {item.confidence}%
          </span>
          <span className="text-xs text-forge-muted">confiança</span>
        </div>
      </div>

      {/* Confidence bar */}
      <div className="h-1 bg-forge-bg rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${
            item.confidence >= 80
              ? "bg-forge-success"
              : item.confidence >= 50
              ? "bg-forge-warning"
              : "bg-forge-danger"
          }`}
          style={{ width: `${item.confidence}%` }}
        />
      </div>

      {/* Pattern */}
      <div>
        <p className="text-xs text-forge-muted mb-0.5">Padrão detectado</p>
        <p className="text-xs text-white font-mono break-all">{item.pattern}</p>
      </div>

      {/* Solution */}
      <div>
        <p className="text-xs text-forge-muted mb-0.5">Solução aplicada</p>
        <p className="text-xs text-forge-success break-all">{item.solution}</p>
      </div>

      <p className="text-xs text-forge-muted">
        Último ocorrência:{" "}
        {new Date(item.last_seen_at).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
    </div>
  );
}
