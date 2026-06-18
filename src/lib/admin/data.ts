import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { ReservationStatus } from "@/lib/types/db";

/**
 * postgrest-js's generated generics don't model our hand-written table types
 * cleanly (it collapses to `never`). Until `supabase gen types` runs against the
 * live DB, we use an untyped client for table I/O and own the result types here.
 */
function db(): SupabaseClient {
  return createClient() as unknown as SupabaseClient;
}

/** Data access for the staff panel. All calls run as the signed-in staff user;
 *  RLS scopes everything to the venues they belong to. */

export type Room = {
  id: string;
  name: string;
  min_capacity: number;
  max_capacity: number;
  sort_order: number;
};

export type AdminReservation = {
  id: string;
  status: ReservationStatus;
  party_size: number;
  slot_start: string;
  slot_end: string;
  deposit_cents: number;
  deposit_required: boolean;
  special_occasion: string | null;
  notes: string | null;
  room_id: string;
  customer_name: string | null;
  customer_phone: string | null;
};

type RawReservation = Omit<AdminReservation, "customer_name" | "customer_phone"> & {
  customers:
    | { name: string | null; phone: string | null }
    | { name: string | null; phone: string | null }[]
    | null;
};

export async function fetchRooms(venueId: string): Promise<Room[]> {
  const supabase = db();
  const { data, error } = await supabase
    .from("rooms")
    .select("id, name, min_capacity, max_capacity, sort_order")
    .eq("venue_id", venueId)
    .eq("active", true)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as Room[];
}

export async function fetchDay(
  venueId: string,
  date: string,
): Promise<AdminReservation[]> {
  const supabase = db();
  const { data, error } = await supabase
    .from("reservations")
    .select(
      "id, status, party_size, slot_start, slot_end, deposit_cents, deposit_required, special_occasion, notes, room_id, customers(name, phone)",
    )
    .eq("venue_id", venueId)
    .eq("reserved_date", date)
    .order("slot_start");
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as RawReservation[];
  return rows.map((r) => {
    const c = Array.isArray(r.customers) ? r.customers[0] : r.customers;
    return {
      id: r.id,
      status: r.status,
      party_size: r.party_size,
      slot_start: r.slot_start,
      slot_end: r.slot_end,
      deposit_cents: r.deposit_cents,
      deposit_required: r.deposit_required,
      special_occasion: r.special_occasion,
      notes: r.notes,
      room_id: r.room_id,
      customer_name: c?.name ?? null,
      customer_phone: c?.phone ?? null,
    };
  });
}

export async function setStatus(
  id: string,
  status: ReservationStatus,
): Promise<void> {
  const supabase = db();
  const patch: { status: ReservationStatus; hold_expires_at?: string | null } = {
    status,
  };
  if (status === "confirmed" || status === "checked_in") {
    patch.hold_expires_at = null;
  }
  const { error } = await supabase.from("reservations").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Reassign a reservation to a different room (the "move" action). */
export async function moveReservation(id: string, roomId: string): Promise<void> {
  const supabase = db();
  const { error } = await supabase
    .from("reservations")
    .update({ room_id: roomId })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
