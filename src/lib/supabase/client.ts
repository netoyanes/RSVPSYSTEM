import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/db";

/**
 * Browser Supabase client. Uses the public anon key — all access is constrained
 * by Row-Level Security policies (see supabase/migrations/0002_rls.sql).
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
