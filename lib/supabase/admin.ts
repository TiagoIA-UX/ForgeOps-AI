import { createClient } from "@supabase/supabase-js";

// Cliente admin com service role — uso exclusivo no servidor
// NUNCA exponha este cliente no browser
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "placeholder-service-role-key";

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
