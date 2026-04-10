import type { NextRequest } from "next/server"
export type AdminRole = "support" | "admin" | "owner"
export interface AdminUser { id: string; role: AdminRole; email: string }
// No standalone mode, auth is done via INTERNAL_API_SECRET header
export async function requireAdmin(_req: NextRequest, _minRole: AdminRole): Promise<AdminUser | null> {
  return null
}
