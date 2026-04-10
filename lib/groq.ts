// ======================================================
// ZAEA — Cliente Groq com suporte ao AI Gateway
// Usa AI_GATEWAY_API_KEY se disponível, fallback p/ GROQ_API_KEY
// ======================================================

import Groq from "groq-sdk";

let _client: Groq | null = null;

export function getGroqClient(): Groq {
  if (_client) return _client;

  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  if (!gatewayKey && !groqKey) {
    throw new Error("Nenhuma chave de IA configurada (AI_GATEWAY_API_KEY ou GROQ_API_KEY)");
  }

  // AI Gateway da Vercel roteia para Groq com a chave própria
  if (gatewayKey) {
    _client = new Groq({
      apiKey: gatewayKey,
      baseURL: "https://gateway.ai.cloudflare.com/v1/zairyx/zaea/groq", // ajuste ao seu gateway
    });
  } else {
    _client = new Groq({ apiKey: groqKey! });
  }

  return _client;
}

export const MODEL = "llama-3.3-70b-versatile";

export async function chatComplete(
  messages: Groq.Chat.ChatCompletionMessageParam[],
  opts: { json?: boolean; maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const client = getGroqClient();

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages,
    ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.1,
  });

  return completion.choices[0]?.message?.content ?? "";
}
