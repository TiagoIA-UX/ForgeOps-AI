export type ForgeOpsAgentName =
  | "scanner"
  | "surgeon"
  | "validator"
  | "sentinel"
  | "orchestrator";

export type ForgeOpsTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "escalated";

export type ForgeOpsTaskPriority = "p0" | "p1" | "p2";

export type ForgeOpsTriggeredBy = "cron" | "alert" | "manual" | "cascade";

export interface ForgeOpsTask {
  id: string;
  agent_name: ForgeOpsAgentName;
  status: ForgeOpsTaskStatus;
  priority: ForgeOpsTaskPriority;
  task_type: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  github_pr_url: string | null;
  triggered_by: ForgeOpsTriggeredBy;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

export interface ForgeOpsKnowledge {
  id: string;
  agent_name: ForgeOpsAgentName;
  pattern: string;
  root_cause: string;
  solution: string;
  confidence: number;
  outcome: "success" | "failed" | "escalated" | "partial";
  occurrences: number;
  last_seen_at: string;
  created_at: string;
}

export interface ForgeOpsAgentStats {
  agent: ForgeOpsAgentName;
  total: number;
  completed: number;
  failed: number;
  escalated: number;
  running: number;
  successRate: number;
  lastActivity: string | null;
}

export interface ForgeOpsDispatchRequest {
  agent: ForgeOpsAgentName;
  taskType: string;
  priority?: ForgeOpsTaskPriority;
  input?: Record<string, unknown>;
  triggeredBy?: ForgeOpsTriggeredBy;
}

export interface ForgeOpsDispatchResponse {
  success: boolean;
  taskId: string;
  message?: string;
}

export interface ForgeOpsListTasksParams {
  agent?: ForgeOpsAgentName;
  status?: ForgeOpsTaskStatus;
  hours?: number;
  limit?: number;
}

export interface ForgeOpsListTasksResponse {
  tasks: ForgeOpsTask[];
  stats: ForgeOpsAgentStats[];
  knowledge: ForgeOpsKnowledge[];
}

export interface ForgeOpsClientOptions {
  baseUrl: string;
  apiSecret: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}