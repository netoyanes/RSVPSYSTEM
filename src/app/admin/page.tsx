import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import FloorPanel from "@/components/admin/FloorPanel";
import type { StaffRole } from "@/lib/types/db";

type Membership = { venue_id: string; role: StaffRole };
type VenueInfo = { name: string; timezone: string; currency: string };

/**
 * Staff dashboard. Resolves the signed-in user's venue + role, then hands off to
 * the realtime FloorPanel. Defaults to the first venue the user belongs to
 * (a venue switcher comes with multi-venue in Phase 3).
 */
export default async function AdminHome() {
  const supabase = await createClient();
  // Untyped client for table reads (see note in src/lib/admin/data.ts).
  const sb = supabase as unknown as SupabaseClient;

  const { data: memberships } = await sb
    .from("venue_memberships")
    .select("venue_id, role")
    .limit(1);

  const membership = (memberships as Membership[] | null)?.[0];

  if (!membership) {
    return (
      <main className="container-app py-16">
        <h1 className="font-display text-2xl text-text">Sin acceso</h1>
        <p className="mt-2 text-sm text-muted">
          Tu usuario no está asignado a ningún venue. Pide a un administrador que
          te agregue en <code>venue_memberships</code>.
        </p>
      </main>
    );
  }

  const { data: venueData } = await sb
    .from("venues")
    .select("name, timezone, currency")
    .eq("id", membership.venue_id)
    .single();
  const venue = venueData as VenueInfo | null;

  return (
    <FloorPanel
      venueId={membership.venue_id}
      role={membership.role}
      timezone={venue?.timezone ?? "America/Mazatlan"}
      currency={venue?.currency ?? "MXN"}
    />
  );
}
