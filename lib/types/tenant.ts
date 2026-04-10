// ======================================================
// ZAEA — Tipos Multi-tenant SaaS
// ======================================================

export type OrgPlan = "free" | "starter" | "pro" | "enterprise";
export type MemberRole = "owner" | "admin" | "member" | "viewer";

export const PLAN_LIMITS: Record<OrgPlan, { repos: number; members: number; intervalMin: number }> = {
  free:       { repos: 1,  members: 3,  intervalMin: 60 },
  starter:    { repos: 3,  members: 10, intervalMin: 15 },
  pro:        { repos: 10, members: 25, intervalMin: 10 },
  enterprise: { repos: 999,members: 999,intervalMin: 5  },
};

export interface Organization {
  id: string;
  slug: string;
  name: string;
  plan: OrgPlan;
  max_repos: number;
  max_members: number;
  repos_count: number;
  // Mercado Pago billing
  mp_payer_email: string | null;
  mp_subscription_id: string | null;
  mp_subscription_status: "authorized" | "paused" | "cancelled" | "pending" | null;
  mp_plan: string | null;
  mp_next_payment_at: string | null;
  trial_ends_at: string | null;
  avatar_url: string | null;
  website: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  id: string;
  org_id: string;
  user_id: string;
  role: MemberRole;
  invited_by: string | null;
  accepted_at: string | null;
  created_at: string;
}

export interface ConnectedRepo {
  id: string;
  org_id: string;
  github_repo_id: number;
  github_owner: string;
  github_repo: string;
  github_branch: string;
  installation_id: number | null;
  scan_interval: number;
  auto_fix: boolean;
  notify_telegram: boolean;
  telegram_chat_id: string | null;
  is_active: boolean;
  last_scan_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

// Context do usuário autenticado
export interface UserContext {
  userId: string;
  email: string;
  orgs: Array<{
    org: Organization;
    role: MemberRole;
  }>;
  currentOrg: Organization | null;
}
