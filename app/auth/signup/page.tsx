"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { Loader2, Zap, CheckCircle } from "lucide-react";

export default function SignupPage() {
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (password.length < 8) {
      setError("Senha deve ter ao menos 8 caracteres");
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setDone(true);
    setLoading(false);
  }

  async function handleGitHub() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${location.origin}/auth/callback`,
        scopes: "read:user user:email repo",
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-forge-bg flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center space-y-4">
          <CheckCircle size={48} className="text-forge-success mx-auto" />
          <h2 className="text-xl font-bold text-white">Confirme seu e-mail</h2>
          <p className="text-sm text-forge-muted">
            Enviamos um link para <span className="text-white">{email}</span>.
            Clique nele para ativar sua conta.
          </p>
          <Link href="/auth/login" className="text-sm text-forge-accent hover:underline">
            Voltar ao login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-forge-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-forge-accent/20 border border-forge-accent/30">
            <Zap size={24} className="text-forge-accent" />
          </div>
          <h1 className="text-2xl font-bold text-white">Criar conta grátis</h1>
          <p className="text-sm text-forge-muted">1 repo, monitoramento a cada hora</p>
        </div>

        <div className="bg-forge-surface border border-forge-border rounded-xl p-6 space-y-5">
          {/* Google */}
          <button
            onClick={handleGoogle}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-forge-border hover:border-forge-accent/50 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Cadastrar com Google
          </button>

          {/* GitHub */}
          <button
            onClick={handleGitHub}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-forge-border hover:border-forge-accent/50 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.54-1.38-1.33-1.75-1.33-1.75-1.08-.74.08-.73.08-.73 1.2.08 1.83 1.23 1.83 1.23 1.06 1.82 2.79 1.29 3.47.99.11-.77.41-1.29.75-1.59-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02.005 2.04.14 3 .4 2.29-1.55 3.29-1.23 3.29-1.23.65 1.65.24 2.87.12 3.17.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.21.7.83.58C20.57 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Cadastrar com GitHub
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-forge-border" />
            </div>
            <div className="relative text-center">
              <span className="bg-forge-surface px-3 text-xs text-forge-muted">ou com e-mail</span>
            </div>
          </div>

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-forge-muted mb-1.5">Nome</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome"
                className="w-full bg-forge-bg border border-forge-border rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-forge-muted focus:outline-none focus:border-forge-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-forge-muted mb-1.5">E-mail</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
                className="w-full bg-forge-bg border border-forge-border rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-forge-muted focus:outline-none focus:border-forge-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-forge-muted mb-1.5">Senha</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className="w-full bg-forge-bg border border-forge-border rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-forge-muted focus:outline-none focus:border-forge-accent transition-colors"
              />
            </div>

            {error && (
              <p className="text-xs text-forge-danger border border-forge-danger/30 bg-forge-danger/10 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-forge-accent hover:bg-forge-accent-hover disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              Criar conta
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-forge-muted">
          Já tem conta?{" "}
          <Link href="/auth/login" className="text-forge-accent hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
