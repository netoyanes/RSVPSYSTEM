/**
 * Database types.
 *
 * Phase 0 hand-written stub mirroring supabase/migrations/0001_init.sql.
 * In Phase 1 this file is replaced by `supabase gen types typescript` output.
 */

export type ReservationStatus =
  | "held"
  | "pending_payment"
  | "confirmed"
  | "checked_in"
  | "no_show"
  | "cancelled";

export type StaffRole = "owner" | "manager" | "host";

export type Venue = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  status: "active" | "onboarding" | "suspended";
  created_at: string;
}

export type Room = {
  id: string;
  venue_id: string;
  name: string;
  min_capacity: number;
  max_capacity: number;
  sort_order: number;
  active: boolean;
}

export type SlotRule = {
  id: string;
  venue_id: string;
  name: string;
  weekdays: number[];
  start_time: string;
  is_premium: boolean;
  deposit_per_person_cents: number;
  min_party_for_deposit: number;
  active: boolean;
}

export type Customer = {
  id: string;
  venue_id: string;
  name: string;
  phone: string;
  email: string | null;
  birthday: string | null;
  marketing_opt_in: boolean;
  total_visits: number;
  last_visit: string | null;
  tags: string[];
  created_at: string;
}

export type VenueMembership = {
  user_id: string;
  venue_id: string;
  role: StaffRole;
}

export type Reservation = {
  id: string;
  venue_id: string;
  room_id: string;
  customer_id: string;
  status: ReservationStatus;
  reserved_date: string;
  slot_start: string;
  slot_end: string;
  party_size: number;
  deposit_required: boolean;
  deposit_cents: number;
  special_occasion: string | null;
  notes: string | null;
  source: "web" | "admin";
  hold_expires_at: string | null;
  created_by: string | null;
  created_at: string;
}

/**
 * Minimal Database shape for the typed Supabase client. Tables are typed loosely
 * here; the generated types in Phase 1 provide full Insert/Update/Relationships.
 */
export interface Database {
  public: {
    Tables: {
      venues: { Row: Venue; Insert: Partial<Venue>; Update: Partial<Venue>; Relationships: [] };
      rooms: { Row: Room; Insert: Partial<Room>; Update: Partial<Room>; Relationships: [] };
      slot_rules: {
        Row: SlotRule;
        Insert: Partial<SlotRule>;
        Update: Partial<SlotRule>;
        Relationships: [];
      };
      customers: {
        Row: Customer;
        Insert: Partial<Customer>;
        Update: Partial<Customer>;
        Relationships: [];
      };
      venue_memberships: {
        Row: VenueMembership;
        Insert: Partial<VenueMembership>;
        Update: Partial<VenueMembership>;
        Relationships: [];
      };
      reservations: {
        Row: Reservation;
        Insert: Partial<Reservation>;
        Update: Partial<Reservation>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_availability: {
        Args: { p_venue_slug: string; p_date: string; p_party: number };
        Returns: {
          room_id: string;
          room_name: string;
          slot_start: string;
          deposit_cents: number;
        }[];
      };
      create_hold: {
        Args: {
          p_venue_slug: string;
          p_room_id: string;
          p_slot_start: string;
          p_party: number;
          p_name: string;
          p_phone: string;
          p_email?: string | null;
          p_occasion?: string | null;
        };
        Returns: {
          reservation_id: string;
          status: ReservationStatus;
          deposit_cents: number;
          hold_expires_at: string;
        }[];
      };
    };
    Enums: Record<string, never>;
  };
}
