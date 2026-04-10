// ======================================================
// ZAEA — lib/mercadopago.ts
// Cliente centralizado Mercado Pago (assinaturas SaaS)
// Documentação: https://www.mercadopago.com.br/developers/pt
// ======================================================

import { MercadoPagoConfig, PreApproval, Payment } from "mercadopago";
import { createHmac, timingSafeEqual } from "crypto";
import type { OrgPlan } from "@/lib/types/tenant";

// ----------------------------
// Cliente singleton
// ----------------------------
let _client: MercadoPagoConfig | null = null;

export function getMPClient(): MercadoPagoConfig {
  if (_client) return _client;

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token || token.includes("COLE_SEU")) {
    throw new Error("MP_ACCESS_TOKEN não configurado. Verifique .env.local");
  }

  _client = new MercadoPagoConfig({
    accessToken: token,
    options: { timeout: 10_000 },
  });

  return _client;
}

// ----------------------------
// Mapeamento de planos
// ----------------------------
export const PLAN_NAMES: Record<Exclude<OrgPlan, "free" | "enterprise">, string> = {
  starter: "ZAEA Starter",
  pro:     "ZAEA Pro",
};

/** Preços em BRL (centavos → real) */
export const PLAN_PRICES_BRL: Record<Exclude<OrgPlan, "free" | "enterprise">, number> = {
  starter: 97,   // R$ 97/mês
  pro:     297,  // R$ 297/mês
};

function getEnvPlanId(plan: Exclude<OrgPlan, "free" | "enterprise">): string {
  const key = `MP_PLAN_${plan.toUpperCase()}_ID`;
  return process.env[key] ?? "";
}

// ----------------------------
// createSubscriptionCheckout
// Cria uma sessão de checkout p/ assinatura recorrente (PreApproval)
// ----------------------------
export async function createSubscriptionCheckout(params: {
  plan: Exclude<OrgPlan, "free" | "enterprise">;
  orgId: string;
  orgSlug: string;
  userEmail: string;
  backUrl: string;
}): Promise<{ checkoutUrl: string; subscriptionId: string }> {
  const { plan, orgId, orgSlug, userEmail, backUrl } = params;
  const client = getMPClient();
  const preApproval = new PreApproval(client);

  const planId = getEnvPlanId(plan);

  if (planId) {
    // Usa plano pré-cadastrado no Painel MP (recomendado para produção)
    const response = await preApproval.create({
      body: {
        preapproval_plan_id: planId,
        payer_email: userEmail,
        back_url: backUrl,
        external_reference: `org:${orgId}|plan:${plan}`,
      },
    });

    if (!response.init_point) {
      throw new Error("Mercado Pago não retornou init_point");
    }

    return {
      checkoutUrl: response.init_point,
      subscriptionId: response.id ?? "",
    };
  }

  // Fallback: cria assinatura direta sem plano pré-cadastrado
  const response = await preApproval.create({
    body: {
      reason: PLAN_NAMES[plan],
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: PLAN_PRICES_BRL[plan],
        currency_id: "BRL",
      },
      payer_email: userEmail,
      back_url: backUrl,
      external_reference: `org:${orgId}|plan:${plan}|slug:${orgSlug}`,
    },
  });

  if (!response.init_point) {
    throw new Error("Mercado Pago não retornou init_point");
  }

  return {
    checkoutUrl: response.init_point,
    subscriptionId: response.id ?? "",
  };
}

// ----------------------------
// cancelSubscription
// ----------------------------
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const client = getMPClient();
  const preApproval = new PreApproval(client);

  await preApproval.update({
    id: subscriptionId,
    body: { status: "cancelled" },
  });
}

// ----------------------------
// getSubscription — busca detalhes de uma assinatura ativa
// ----------------------------
export async function getSubscription(subscriptionId: string) {
  const client = getMPClient();
  const preApproval = new PreApproval(client);
  return preApproval.get({ id: subscriptionId });
}

// ----------------------------
// verifyWebhookSignature
// Valida a assinatura HMAC-SHA256 do webhook MP
// Header: x-signature  →  "ts=...,v1=..."
// ----------------------------
export function verifyWebhookSignature(params: {
  rawBody: string;
  xSignature: string;
  xRequestId: string;
}): boolean {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret || secret.includes("gere-um")) return false;

  const { xSignature, xRequestId, rawBody } = params;

  // Extrai ts e v1 do header x-signature
  const parts: Record<string, string> = {};
  xSignature.split(",").forEach((part) => {
    const [k, v] = part.split("=");
    if (k && v) parts[k.trim()] = v.trim();
  });

  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return false;

  // Manifest: "id:<data-id>;request-id:<x-request-id>;ts:<ts>;"
  // Extrai o data.id do body JSON
  let dataId = "";
  try {
    const parsed = JSON.parse(rawBody);
    dataId = String(parsed?.data?.id ?? "");
  } catch {
    return false;
  }

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  const expected = createHmac("sha256", secret).update(manifest).digest("hex");

  // Comparação timing-safe
  try {
    return timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// Exporta tipos auxiliares do SDK
export { Payment };
