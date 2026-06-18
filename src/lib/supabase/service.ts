import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for trusted server contexts (the bot, webhooks,
 * background workers). Bypasses RLS — NEVER import this into client code or expose
 * the key to the browser. The key lives only in SUPABASE_SERVICE_ROLE_KEY.
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
