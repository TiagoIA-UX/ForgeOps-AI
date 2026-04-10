"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Loader2, Save, CheckCircle, AlertCircle, Eye, EyeOff,
  Github, Bot, Zap, Settings, ChevronRight, ShieldCheck,
} from "lucide-react";
import Link from "next/link";

interface ConfigState {
  github_token:       string;
  github_repo_owner:  string;
  github_repo_name:   string;
  groq_api_key:       string;
  telegram_bot_token: string;
  telegram_chat_id:   string;
  notify_email:       string;
  auto_fix_enabled:   boolean;
  max_fixes_per_run:  number;
  risk_level_allowed: "SAFE" | "MODERATE" | "RISKY";
  notify_on_fix:      boolean;
  notify_on_error:    boolean;
  setup_completed:    boolean;
  has_github_token:   boolean;
  has_groq_key:       boolean;
  has_telegram_token: boolean;
}

const EMPTY: ConfigState = {
  github_token: "", github_repo_owner: "", github_repo_name: "",
  groq_api_key: "", telegram_bot_token: "", telegram_chat_id: "",
  notify_email: "", auto_fix_enabled: false, max_fixes_per_run: 5,
  risk_level_allowed: "SAFE", notify_on_fix: true, notify_on_error: true,
  setup_completed: false, has_github_token: false, has_groq_key: false,
  has_telegram_token: false,
};

