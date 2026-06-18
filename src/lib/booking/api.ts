import { createClient } from "@/lib/supabase/client";
import type { ReservationStatus } from "@/lib/types/db";

/**
 * Typed wrappers around the booking RPCs.
 *
 * postgrest-js's generated generics don't model hand-written SQL functions
 * cleanly. Rather than scatter casts at call sites, we narrow the rpc signature
 * once here and own the result types. In Phase 1.x these are replaced by
 * `supabase gen types typescript` output against the live database.
 */

export type AvailabilitySlot = {
  room_id: string;
  room_name: string;
  slot_start: string;
  deposit_cents: number;
};

export type HoldResult = {
  reservation_id: string;
  status: ReservationStatus;
  deposit_cents: number;
  hold_expires_at: string | null;
};

type RpcResult<T> = { data: T | null; error: { message: string } | null };

function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const client = createClient() as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult<T>>;
  };
  return client.rpc(fn, args);
}

export function getAvailability(args: {
  slug: string;
  date: string;
  party: number;
}) {
  return callRpc<AvailabilitySlot[]>("get_availability", {
    p_venue_slug: args.slug,
    p_date: args.date,
    p_party: args.party,
  });
}

export function createHold(args: {
  slug: string;
  roomId: string;
  slotStart: string;
  party: number;
  name: string;
  phone: string;
  email?: string | null;
  occasion?: string | null;
}) {
  return callRpc<HoldResult[]>("create_hold", {
    p_venue_slug: args.slug,
    p_room_id: args.roomId,
    p_slot_start: args.slotStart,
    p_party: args.party,
    p_name: args.name,
    p_phone: args.phone,
    p_email: args.email ?? null,
    p_occasion: args.occasion ?? null,
  });
}
