import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { getOrgBySlug, getOrgRepos, getUserRole } from "@/lib/tenant";
import Link from "next/link";
import { GitBranch, Plus, CheckCircle, XCircle, Clock } from "lucide-react";
import type { Metadata } from "next";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Repositórios — ${slug} — ForgeOps AI` };
}

export const dynamic = "force-dynamic";

export default async function ReposPage({ params }: Params) {
  const { slug } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  const role = await getUserRole(user.id, org.id);
  if (!role) redirect("/dashboard");

  const repos = await getOrgRepos(org.id);
  const isOwnerOrAdmin = role === "owner" || role === "admin";
  const canAddMore = repos.length < org.max_repos;

  return (
    <div className="min-h-screen bg-forge-bg p-8 max-w-4xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <div className="text-sm text-forge-muted flex items-center gap-2">
        <Link href={`/dashboard/${slug}`} className="hover:text-white transition-colors">
          {org.name}
        </Link>
        <span>/</span>
        <span className="text-white">Repositórios</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Repositórios</h1>
          <p className="text-sm text-forge-muted">
            {repos.length}/{org.max_repos} repositório{org.max_repos !== 1 ? "s" : ""} conectado{repos.length !== 1 ? "s" : ""}
          </p>
        </div>
        {isOwnerOrAdmin && canAddMore && (
          <Link
            href={`/dashboard/${slug}/repos/connect`}
            className="flex items-center gap-2 px-4 py-2 bg-forge-accent hover:bg-forge-accent/90 rounded-lg text-sm font-medium text-white transition-colors"
          >
            <Plus size={14} /> Conectar repo
          </Link>
        )}
      </div>

      {/* Lista */}
      {repos.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-forge-border rounded-xl space-y-4">
          <GitBranch size={36} className="text-forge-muted mx-auto" />
          <p className="text-forge-muted">Nenhum repositório conectado ainda.</p>
          {isOwnerOrAdmin && (
            <Link
              href={`/dashboard/${slug}/repos/connect`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-forge-accent hover:bg-forge-accent/90 rounded-lg text-sm font-medium text-white transition-colors"
            >
              <Plus size={14} /> Conectar repositório
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {repos.map((repo) => (
            <div
              key={repo.id}
              className="p-5 bg-forge-surface border border-forge-border rounded-xl flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3 min-w-0">
                <GitBranch size={16} className="text-forge-accent shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold text-white font-mono text-sm truncate">
                    {repo.github_owner}/{repo.github_repo}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-forge-muted">
                    <span>branch: <span className="text-white">{repo.github_branch}</span></span>
                    <span>scan: <span className="text-white">{repo.scan_interval} min</span></span>
                    {repo.last_scan_at && (
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {new Date(repo.last_scan_at).toLocaleString("pt-BR")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {repo.is_active ? (
                  <span className="flex items-center gap-1 text-xs text-forge-success bg-forge-success/10 px-2 py-1 rounded-full">
                    <CheckCircle size={12} /> Ativo
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-forge-muted bg-forge-muted/10 px-2 py-1 rounded-full">
                    <XCircle size={12} /> Inativo
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Limite atingido */}
      {isOwnerOrAdmin && !canAddMore && (
        <div className="p-4 border border-forge-warning/30 bg-forge-warning/10 rounded-xl text-sm text-forge-warning">
          Limite de {org.max_repos} repositório{org.max_repos !== 1 ? "s" : ""} atingido no plano{" "}
          <span className="capitalize font-semibold">{org.plan}</span>.{" "}
          <Link href={`/pricing?org=${slug}`} className="underline hover:text-white transition-colors">
            Fazer upgrade →
          </Link>
        </div>
      )}
    </div>
  );
}