function SecretInput({
  label, value, onChange, placeholder, helpUrl, helpLabel, saved,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder: string; helpUrl: string; helpLabel: string; saved?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-zaea-muted">{label}</label>
        <a href={helpUrl} target="_blank" rel="noopener noreferrer"
          className="text-xs text-zaea-accent hover:underline">{helpLabel} →</a>
      </div>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={saved ? "──── já salvo, cole novo para substituir ────" : placeholder}
          className="w-full bg-zaea-bg border border-zaea-border rounded-lg px-3 py-2.5 pr-10 text-sm text-white placeholder:text-zaea-muted/50 focus:outline-none focus:border-zaea-accent transition-colors font-mono"
        />
        <button type="button" onClick={() => setShow(!show)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-zaea-muted hover:text-white">
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {saved && (
        <p className="text-xs text-zaea-success flex items-center gap-1">
          <CheckCircle size={11} /> Credencial salva
        </p>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();

  const [config, setConfig] = useState<ConfigState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orgs/${slug}/settings`);
      if (res.status === 401) { router.push("/auth/login"); return; }
      if (res.status === 403) { router.push(`/dashboard/${slug}`); return; }
      const data = await res.json();
      setConfig({ ...EMPTY, ...data });
    } catch {
      setError("Erro ao carregar configurações");
    } finally {
      setLoading(false);
    }
  }, [slug, router]);

  useEffect(() => { load(); }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch(`/api/orgs/${slug}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          github_token:       config.github_token       || undefined,
          github_repo_owner:  config.github_repo_owner  || undefined,
          github_repo_name:   config.github_repo_name   || undefined,
          groq_api_key:       config.groq_api_key        || undefined,
          telegram_bot_token: config.telegram_bot_token  || undefined,
          telegram_chat_id:   config.telegram_chat_id    || undefined,
          notify_email:       config.notify_email        || undefined,
          auto_fix_enabled:   config.auto_fix_enabled,
          max_fixes_per_run:  config.max_fixes_per_run,
          risk_level_allowed: config.risk_level_allowed,
          notify_on_fix:      config.notify_on_fix,
          notify_on_error:    config.notify_on_error,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao salvar");
      setSaved(true);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof ConfigState>(k: K, v: ConfigState[K]) {
    setConfig((c) => ({ ...c, [k]: v }));
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zaea-bg flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-zaea-accent" />
      </div>
    );
  }

  const setupSteps = [
    { label: "Token GitHub",  done: config.has_github_token,   icon: <Github size={14} /> },
    { label: "Chave Groq AI", done: config.has_groq_key,       icon: <Zap size={14} /> },
    { label: "Bot Telegram",  done: config.has_telegram_token, icon: <Bot size={14} /> },
  ];
  const setupProgress = setupSteps.filter((s) => s.done).length;

  return (
    <div className="min-h-screen bg-zaea-bg">
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-zaea-muted">
          <Link href={`/dashboard/${slug}`} className="hover:text-white transition-colors">{slug}</Link>
          <ChevronRight size={14} />
          <span className="text-white">Configurações dos agentes</span>
        </div>

        {/* Setup progress */}
        <div className={`p-4 rounded-xl border ${config.setup_completed ? "border-zaea-success/30 bg-zaea-success/5" : "border-zaea-warning/30 bg-zaea-warning/5"}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className={config.setup_completed ? "text-zaea-success" : "text-zaea-warning"} />
              <span className="text-sm font-semibold text-white">
                {config.setup_completed ? "Agentes prontos para funcionar!" : `Configure os agentes (${setupProgress}/3)`}
              </span>
            </div>
            <span className="text-xs text-zaea-muted">{Math.round((setupProgress / 3) * 100)}%</span>
          </div>
          <div className="flex gap-3">
            {setupSteps.map(({ label, done, icon }) => (
              <div key={label} className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg ${done ? "bg-zaea-success/10 text-zaea-success" : "bg-zaea-muted/10 text-zaea-muted"}`}>
                {icon} {label} {done ? "✓" : "—"}
              </div>
            ))}
          </div>
          {!config.setup_completed && (
            <p className="text-xs text-zaea-muted mt-2">
              Preencha os campos abaixo para ativar Scanner, Surgeon, Validator e Sentinel.
            </p>
          )}
        </div>

        {/* Error / success */}
        {error && (
          <div className="flex items-center gap-2 bg-zaea-danger/10 border border-zaea-danger/30 rounded-lg px-4 py-3 text-sm text-zaea-danger">
            <AlertCircle size={14} /> {error}
          </div>
        )}
        {saved && (
          <div className="flex items-center gap-2 bg-zaea-success/10 border border-zaea-success/30 rounded-lg px-4 py-3 text-sm text-zaea-success">
            <CheckCircle size={14} /> Configurações salvas com sucesso!
          </div>
        )}

        {/* FORM */}
        <form onSubmit={handleSave} className="space-y-6">

          {/* ── GitHub ─────────────────────────────────── */}
          <section className="bg-zaea-surface border border-zaea-border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Github size={16} className="text-white" />
              <h2 className="font-semibold text-white text-sm">GitHub</h2>
              <span className="text-xs text-zaea-danger ml-1">obrigatório</span>
            </div>
            <p className="text-xs text-zaea-muted -mt-2">
              Usado pelo Scanner para ler o código e pelo Surgeon para abrir Pull Requests.
            </p>
            <SecretInput
              label="Personal Access Token (PAT)"
              value={config.github_token}
              onChange={(v) => set("github_token", v)}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              helpUrl="https://github.com/settings/tokens/new?scopes=repo,read:user"
              helpLabel="Gerar no GitHub"
              saved={config.has_github_token}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zaea-muted">Dono do repo (owner)</label>
                <input
                  value={config.github_repo_owner}
                  onChange={(e) => set("github_repo_owner", e.target.value)}
                  placeholder="seu-usuario"
                  className="w-full bg-zaea-bg border border-zaea-border rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zaea-muted focus:outline-none focus:border-zaea-accent transition-colors font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zaea-muted">Nome do repositório</label>
                <input
                  value={config.github_repo_name}
                  onChange={(e) => set("github_repo_name", e.target.value)}
                  placeholder="meu-projeto"
                  className="w-full bg-zaea-bg border border-zaea-border rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zaea-muted focus:outline-none focus:border-zaea-accent transition-colors font-mono"
                />
              </div>
            </div>
          </section>

          {/* ── Groq AI ────────────────────────────────── */}
          <section className="bg-zaea-surface border border-zaea-border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap size={16} className="text-zaea-accent" />
              <h2 className="font-semibold text-white text-sm">Groq AI</h2>
              <span className="text-xs text-zaea-danger ml-1">obrigatório</span>
            </div>
            <p className="text-xs text-zaea-muted -mt-2">
              Alimenta o Scanner e o Surgeon com o modelo llama-3.3-70b. Plano gratuito do Groq é suficiente.
            </p>
            <SecretInput
              label="Groq API Key"
              value={config.groq_api_key}
              onChange={(v) => set("groq_api_key", v)}
              placeholder="gsk_xxxxxxxxxxxxxxxxxxxx"
              helpUrl="https://console.groq.com/keys"
              helpLabel="Gerar no Groq"
              saved={config.has_groq_key}
            />
          </section>

          {/* ── Telegram ───────────────────────────────── */}
          <section className="bg-zaea-surface border border-zaea-border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Bot size={16} className="text-blue-400" />
              <h2 className="font-semibold text-white text-sm">Telegram (Sentinel)</h2>
              <span className="text-xs text-zaea-muted ml-1">opcional</span>
            </div>
            <p className="text-xs text-zaea-muted -mt-2">
              O Sentinel envia alertas quando um erro grave é detectado ou um patch é aplicado.
            </p>
            <SecretInput
              label="Bot Token"
              value={config.telegram_bot_token}
              onChange={(v) => set("telegram_bot_token", v)}
              placeholder="123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              helpUrl="https://t.me/BotFather"
              helpLabel="Criar bot no @BotFather"
              saved={config.has_telegram_token}
            />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zaea-muted">Chat ID</label>
              <input
                value={config.telegram_chat_id}
                onChange={(e) => set("telegram_chat_id", e.target.value)}
                placeholder="-100123456789 (grupo) ou 123456789 (pessoal)"
                className="w-full bg-zaea-bg border border-zaea-border rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zaea-muted focus:outline-none focus:border-zaea-accent transition-colors font-mono"
              />
              <p className="text-xs text-zaea-muted">
                Obter via{" "}
                <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" className="text-zaea-accent hover:underline">
                  @userinfobot
                </a>{" "}
                no Telegram.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zaea-muted">E-mail de notificações (opcional)</label>
              <input
                type="email"
                value={config.notify_email}
                onChange={(e) => set("notify_email", e.target.value)}
                placeholder="dev@empresa.com"
                className="w-full bg-zaea-bg border border-zaea-border rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zaea-muted focus:outline-none focus:border-zaea-accent transition-colors"
              />
            </div>
          </section>

          {/* ── Comportamento dos agentes ───────────────── */}
          <section className="bg-zaea-surface border border-zaea-border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Settings size={16} className="text-zaea-muted" />
              <h2 className="font-semibold text-white text-sm">Comportamento dos Agentes</h2>
            </div>

            <div className="flex items-center justify-between py-2 border-b border-zaea-border">
              <div>
                <p className="text-sm text-white">Auto-fix ativado</p>
                <p className="text-xs text-zaea-muted">O Surgeon aplica patches automaticamente</p>
              </div>
              <button
                type="button"
                onClick={() => set("auto_fix_enabled", !config.auto_fix_enabled)}
                className={`relative inline-flex w-10 h-5 rounded-full transition-colors ${config.auto_fix_enabled ? "bg-zaea-accent" : "bg-zaea-border"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${config.auto_fix_enabled ? "translate-x-5" : ""}`} />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zaea-muted">
                Nível de risco permitido para auto-fix
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(["SAFE", "MODERATE", "RISKY"] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => set("risk_level_allowed", level)}
                    className={`py-2 rounded-lg text-xs font-medium border transition-colors ${
                      config.risk_level_allowed === level
                        ? level === "SAFE"   ? "bg-zaea-success/20 border-zaea-success text-zaea-success"
                          : level === "MODERATE" ? "bg-zaea-warning/20 border-zaea-warning text-zaea-warning"
                          : "bg-zaea-danger/20 border-zaea-danger text-zaea-danger"
                        : "border-zaea-border text-zaea-muted hover:border-zaea-accent/50"
                    }`}
                  >
                    {level === "SAFE" ? "🟢 Seguro" : level === "MODERATE" ? "🟡 Moderado" : "🔴 Arriscado"}
                  </button>
                ))}
              </div>
              <p className="text-xs text-zaea-muted">
                <strong className="text-white">Seguro</strong> = apenas fixes óbvios de tipagem/lint • <strong className="text-white">Moderado</strong> = inclui lógica simples • <strong className="text-white">Arriscado</strong> = qualquer erro (não recomendado)
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zaea-muted">
                Máximo de fixes por execução ({config.max_fixes_per_run})
              </label>
              <input type="range" min={1} max={20} value={config.max_fixes_per_run}
                onChange={(e) => set("max_fixes_per_run", Number(e.target.value))}
                className="w-full accent-zaea-accent" />
              <div className="flex justify-between text-xs text-zaea-muted">
                <span>1 (conservador)</span><span>20 (agressivo)</span>
              </div>
            </div>

            <div className="flex items-center justify-between py-2 border-t border-zaea-border">
              <div>
                <p className="text-sm text-white">Notificar ao aplicar fix</p>
              </div>
              <button type="button" onClick={() => set("notify_on_fix", !config.notify_on_fix)}
                className={`relative inline-flex w-10 h-5 rounded-full transition-colors ${config.notify_on_fix ? "bg-zaea-accent" : "bg-zaea-border"}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${config.notify_on_fix ? "translate-x-5" : ""}`} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white">Notificar ao detectar erro</p>
              </div>
              <button type="button" onClick={() => set("notify_on_error", !config.notify_on_error)}
                className={`relative inline-flex w-10 h-5 rounded-full transition-colors ${config.notify_on_error ? "bg-zaea-accent" : "bg-zaea-border"}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${config.notify_on_error ? "translate-x-5" : ""}`} />
              </button>
            </div>
          </section>

          {/* Salvar */}
          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-zaea-accent hover:bg-zaea-accent/90 disabled:opacity-50 rounded-xl text-sm font-semibold text-white transition-colors"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? "Salvando…" : "Salvar configurações"}
          </button>
        </form>
      </div>
    </div>
  );
}
