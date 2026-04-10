// ======================================================
// ZAEA — Tipos centrais do sistema de agentes
// ======================================================

export type AgentName =
  | "scanner"
  | "surgeon"
  | "validator"
  | "sentinel"
  | "orchestrator";

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "escalated";

export type TaskPriority = "p0" | "p1" | "p2";

export type RiskLevel = "SAFE" | "MODERATE" | "RISKY";

export type OutcomeResult = "success" | "failed" | "escalated" | "partial";

// ----------------------------
// agent_tasks
// ----------------------------
export interface AgentTask {
  id: string;
  agent_name: AgentName;
  status: TaskStatus;
  priority: TaskPriority;
  task_type: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  github_pr_url: string | null;
  triggered_by: "cron" | "alert" | "manual" | "cascade";
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

// ----------------------------
// agent_knowledge
// ----------------------------
export interface AgentKnowledge {
  id: string;
  agent_name: AgentName;
  pattern: string;
  root_cause: string;
  solution: string;
  confidence: number; // 0-100
  outcome: OutcomeResult;
  occurrences: number;
  last_seen_at: string;
  created_at: string;
}

// ----------------------------
// Input/Output tipados por agente
// ----------------------------
export interface ScannerInput {
  sha?: string;
  repo?: string;
  target_files?: string[];
}

export interface ScannerOutput {
  errors_found: number;
  typescript_errors: TypeScriptError[];
  lint_errors: LintError[];
  risk_level: RiskLevel;
  summary: string;
}

export interface TypeScriptError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

export interface LintError {
  file: string;
  line: number;
  rule: string;
  message: string;
  severity: "error" | "warning";
}

export interface SurgeonInput {
  scan_task_id: string;
  errors: Array<TypeScriptError | LintError>;
  risk_level: RiskLevel;
}

export interface SurgeonOutput {
  patches_applied: number;
  pr_url: string | null;
  branch_name: string | null;
  changes: PatchChange[];
  skipped_files: string[];
}

export interface PatchChange {
  file: string;
  original: string;
  patched: string;
  description: string;
}

export interface ValidatorInput {
  surgery_task_id: string;
  branch_name: string;
}

export interface ValidatorOutput {
  build_success: boolean;
  type_check_success: boolean;
  lint_success: boolean;
  approved: boolean;
  rejection_reason?: string;
}

// ----------------------------
// API types
// ----------------------------
export interface DispatchRequest {
  agent: AgentName;
  taskType: string;
  priority: TaskPriority;
  input: Record<string, unknown>;
  triggeredBy?: "cron" | "alert" | "manual" | "cascade";
}

export interface DispatchResponse {
  success: boolean;
  taskId: string;
  message?: string;
}

export interface AgentStats {
  agent: AgentName;
  total: number;
  completed: number;
  failed: number;
  escalated: number;
  running: number;
  successRate: number;
  lastActivity: string | null;
}
