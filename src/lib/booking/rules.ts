import type { Room, SlotRule } from "@/lib/types/db";

/**
 * Core booking business rules — pure functions, no I/O, fully unit-testable.
 * None of BRUMA's specifics are hardcoded: capacities come from `rooms` and the
 * premium/deposit logic comes from `slot_rules`, so other venues just supply
 * different data.
 */

/** A room fits a party when the size is within [min_capacity, max_capacity]. */
export function roomFitsParty(room: Room, partySize: number): boolean {
  return (
    room.active &&
    partySize >= room.min_capacity &&
    partySize <= room.max_capacity
  );
}

/** Rooms that can host this party, smallest suitable first (don't waste big rooms). */
export function roomsForParty(rooms: Room[], partySize: number): Room[] {
  return rooms
    .filter((r) => roomFitsParty(r, partySize))
    .sort((a, b) => a.max_capacity - b.max_capacity || a.sort_order - b.sort_order);
}

/**
 * Does a slot rule apply to this date + start time?
 * weekday: 0=Sun … 6=Sat (matches Postgres extract(dow)).
 */
export function slotRuleApplies(
  rule: SlotRule,
  weekday: number,
  startTimeHHmm: string,
): boolean {
  return (
    rule.active &&
    rule.weekdays.includes(weekday) &&
    rule.start_time.slice(0, 5) === startTimeHHmm
  );
}

/**
 * Deposit (in cents) required for a booking, given the matching premium rule.
 * Returns 0 when no deposit applies (e.g. party at/below the threshold).
 */
export function depositForBooking(
  rule: SlotRule | null,
  partySize: number,
): number {
  if (!rule || !rule.is_premium) return 0;
  if (partySize < rule.min_party_for_deposit) return 0;
  return partySize * rule.deposit_per_person_cents;
}

/** Format cents to a localized currency string (default MXN). */
export function formatMoney(cents: number, locale = "es-MX", currency = "MXN") {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    cents / 100,
  );
}
