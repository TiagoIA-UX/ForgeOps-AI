import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { getOrgBySlug, getOrgRepos, getUserRole, getUserOrgs } from "@/lib/tenant";
import { getTasksByAgent, getAgentStats } from "@/lib/orchestrator";
import { AgentCard } from "@/app/admin/agentes/components/AgentCard";
import { TaskList } from "@/app/admin/agentes/components/TaskList";
import Link from "next/link";
import { GitBranch, Plus, Settings, LogOut, Zap } from "lucide-react";
import type { Metadata } from "next";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${slug} — ZAEA Dashboard` };
}

export const dynamic = "force-dynamic";

export default async function OrgDashboardPage({ params }: Params) {
  const { slug } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  const role = await getUserRole(user.id, org.id);
  if (!role) redirect("/dashboard");

  const [repos, stats, recentTasks, allOrgs] = await Promise.all([
    getOrgRepos(org.id),
    getAgentStats(24),
    getTasksByAgent({ hoursBack: 24, limit: 20 }),
    getUserOrgs(user.id),
  ]);

  const isOwnerOrAdmin = role === "owner" || role === "admin";

  return (
    <div className="min-h-screen bg-zaea-bg">
      {/* Sidebar */}
      <div className="flex">
        <aside className="w-60 min-h-screen bg-zaea-surface border-r border-zaea-border p-4 flex flex-col">
          {/* Logo */}
          <div className="flex items-center gap-2 mb-6 px-2">
            <Zap size={18} className="text-zaea-accent" />
            <span className="font-bold text-white text-sm">ZAEA</span>
          </div>

          {/* Org switcher */}
          <div className="mb-4">
            <p className="text-xs text-zaea-muted uppercase tracking-wider px-2 mb-2">Organização</p>
            <div className="space-y-1">
              {allOrgs.map(({ org: o }) => (
                <Link
                  key={o.id}
                  href={`/dashboard/${o.slug}`}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                    o.id === org.id
                      ? "bg-zaea-accent/20 text-white"
                      : "text-zaea-muted hover:text-white hover:bg-zaea-bg"
                  }`}
                >
                  <span className="w-5 h-5 rounded bg-zaea-accent/30 text-zaea-accent text-xs flex items-center justify-center font-bold">
                    {o.name[0].toUpperCase()}
                  </span>
                  <span className="truncate">{o.name}</span>
                </Link>
              ))}
              <Link
                href="/onboarding"
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-zaea-muted hover:text-white hover:bg-zaea-bg transition-colors"
              >
                <Plus size={14} /> Nova org
              </Link>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 space-y-1">
            <p className="text-xs text-zaea-muted uppercase tracking-wider px-2 mb-2 mt-4">Menu</p>
            <Link href={`/dashboard/${slug}`} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white bg-zaea-bg">
              📊 Dashboard
            </Link>
            <Link href={`/dashboard/${slug}/repos`} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-zaea-muted hover:text-white hover:bg-zaea-bg transition-colors">
              <GitBranch size={14} /> Repositórios
            </Link>
            {isOwnerOrAdmin && (
              <Link href={`/dashboard/${slug}/settings`} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-zaea-muted hover:text-white hover:bg-zaea-bg transition-colors">
                <Settings size={14} /> Configurações
              </Link>
            )}
          </nav>

          {/* User + logout */}
          <div className="mt-auto border-t border-zaea-border pt-4 space-y-2">
            <p className="text-xs text-zaea-muted truncate px-2">
              {user.user_metadata?.full_name ?? user.email}
            </p>
            <form action="/auth/signout" method="POST">
              <button
                type="submit"
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-zaea-muted hover:text-white hover:bg-zaea-bg transition-colors w-full"
              >
                <LogOut size={14} /> Sair
              </button>
            </form>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 p-8 space-y-8 overflow-auto">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">{org.name}</h1>
              <p className="text-sm text-zaea-muted">
                Plano <span className="text-white capitalize">{org.plan}</span> ·{" "}
                {repos.length}/{org.max_repos} repo{org.max_repos !== 1 ? "s" : ""}
              </p>
            </div>
            {isOwnerOrAdmin && repos.length < org.max_repos && (
              <Link
                href={`/dashboard/${slug}/repos/connect`}
                className="flex items-center gap-2 px-4 py-2 bg-zaea-accent hover:bg-zaea-accent-hover rounded-lg text-sm font-medium text-white transition-colors"
              >
                <Plus size={14} /> Conectar repo
              </Link>
            )}
          </div>

          {/* Repos cards */}
          {repos.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-zaea-border rounded-xl space-y-4">
              <GitBranch size={32} className="text-zaea-muted mx-auto" />
              <p className="text-zaea-muted text-sm">Nenhum repositório conectado ainda.</p>
              {isOwnerOrAdmin && (
                <Link
                  href={`/dashboard/${slug}/repos/connect`}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-zaea-accent hover:bg-zaea-accent-hover rounded-lg text-sm font-medium text-white transition-colors"
                >
                  <Plus size={14} /> Conectar repositório
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {repos.map((repo) => (
                <div key={repo.id} className="p-4 bg-zaea-surface border border-zaea-border rounded-xl space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-white text-sm font-mono">
                        {repo.github_owner}/{repo.github_repo}
                      </p>
                      <p className="text-xs text-zaea-muted">branch: {repo.github_branch}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${repo.is_active ? "bg-zaea-success/10 text-zaea-success" : "bg-zaea-muted/10 text-zaea-muted"}`}>
                      {repo.is_active ? "Ativo" : "Pausado"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zaea-muted">
                    <span>Scan a cada {repo.scan_interval} min</span>
                    {repo.last_scan_at && (
                      <span>
                        Último scan:{" "}
                        {new Date(repo.last_scan_at).toLocaleString("pt-BR", {
                          day: "2-digit", month: "2-digit",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    )}
                  </div>
                  {repo.last_error && (
                    <p className="text-xs text-zaea-danger truncate">{repo.last_error}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Agent health */}
          <section>
            <h2 className="text-sm font-semibold text-zaea-muted uppercase tracking-wider mb-3">
              Saúde dos Agentes — últimas 24h
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {stats.map((s) => (
                <AgentCard key={s.agent} stats={s} />
              ))}
            </div>
          </section>

          {/* Recent tasks */}
          <section>
            <h2 className="text-sm font-semibold text-zaea-muted uppercase tracking-wider mb-3">
              Tarefas recentes
            </h2>
            <TaskList tasks={recentTasks} />
          </section>
        </main>
      </div>
    </div>
  );
}
