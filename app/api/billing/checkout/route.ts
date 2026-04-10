// ======================================================
// ForgeOps AI — POST /api/billing/checkout
// Cria sessão de checkout Mercado Pago (assinatura recorrente)
// ======================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrgBySlug, getUserRole } from "@/lib/tenant";
import { createSubscriptionCheckout } from "@/lib/mercadopago";

const Schema = z.object({
  orgSlug: z.string().min(2),
  plan:    z.enum(["starter", "pro"]),
});

export async function POST(req: NextRequest) {
  // Auth
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", details: parsed.error.flatten() }, { status: 422 });
  }

  const { orgSlug, plan } = parsed.data;

  // Valida membership (somente owner pode assinar)
  const org = await getOrgBySlug(orgSlug);
  if (!org) return NextResponse.json({ error: "Org não encontrada" }, { status: 404 });

  const role = await getUserRole(user.id, org.id);
  if (role !== "owner") {
    return NextResponse.json({ error: "Apenas o owner pode alterar o plano" }, { status: 403 });
  }

  const origin = req.nextUrl.origin;

  try {
    const { checkoutUrl, subscriptionId } = await createSubscriptionCheckout({
      plan,
      orgId: org.id,
      orgSlug: org.slug,
      userEmail: user.email ?? "",
      backUrl: `${origin}/dashboard/${orgSlug}?billing=success`,
    });

    // Persiste subscription_id pendente
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    await admin
      .from("organizations")
      .update({
        mp_subscription_id: subscriptionId,
        mp_subscription_status: "pending",
        mp_plan: plan,
        mp_payer_email: user.email,
      })
      .eq("id", org.id);

    return NextResponse.json({ checkoutUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[billing/checkout]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
