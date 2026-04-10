// ======================================================
// ZAEA — lib/tenant.ts
// Funções de acesso a orgs, membros e repos por usuário
// ======================================================

import { createAdminClient } from "@/lib/supabase/admin";
import type { Organization, ConnectedRepo, MemberRole } from "@/lib/types/tenant";

const supabase = createAdminClient();

// ----------------------------
// getUserOrgs — orgs do usuário autenticado
// ----------------------------
export async function getUserOrgs(userId: string): Promise<
  Array<{ org: Organization; role: MemberRole }>
> {
  const { data, error } = await supabase
    .from("org_members")
    .select("role, organizations(*)")
    .eq("user_id", userId)
    .not("accepted_at", "is", null);

  if (error || !data) return [];

  return data.map((row) => ({
    org: row.organizations as unknown as Organization,
    role: row.role as MemberRole,
  }));
}

// ----------------------------
// getOrgBySlug
// ----------------------------
export async function getOrgBySlug(slug: string): Promise<Organization | null> {
  const { data } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  return data ?? null;
}

// ----------------------------
// createOrg — cria org e torna o usuário owner
// ----------------------------
export async function createOrg(params: {
  slug: string;
  name: string;
  userId: string;
}): Promise<{ orgId: string } | { error: string }> {
  const { slug, name, userId } = params;

  // Verifica se slug já existe
  const existing = await getOrgBySlug(slug);
  if (existing) return { error: "Este identificador já está em uso." };

  const { data, error } = await supabase.rpc("create_organization", {
    p_slug: slug,
    p_name: name,
    p_user_id: userId,
  });

  if (error) return { error: error.message };
  return { orgId: data as string };
}

// ----------------------------
// getOrgRepos
// ----------------------------
export async function getOrgRepos(orgId: string): Promise<ConnectedRepo[]> {
  const { data, error } = await supabase
    .from("connected_repos")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) return [];
  return data ?? [];
}

// ----------------------------
// connectRepo — conecta um repo GitHub à org
// ----------------------------
export async function connectRepo(params: {
  orgId: string;
  githubOwner: string;
  githubRepo: string;
  githubBranch?: string;
  githubRepoId: number;
  installationId?: number;
}): Promise<{ repoId: string } | { error: string }> {
  const {
    orgId,
    githubOwner,
    githubRepo,
    githubBranch = "main",
    githubRepoId,
    installationId,
  } = params;

  // Verifica limite do plano
  const { data: org } = await supabase
    .from("organizations")
    .select("max_repos, repos_count")
    .eq("id", orgId)
    .single();

  if (org && org.repos_count >= org.max_repos) {
    return { error: `Limite de ${org.max_repos} repo(s) atingido para seu plano.` };
  }

  const { data, error } = await supabase
    .from("connected_repos")
    .insert({
      org_id: orgId,
      github_repo_id: githubRepoId,
      github_owner: githubOwner,
      github_repo: githubRepo,
      github_branch: githubBranch,
      installation_id: installationId ?? null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Incrementa contador
  await supabase.rpc("increment_repos_count", { p_org_id: orgId });

  return { repoId: data.id };
}

// ----------------------------
// getUserRole — papel do usuário na org
// ----------------------------
export async function getUserRole(
  userId: string,
  orgId: string
): Promise<MemberRole | null> {
  const { data } = await supabase
    .from("org_members")
    .select("role")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .maybeSingle();

  return (data?.role as MemberRole) ?? null;
}
