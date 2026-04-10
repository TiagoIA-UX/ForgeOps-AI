"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Loader2, GitBranch, ArrowLeft, Search } from "lucide-react";
import Link from "next/link";

interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
  description: string | null;
}

export default function ConnectRepoPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [githubToken, setGithubToken] = useState("");
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFetchRepos() {
    if (!githubToken.trim()) return;
    setLoadingRepos(true);
    setError(null);
    setRepos([]);
    setSelectedRepo(null);

    try {
      const res = await fetch(
        "https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator",
        {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github+json",
          },
        }
      );
      if (!res.ok) throw new Error("Token inválido ou sem permissão de acesso");
      const data: GitHubRepo[] = await res.json();
      setRepos(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao buscar repositórios");
    } finally {
      setLoadingRepos(false);
    }
  }

  async function handleConnect() {
    if (!selectedRepo) return;
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/orgs/${slug}/repos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        github_owner: selectedRepo.owner.login,
        github_repo: selectedRepo.name,
        github_branch: selectedRepo.default_branch,
        github_repo_id: selectedRepo.id,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Erro ao conectar repositório");
      setLoading(false);
      return;
    }

    router.push(`/dashboard/${slug}`);
  }

  return (
    <div className="min-h-screen bg-forge-bg flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <Link
            href={`/dashboard/${slug}`}
            className="inline-flex items-center gap-1 text-sm text-forge-muted hover:text-white transition-colors"
          >
            <ArrowLeft size={14} /> Voltar ao dashboard
          </Link>
          <h1 className="text-2xl font-bold text-white">Conectar repositório</h1>
          <p className="text-sm text-forge-muted">
            O ForgeOps AI vai monitorar e corrigir este repo automaticamente.
          </p>
        </div>

        <div className="bg-forge-surface border border-forge-border rounded-xl p-6 space-y-5">
          {/* Token input */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-forge-muted">
              GitHub Personal Access Token{" "}
              <a
                href="https://github.com/settings/tokens/new?scopes=repo"
                target="_blank"
                rel="noopener noreferrer"
                className="text-forge-accent hover:underline"
              >
                Gerar token →
              </a>
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleFetchRepos()}
                placeholder="ghp_..."
                className="flex-1 bg-forge-bg border border-forge-border rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-forge-muted focus:outline-none focus:border-forge-accent transition-colors font-mono"
              />
              <button
                onClick={handleFetchRepos}
                disabled={loadingRepos || !githubToken.trim()}
                className="flex items-center gap-2 px-4 py-2.5 bg-forge-accent hover:bg-forge-accent/90 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
              >
                {loadingRepos ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Buscar
              </button>
            </div>
          </div>

          {/* Repo list */}
          {repos.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-forge-muted">
                Selecione um repositório ({repos.length} encontrados)
              </label>
              <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                {repos.map((repo) => (
                  <button
                    key={repo.id}
                    onClick={() => setSelectedRepo(repo)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                      selectedRepo?.id === repo.id
                        ? "border-forge-accent bg-forge-accent/10 text-white"
                        : "border-forge-border hover:border-forge-accent/50 text-forge-muted hover:text-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <GitBranch size={12} className="shrink-0" />
                        <span className="font-mono truncate">{repo.full_name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-forge-muted">{repo.default_branch}</span>
                        {repo.private && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-forge-warning/10 text-forge-warning">
                            privado
                          </span>
                        )}
                      </div>
                    </div>
                    {repo.description && (
                      <p className="text-xs text-forge-muted mt-1 truncate">{repo.description}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-forge-danger border border-forge-danger/30 bg-forge-danger/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Connect button */}
          <button
            onClick={handleConnect}
            disabled={!selectedRepo || loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-forge-accent hover:bg-forge-accent/90 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {selectedRepo
              ? `Conectar ${selectedRepo.full_name}`
              : "Selecione um repositório"}
          </button>
        </div>
      </div>
    </div>
  );
}
