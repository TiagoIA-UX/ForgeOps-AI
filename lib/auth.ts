// ======================================================
// ZAEA — Autenticação interna via INTERNAL_API_SECRET
// ======================================================

import { NextRequest } from "next/server";

export function validateApiSecret(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    throw new Error("INTERNAL_API_SECRET não configurado");
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  // Comparação em tempo constante para evitar timing attacks
  if (provided.length !== secret.length) return false;

  let mismatch = 0;
  for (let i = 0; i < secret.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ secret.charCodeAt(i);
  }

  return mismatch === 0;
}
