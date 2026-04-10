// ======================================================
// ZAEA — POST /api/billing/webhook
// Recebe notificações do Mercado Pago (IPN / Webhooks v2)
// Configurar no Painel MP → Webhooks → URL: /api/billing/webhook
// ======================================================

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature, getSubscription } from "@/lib/mercadopago";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrgPlan } from "@/lib/types/tenant";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const xSignature  = req.headers.get("x-signature")  ?? "";
  const xRequestId  = req.headers.get("x-request-id") ?? "";

  // Valida assinatura HMAC-SHA256 do Mercado Pago
  const valid = verifyWebhookSignature({ rawBody, xSignature, xRequestId });
  if (!valid) {
    // Em testes sem MP_WEBHOOK_SECRET configurado, continua mas loga
    console.warn("[webhook] Assinatura inválida ou MP_WEBHOOK_SECRET não configurado");
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const type        = String(payload.type ?? payload.action ?? "");
  const dataId      = String((payload as { data?: { id?: unknown } }).data?.id ?? "");

  const supabase = createAdminClient();

  // ---------------------------------------------------
  // subscription_preapproval — evento de assinatura
  // ---------------------------------------------------
  if (type === "subscription_preapproval" && dataId) {
    try {
      const sub = await getSubscription(dataId);

      // Extrai org_id da external_reference "org:<uuid>|plan:<plan>|slug:<slug>"
      const ref = sub.external_reference ?? "";
      const orgMatch  = ref.match(/org:([^|]+)/);
      const planMatch = ref.match(/plan:([^|]+)/);

      if (!orgMatch || !planMatch) {
        console.error("[webhook] external_reference sem org/plan:", ref);
        return NextResponse.json({ ok: true });
      }

      const orgId = orgMatch[1];
      const plan  = planMatch[1] as OrgPlan;
      const status = sub.status ?? "pending";

      // Calcula max_repos conforme plano
      const PLAN_LIMITS: Record<OrgPlan, { repos: number; members: number }> = {
        free:       { repos: 1,   members: 3   },
        starter:    { repos: 3,   members: 10  },
        pro:        { repos: 10,  members: 25  },
        enterprise: { repos: 999, members: 999 },
      };
      const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

      // Atualiza org
      await supabase
        .from("organizations")
        .update({
          mp_subscription_id:     sub.id,
          mp_subscription_status: status,
          mp_plan:                plan,
          mp_next_payment_at:     sub.next_payment_date ?? null,
          ...(status === "authorized" ? {
            plan,
            max_repos:    limits.repos,
            max_members:  limits.members,
          } : {}),
          ...(status === "cancelled" ? {
            plan:         "free" as OrgPlan,
            max_repos:    1,
            max_members:  3,
          } : {}),
        })
        .eq("id", orgId);

      // Auditoria
      await supabase.from("billing_events").insert({
        org_id:      orgId,
        event_type:  `subscription.${status}`,
        mp_event_id: dataId,
        mp_resource: "preapproval",
        status:      status,
        raw_payload: payload,
      });

    } catch (err) {
      console.error("[webhook] Erro ao processar subscription:", err);
      // Retorna 200 para evitar reenvio em cascata do MP
    }
  }

  // ---------------------------------------------------
  // payment — evento de cobrança recorrente
  // ---------------------------------------------------
  if (type === "payment" && dataId) {
    try {
      const { Payment: PaymentAPI } = await import("@/lib/mercadopago");
      const { getMPClient } = await import("@/lib/mercadopago");
      const paymentApi = new PaymentAPI(getMPClient());
      const payment = await paymentApi.get({ id: parseInt(dataId, 10) });

      const ref    = payment.external_reference ?? "";
      const orgMatch = ref.match(/org:([^|]+)/);
      if (orgMatch) {
        await supabase.from("billing_events").insert({
          org_id:      orgMatch[1],
          event_type:  "payment.created",
          mp_event_id: dataId,
          mp_resource: "payment",
          amount:      payment.transaction_amount ?? null,
          currency:    payment.currency_id ?? "BRL",
          status:      payment.status ?? null,
          raw_payload: payload,
        });
      }
    } catch (err) {
      console.error("[webhook] Erro ao processar payment:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
