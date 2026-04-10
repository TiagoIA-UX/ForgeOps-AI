import Link from "next/link";
import { Zap, GitBranch, ShieldCheck, BrainCircuit, ArrowRight } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ZAEA — Autonomous Engineering Agent",
  description:
    "Detecta, corrige e valida bugs no seu repositório GitHub automaticamente. Sem intervenção humana para falhas triviais.",
};

export default function HomePage() {
  return (
    <main className="min-h-screen bg-zaea-bg text-white">
      {/* Navbar */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-zaea-border max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <Zap size={18} className="text-zaea-accent" />
          <span className="font-bold text-white">ZAEA</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/pricing" className="text-sm text-zaea-muted hover:text-white transition-colors">
            Preços
          </Link>
          <Link href="/auth/login" className="text-sm text-zaea-muted hover:text-white transition-colors">
            Entrar
          </Link>
          <Link
            href="/auth/signup"
            className="text-sm px-3 py-1.5 bg-zaea-accent hover:bg-zaea-accent/90 rounded-lg font-medium transition-colors"
          >
            Começar grátis
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="text-center pt-20 pb-12 px-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zaea-accent/30 bg-zaea-accent/10 text-xs text-zaea-accent mb-6">
          <Zap size={12} />
          Plano Free para sempre · Integração Mercado Pago
        </div>
        <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-5">
          Seu repositório GitHub
          <br />
          <span className="text-zaea-accent">corrige bugs sozinho</span>
        </h1>
        <p className="text-zaea-muted text-lg max-w-xl mx-auto mb-8">
          ZAEA monitora, diagnostica e aplica patches no seu código Next.js + Supabase com zero
          intervenção humana para falhas triviais.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link
            href="/auth/signup"
            className="flex items-center gap-2 px-6 py-3 bg-zaea-accent hover:bg-zaea-accent/90 rounded-xl font-semibold text-sm transition-colors"
          >
            Começar grátis — sem cartão <ArrowRight size={14} />
          </Link>
          <Link
            href="/pricing"
            className="flex items-center gap-2 px-6 py-3 border border-zaea-border hover:border-zaea-accent/50 rounded-xl font-semibold text-sm text-zaea-muted hover:text-white transition-colors"
          >
            Ver planos
          </Link>
        </div>
      </section>

      {/* Como funciona */}
      <section className="max-w-4xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              step: "1",
              icon: <GitBranch size={20} className="text-zaea-accent" />,
              title: "Conecte seu repo",
              desc: "Entre com Google ou GitHub, crie sua organização e conecte o repositório que deseja monitorar.",
            },
            {
              step: "2",
              icon: <ShieldCheck size={20} className="text-zaea-success" />,
              title: "Configure os agentes",
              desc: "Adicione sua chave Groq (grátis) e um Personal Access Token do GitHub. O Scanner começa automaticamente.",
            },
            {
              step: "3",
              icon: <BrainCircuit size={20} className="text-zaea-warning" />,
              title: "Receba os patches",
              desc: "Erros SAFE são corrigidos direto no branch. Erros complexos viram Pull Requests. Alertas via Telegram.",
            },
          ].map(({ step, icon, title, desc }) => (
            <div
              key={step}
              className="p-5 rounded-xl border border-zaea-border bg-zaea-surface space-y-3"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-zaea-muted bg-zaea-bg w-6 h-6 rounded-full flex items-center justify-center border border-zaea-border">
                  {step}
                </span>
                {icon}
              </div>
              <h3 className="font-semibold text-white">{title}</h3>
              <p className="text-xs text-zaea-muted leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Agentes */}
      <section className="max-w-4xl mx-auto px-4 pb-20">
        <h2 className="text-center text-base font-semibold text-zaea-muted uppercase tracking-wider mb-6">
          5 agentes trabalhando por você
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { icon: "🔍", name: "Scanner", desc: "Detecta erros TypeScript + lint" },
            { icon: "🔧", name: "Surgeon", desc: "Gera e aplica patches via IA" },
            { icon: "✅", name: "Validator", desc: "Valida via GitHub CI" },
            { icon: "🛡️", name: "Sentinel", desc: "Alertas Telegram em tempo real" },
            { icon: "🎼", name: "Orchestrator", desc: "Coordena todos os agentes" },
          ].map((a) => (
            <div
              key={a.name}
              className="p-4 rounded-xl border border-zaea-border bg-zaea-surface text-center space-y-2"
            >
              <div className="text-2xl">{a.icon}</div>
              <div className="font-semibold text-white text-xs">{a.name}</div>
              <div className="text-zaea-muted text-xs leading-tight">{a.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer CTA */}
      <section className="border-t border-zaea-border py-12 text-center px-4">
        <h2 className="text-2xl font-bold text-white mb-3">Pronto para automatizar?</h2>
        <p className="text-zaea-muted text-sm mb-6">Plano gratuito para sempre. Sem cartão de crédito.</p>
        <Link
          href="/auth/signup"
          className="inline-flex items-center gap-2 px-8 py-3 bg-zaea-accent hover:bg-zaea-accent/90 rounded-xl font-semibold transition-colors"
        >
          Criar conta grátis <ArrowRight size={14} />
        </Link>
      </section>
    </main>
  );
}
