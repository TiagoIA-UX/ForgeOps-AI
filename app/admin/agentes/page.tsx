"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentCard } from "./components/AgentCard";
import { TaskList } from "./components/TaskList";
import { KnowledgeBase } from "./components/KnowledgeBase";
import type { AgentTask, AgentKnowledge, AgentStats, AgentName, TaskStatus } from "@/lib/types/agent";
import { RefreshCw, Zap } from "lucide-react";

const AGENT_OPTIONS: { value: AgentName | ""; label: string }[] = [
  { value: "", label: "Todos os agentes" },
  { value: "scanner", label: "Scanner" },
  { value: "surgeon", label: "Surgeon" },
  { value: "validator", label: "Validator" },
  { value: "sentinel", label: "Sentinel" },
  { value: "orchestrator", label: "Orchestrator" },
];

const STATUS_OPTIONS: { value: TaskStatus | ""; label: string }[] = [
  { value: "", label: "Todos os status" },
  { value: "pending", label: "Aguardando" },
  { value: "running", label: "Rodando" },
  { value: "completed", label: "Concluído" },
  { value: "failed", label: "Falhou" },
  { value: "escalated", label: "Escalado" },
];

export default function AgentesPage() {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [stats, setStats] = useState<AgentStats[]>([]);
  const [knowledge, setKnowledge] = useState<AgentKnowledge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Filtros
  const [agentFilter, setAgentFilter] = useState<AgentName | "">("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [hoursFilter, setHoursFilter] = useState(24);
  const [activeTab, setActiveTab] = useState<"tasks" | "knowledge">("tasks");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (agentFilter) params.set("agent", agentFilter);
      if (statusFilter) params.set("status", statusFilter);
      params.set("hours", String(hoursFilter));

      const res = await fetch(`/api/admin/data?${params}`);

      if (!res.ok) {
        throw new Error(`Erro ${res.status}: ${await res.text()}`);
      }

      const data = await res.json();
      setTasks(data.tasks ?? []);
      setStats(data.stats ?? []);
      setKnowledge(data.knowledge ?? []);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  }, [agentFilter, statusFilter, hoursFilter]);

  useEffect(() => {
    queueMicrotask(() => fetchData());
  }, [fetchData]);

  // Auto-refresh a cada 60s
  useEffect(() => {
    const interval = setInterval(() => fetchData(), 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const totalIssues = stats.reduce((a, s) => a + s.failed + s.escalated, 0);

  return (
    <div className="min-h-screen bg-zaea-bg text-white p-6 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl">🎼</span>
            <h1 className="text-2xl font-bold">ZAEA — Dashboard</h1>
            {totalIssues > 0 && (
              <span className="text-xs bg-zaea-danger/20 text-zaea-danger px-2 py-0.5 rounded-full">
                {totalIssues} issues
              </span>
            )}
          </div>
          <p className="text-sm text-zaea-muted">
            Zairyx Autonomous Engineering Agent — Sistema de agentes autônomos
          </p>
          {lastRefresh && (
            <p className="text-xs text-zaea-muted mt-1">
              Atualizado em:{" "}
              {lastRefresh.toLocaleTimeString("pt-BR")}
            </p>
          )}
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-zaea-accent hover:bg-zaea-accent-hover disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Atualizar
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-lg border border-zaea-danger/40 bg-zaea-danger/10 text-zaea-danger text-sm">
          {error}
        </div>
      )}

      {/* Agent cards grid */}
      <section>
        <h2 className="text-sm font-semibold text-zaea-muted uppercase tracking-wider mb-3">
          Saúde dos Agentes — últimas {hoursFilter}h
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {loading && stats.length === 0
            ? Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-40 rounded-xl border border-zaea-border bg-zaea-surface animate-pulse"
                />
              ))
            : stats.map((s) => <AgentCard key={s.agent} stats={s} />)}
        </div>
      </section>

      {/* Filters */}
      <section className="flex flex-wrap items-center gap-3">
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value as AgentName | "")}
          className="bg-zaea-surface border border-zaea-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zaea-accent"
        >
          {AGENT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "")}
          className="bg-zaea-surface border border-zaea-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zaea-accent"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={hoursFilter}
          onChange={(e) => setHoursFilter(Number(e.target.value))}
          className="bg-zaea-surface border border-zaea-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zaea-accent"
        >
          {[1, 6, 12, 24, 48, 72].map((h) => (
            <option key={h} value={h}>
              Últimas {h}h
            </option>
          ))}
        </select>

        <span className="text-xs text-zaea-muted ml-auto">
          {tasks.length} tarefa{tasks.length !== 1 ? "s" : ""}
        </span>
      </section>

      {/* Tabs */}
      <section>
        <div className="flex gap-1 mb-4 border-b border-zaea-border">
          <button
            onClick={() => setActiveTab("tasks")}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === "tasks"
                ? "border-zaea-accent text-white"
                : "border-transparent text-zaea-muted hover:text-white"
            }`}
          >
            <span className="flex items-center gap-2">
              <Zap size={14} />
              Tarefas ({tasks.length})
            </span>
          </button>
          <button
            onClick={() => setActiveTab("knowledge")}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === "knowledge"
                ? "border-zaea-accent text-white"
                : "border-transparent text-zaea-muted hover:text-white"
            }`}
          >
            🧠 Conhecimento ({knowledge.length})
          </button>
        </div>

        {activeTab === "tasks" ? (
          <TaskList tasks={tasks} />
        ) : (
          <KnowledgeBase knowledge={knowledge} />
        )}
      </section>
    </div>
  );
}
