"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, GitBranch, Building2, CheckCircle, ArrowRight } from "lucide-react";

type Step = "org" | "repo" | "done";

interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
  description: string | null;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("org");

  // Org step
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [orgSlugFinal, setOrgSlugFinal] = useState("");

  // Repo step
  const [githubToken, setGithubToken] = useState("");
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-gera slug a partir do nome
  function handleNameChange(value: string) {
    setOrgName(value);
    setOrgSlug(
      value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    );
  }

  async function handleCreateOrg(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: orgName, slug: orgSlug }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      setLoading(false);
      return;
    }

    setOrgSlugFinal(orgSlug);
    setStep("repo");
    setLoading(false);
  }

  async function handleFetchRepos() {
    if (!githubToken) return;
    setLoadingRepos(true);
    setError(null);

    try {
      const res = await fetch("https://api.github.com/user/repos?per_page=100&sort=pushed", {
        headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error("Token inválido ou sem permissão");
      const data: GitHubRepo[] = await res.json();
      setRepos(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao buscar repos");
    } finally {
      setLoadingRepos(false);
    }
  }

  async function handleConnectRepo() {
    if (!selectedRepo || !orgSlugFinal) return;
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/orgs/${orgSlugFinal}/repos`, {
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
      setError(data.error);
      setLoading(false);
      return;
    }

    setStep("done");
    setLoading(false);
  }

  if (step === "done") {
    return (
      <div className="min-h-screen bg-forge-bg flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <CheckCircle size={56} className="text-forge-success mx-auto" />
          <h2 className="text-2xl font-bold text-white">Organização criada!</h2>
          <p className="text-forge-muted text-sm">
            Repo <span className="text-white font-mono">{selectedRepo?.full_name}</span> conectado.
            Agora escolha seu plano e configure os agentes.
          </p>
          <div className="space-y-3">
            <button
              onClick={() => router.push(`/pricing?org=${orgSlugFinal}`)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-forge-accent hover:bg-forge-accent-hover rounded-lg font-medium text-sm text-white transition-colors"
            >
              Ver planos e preços <ArrowRight size={14} />
            </button>
            <button
              onClick={() => router.push(`/dashboard/${orgSlugFinal}/settings`)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-forge-border hover:border-forge-accent/50 rounded-lg font-medium text-sm text-forge-muted transition-colors"
            >
              Configurar agentes agora <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-forge-bg flex items-center justify-center p-4">
      <div className="max-w-lg w-full space-y-6">
        {/* Progress */}
        <div className="flex items-center gap-2 text-xs text-forge-muted">
          <span className={step === "org" ? "text-white font-semibold" : "text-forge-success"}>
            1. Organização
          </span>
          <div className="flex-1 h-px bg-forge-border" />
          <span className={step === "repo" ? "text-white font-semibold" : ""}>
            2. Repositório
          </span>
        </div>

        {/* Step 1 — criar org */}
        {step === "org" && (
          <div className="bg-forge-surface border border-forge-border rounded-xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <Building2 size={20} className="text-forge-accent" />
              <div>
                <h2 className="font-bold text-white">Criar sua organização</h2>
                <p className="text-xs text-forge-muted">Essa é a sua conta no ForgeOps AI</p>
              </div>
            </div>

            <form onSubmit={handleCreateOrg} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-forge-muted mb-1.5">
                  Nome da organização
                </label>
                <input
                  required
                  value={orgName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Acme Corp"
                  className="w-full bg-forge-bg border border-forge-border rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-forge-muted focus:outline-none focus:border-forge-accent transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-forge-muted mb-1.5">
                  Identificador (URL)
                </label>
                <div className="flex items-center bg-forge-bg border border-forge-border rounded-lg overflow-hidden focus-within:border-forge-accent transition-colors">
                  <span className="px-3 text-xs text-forge-muted border-r border-forge-border py-2.5">
                    ForgeOps AI.app/
                  </span>
                  <input
                    required
                    value={orgSlug}
                    onChange={(e) => setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="ForgeOps"
                    pattern="[a-z0-9-]+"
                    className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none"
                  />
                </div>
              </div>

              {error && (
                <p className="text-xs text-forge-danger border border-forge-danger/30 bg-forge-danger/10 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !orgName || !orgSlug}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-forge-accent hover:bg-forge-accent-hover disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
              >
                {loading && <Loader2 size={14} className="animate-spin" />}
                Criar organização <ArrowRight size={14} />
              </button>
            </form>
          </div>
        )}

        {/* Step 2 — conectar repo */}
        {step === "repo" && (
          <div className="bg-forge-surface border border-forge-border rounded-xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <GitBranch size={20} className="text-forge-accent" />
              <div>
                <h2 className="font-bold text-white">Conectar repositório</h2>
                <p className="text-xs text-forge-muted">
                  O ForgeOps AI vai monitorar e corrigir este repo automaticamente
                </p>
              </div>
            </div>

            {/* GitHub token */}
            <div>
              <label className="block text-xs font-medium text-forge-muted mb-1.5">
                GitHub Personal Access Token
                <a
                  href="https://github.com/settings/tokens/new?scopes=repo"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-forge-accent hover:underline"
                >
                  Gerar token →
                </a>
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="ghp_..."
                  className="flex-1 bg-forge-bg border border-forge-border rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-forge-muted focus:outline-none focus:border-forge-accent transition-colors"
                />
                <button
                  onClick={handleFetchRepos}
                  disabled={!githubToken || loadingRepos}
                  className="px-4 py-2.5 border border-forge-border hover:border-forge-accent/50 rounded-lg text-sm text-white disabled:opacity-50 transition-colors"
                >
                  {loadingRepos ? <Loader2 size={14} className="animate-spin" /> : "Buscar"}
                </button>
              </div>
            </div>

            {/* Repos list */}
            {repos.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {repos.map((repo) => (
                  <button
                    key={repo.id}
                    onClick={() => setSelectedRepo(repo)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedRepo?.id === repo.id
                        ? "border-forge-accent bg-forge-accent/10"
                        : "border-forge-border hover:border-forge-accent/30"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white font-mono">{repo.full_name}</span>
                      <span className="text-xs text-forge-muted">
                        {repo.private ? "🔒 privado" : "🌐 público"}
                      </span>
                    </div>
                    {repo.description && (
                      <p className="text-xs text-forge-muted mt-0.5 truncate">{repo.description}</p>
                    )}
                    <p className="text-xs text-forge-muted mt-0.5">branch: {repo.default_branch}</p>
                  </button>
                ))}
              </div>
            )}

            {error && (
              <p className="text-xs text-forge-danger border border-forge-danger/30 bg-forge-danger/10 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              onClick={handleConnectRepo}
              disabled={!selectedRepo || loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-forge-accent hover:bg-forge-accent-hover disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              Conectar {selectedRepo ? selectedRepo.name : "repo"} <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
