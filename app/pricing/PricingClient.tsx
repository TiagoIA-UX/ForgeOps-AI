"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Zap, Loader2, AlertCircle } from "lucide-react";

const PLANS = [
  {
    id:    "free" as const,
    name:  "Free",
    price: 0,
    description: "Para experimentar o ForgeOps AI",
    highlight: false,
    features: [
      "1 repositório",
      "3 membros",
      "Scan a cada 60 min",
      "Base de conhecimento",
      "Dashboard público",
    ],
    cta: "Começar grátis",
  },
  {
    id:    "starter" as const,
    name:  "Starter",
    price: 97,
    description: "Para times pequenos",
    highlight: false,
    features: [
      "3 repositórios",
      "10 membros",
      "Scan a cada 15 min",
      "Auto-fix SAFE + MODERATE",
      "Alertas Telegram",
      "Histórico 30 dias",
    ],
    cta: "Assinar Starter",
  },
  {
    id:    "pro" as const,
    name:  "Pro",
    price: 297,
    description: "Para times que escalam",
    highlight: true,
    features: [
      "10 repositórios",
      "25 membros",
      "Scan a cada 10 min",
      "Auto-fix inteligente",
      "PR automático no GitHub",
      "Relatórios por e-mail",
      "Suporte prioritário",
    ],
    cta: "Assinar Pro",
  },
  {
    id:    "enterprise" as const,
    name:  "Enterprise",
    price: null,
    description: "Repositórios ilimitados",
    highlight: false,
    features: [
      "Repos ilimitados",
      "Membros ilimitados",
      "Scan a cada 5 min",
      "SLA garantido",
      "Onboarding dedicado",
      "Contrato personalizado",
    ],
    cta: "Falar com vendas",
  },
];

