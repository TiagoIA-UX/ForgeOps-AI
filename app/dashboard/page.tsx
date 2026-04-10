import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getUserOrgs } from "@/lib/tenant";
import Link from "next/link";
import { ArrowRight, Building2, Plus } from "lucide-react";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const orgs = await getUserOrgs(user.id);

  // Se só tem uma org, redireciona direto
  if (orgs.length === 1) {
    redirect(`/dashboard/${orgs[0].org.slug}`);
  }

  return (
    <div className="min-h-screen bg-zaea-bg p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Suas organizações</h1>
          <p className="text-sm text-zaea-muted mt-1">
            Bem-vindo, {user.user_metadata?.full_name ?? user.email}
          </p>
        </div>

        {orgs.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-zaea-border rounded-xl space-y-4">
            <Building2 size={32} className="text-zaea-muted mx-auto" />
            <p className="text-zaea-muted text-sm">Você não tem nenhuma organização ainda.</p>
            <Link
              href="/onboarding"
              className="inline-flex items-center gap-2 px-4 py-2 bg-zaea-accent hover:bg-zaea-accent-hover rounded-lg text-sm font-medium text-white transition-colors"
            >
              <Plus size={14} /> Criar organização
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {orgs.map(({ org, role }) => (
              <Link
                key={org.id}
                href={`/dashboard/${org.slug}`}
                className="flex items-center justify-between p-4 bg-zaea-surface border border-zaea-border hover:border-zaea-accent/50 rounded-xl transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-zaea-accent/20 border border-zaea-accent/30 flex items-center justify-center text-lg font-bold text-zaea-accent">
                    {org.name[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-white">{org.name}</p>
                    <p className="text-xs text-zaea-muted">
                      {org.slug} · {role} · plano {org.plan}
                    </p>
                  </div>
                </div>
                <ArrowRight size={16} className="text-zaea-muted group-hover:text-white transition-colors" />
              </Link>
            ))}

            <Link
              href="/onboarding"
              className="flex items-center justify-center gap-2 p-4 border border-dashed border-zaea-border hover:border-zaea-accent/50 rounded-xl text-sm text-zaea-muted hover:text-white transition-colors"
            >
              <Plus size={14} /> Nova organização
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
