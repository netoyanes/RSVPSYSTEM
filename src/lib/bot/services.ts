import { createServiceClient } from "@/lib/supabase/service";

/** Booking domain access for the bot — reuses the exact same secure RPCs as the
 *  web flow (capacity fit, premium deposit, double-booking guard all apply). */

export type Slot = {
  room_id: string;
  room_name: string;
  slot_start: string;
  deposit_cents: number;
};

export type HoldResult = {
  reservation_id: string;
  status: string;
  deposit_cents: number;
  hold_expires_at: string | null;
};

type RpcResult<T> = { data: T | null; error: { message: string } | null };

function rpc<T>(fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const client = createServiceClient() as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult<T>>;
  };
  return client.rpc(fn, args);
}

export function botAvailability(slug: string, date: string, party: number) {
  return rpc<Slot[]>("get_availability", {
    p_venue_slug: slug,
    p_date: date,
    p_party: party,
  });
}

export function botCreateHold(args: {
  slug: string;
  roomId: string;
  slotStart: string;
  party: number;
  name: string;
  phone: string;
}) {
  return rpc<HoldResult[]>("create_hold", {
    p_venue_slug: args.slug,
    p_room_id: args.roomId,
    p_slot_start: args.slotStart,
    p_party: args.party,
    p_name: args.name,
    p_phone: args.phone,
  });
}