export default function PricingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgSlug     = searchParams.get("org")  ?? undefined;
  const currentPlan = searchParams.get("plan") ?? undefined;
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  async function handleSelect(planId: string) {
    if (planId === "free") {
      router.push(orgSlug ? `/dashboard/${orgSlug}` : "/dashboard");
      return;
    }
    if (planId === "enterprise") {
      window.open("mailto:contato@ForgeOps AI.dev?subject=Enterprise ForgeOps AI", "_blank");
      return;
    }
    if (!orgSlug) {
      router.push("/auth/signup");
      return;
    }

    setLoading(planId);
    setError(null);

    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgSlug, plan: planId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao criar checkout");

      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
      setLoading(null);
    }
  }

  return (
    <main className="min-h-screen bg-forge-bg text-white">
      {/* Header */}
      <header className="text-center pt-16 pb-8 px-4">
        <div className="flex items-center justify-center gap-2 mb-4">
          <Zap size={22} className="text-forge-accent" />
          <span className="text-sm font-semibold text-forge-accent uppercase tracking-widest">ForgeOps AI</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Preços simples e transparentes
        </h1>
        <p className="text-forge-muted text-lg max-w-xl mx-auto">
          Corrija bugs automaticamente, durma tranquilo. Cancele quando quiser.
        </p>
      </header>

      {error && (
        <div className="max-w-md mx-auto mb-6 flex items-center gap-2 bg-forge-danger/10 border border-forge-danger/30 rounded-lg px-4 py-3 text-sm text-forge-danger">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Cards */}
      <section className="max-w-6xl mx-auto px-4 pb-24">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border p-6 transition-all ${
                plan.highlight
                  ? "border-forge-accent bg-forge-accent/5 shadow-lg shadow-forge-accent/10"
                  : "border-forge-border bg-forge-surface"
              }`}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-forge-accent text-white text-xs font-bold px-3 py-1 rounded-full">
                  Mais popular
                </span>
              )}

              <div className="mb-6">
                <h2 className="text-lg font-bold text-white">{plan.name}</h2>
                <p className="text-xs text-forge-muted mt-1">{plan.description}</p>
                <div className="mt-4">
                  {plan.price === null ? (
                    <span className="text-2xl font-bold">Sob consulta</span>
                  ) : plan.price === 0 ? (
                    <span className="text-3xl font-bold">Grátis</span>
                  ) : (
                    <div>
                      <span className="text-xs text-forge-muted">R$</span>
                      <span className="text-3xl font-bold ml-1">{plan.price}</span>
                      <span className="text-sm text-forge-muted">/mês</span>
                    </div>
                  )}
                </div>
              </div>

              <ul className="flex-1 space-y-2 mb-6">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-forge-muted">
                    <Check size={14} className="text-forge-success mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleSelect(plan.id)}
                disabled={loading !== null || currentPlan === plan.id}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                  currentPlan === plan.id
                    ? "bg-forge-success/10 text-forge-success border border-forge-success/30 cursor-default"
                    : plan.highlight
                    ? "bg-forge-accent hover:bg-forge-accent/90 text-white"
                    : "bg-forge-bg hover:bg-forge-surface border border-forge-border text-white"
                }`}
              >
                {loading === plan.id && <Loader2 size={14} className="animate-spin" />}
                {currentPlan === plan.id ? "Plano atual" : plan.cta}
              </button>
            </div>
          ))}
        </div>

        {/* Tabela comparativa simplificada */}
        <div className="mt-16 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <caption className="text-left text-base font-semibold text-white mb-4">
              Por que o ForgeOps AI é diferente dos concorrentes?
            </caption>
            <thead>
              <tr className="border-b border-forge-border">
                <th className="text-left py-3 pr-6 text-forge-muted font-medium w-1/4">Recurso</th>
                {["GitHub Copilot", "Devin AI", "Sweep AI", "ForgeOps AI"].map((h) => (
                  <th key={h} className={`py-3 px-4 text-center font-medium ${h === "ForgeOps AI" ? "text-forge-accent" : "text-forge-muted"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["Fix autônomo de bugs", "❌", "✅", "Parcial", "✅"],
                ["Multi-repo / org", "❌", "❌", "❌", "✅"],
                ["Pagamento em BRL", "❌", "❌", "❌", "✅"],
                ["Sem cartão para começar", "❌", "❌", "✅", "✅"],
                ["Patch com contexto histórico", "❌", "❌", "❌", "✅"],
                ["Preço mensal (BRL)", "~R$115", "~R$2.500", "~R$230", "R$97–297"],
              ].map(([feature, ...vals]) => (
                <tr key={feature} className="border-b border-forge-border/50">
                  <td className="py-3 pr-6 text-white">{feature}</td>
                  {vals.map((v, i) => (
                    <td key={i} className={`py-3 px-4 text-center ${i === 3 ? "text-forge-accent font-semibold" : "text-forge-muted"}`}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* FAQ */}
        <div className="mt-12 max-w-2xl mx-auto space-y-6">
          <h3 className="text-base font-semibold text-white">Dúvidas frequentes</h3>
          {[
            {
              q: "Como funciona o teste grátis?",
              a: "O plano Free é permanente, sem cartão. Você tem 1 repositório e scans a cada 60 minutos para sempre.",
            },
            {
              q: "Como é feito o pagamento?",
              a: "Via Mercado Pago — cartão de crédito, boleto ou Pix. Recorrência mensal automática.",
            },
            {
              q: "Posso cancelar a qualquer momento?",
              a: "Sim. Basta acessar Configurações → Plano → Cancelar assinatura. Sem multa.",
            },
            {
              q: "O ForgeOps AI modifica código em produção?",
              a: "Jamais diretamente. Patches RISKY geram um Pull Request para revisão. Apenas erros SAFE são aplicados automaticamente.",
            },
          ].map(({ q, a }) => (
            <div key={q} className="border border-forge-border rounded-xl p-4 space-y-1">
              <p className="text-white font-medium text-sm">{q}</p>
              <p className="text-forge-muted text-sm">{a}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
