-- 0002_rls.sql — Row-Level Security: tenant isolation at the database.
--
-- Model:
--   * Staff act through Supabase auth; their venue access comes from
--     venue_memberships. They may read/write rows of venues they belong to.
--   * Public booking (anonymous customers) goes through SECURITY DEFINER RPCs
--     (added in Phase 1), NOT direct table writes, so anon has no broad access.

-- Helper: venues the current user is a member of.
create or replace function auth_member_venue_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select venue_id from venue_memberships where user_id = auth.uid();
$$;

-- Enable RLS on every tenant table.
alter table venues             enable row level security;
alter table venue_branding     enable row level security;
alter table venue_settings     enable row level security;
alter table rooms              enable row level security;
alter table operating_hours    enable row level security;
alter table slot_rules         enable row level security;
alter table customers          enable row level security;
alter table reservations       enable row level security;
alter table payments           enable row level security;
alter table customer_credits   enable row level security;
alter table waitlist           enable row level security;
alter table venue_memberships  enable row level security;
alter table notifications      enable row level security;
alter table audit_log          enable row level security;

-- ---------------------------------------------------------------------------
-- Public (anon) read access: only what a customer needs to browse & book.
-- Active venues, their branding, rooms, hours and slot rules are public-read.
-- ---------------------------------------------------------------------------
create policy "public reads active venues"
  on venues for select using (status = 'active');

create policy "public reads branding"
  on venue_branding for select using (true);

create policy "public reads rooms"
  on rooms for select using (true);

create policy "public reads hours"
  on operating_hours for select using (true);

create policy "public reads slot rules"
  on slot_rules for select using (true);

-- ---------------------------------------------------------------------------
-- Staff access: full read/write scoped to their member venues.
-- ---------------------------------------------------------------------------
create policy "staff manage their venues"
  on venues for all
  using (id in (select auth_member_venue_ids()))
  with check (id in (select auth_member_venue_ids()));

-- Generic per-venue policy applied to the tenant tables below.
do $$
declare t text;
begin
  foreach t in array array[
    'venue_branding','venue_settings','rooms','operating_hours','slot_rules',
    'customers','reservations','payments','customer_credits','waitlist',
    'notifications','audit_log'
  ]
  loop
    execute format($f$
      create policy "staff rw %1$s"
        on %1$s for all
        using (venue_id in (select auth_member_venue_ids()))
        with check (venue_id in (select auth_member_venue_ids()));
    $f$, t);
  end loop;
end $$;

-- Membership visibility: a user can read their OWN membership rows. This MUST be
-- the only policy that reads venue_memberships *from a policy on the same table*,
-- otherwise RLS recurses infinitely (a policy that queries the table it guards).
-- Other tables read memberships via auth_member_venue_ids(), whose inner query is
-- then governed by this non-recursive policy — no recursion.
-- Co-worker visibility and owner-managed memberships are handled out-of-band
-- (SQL/admin) for now and will return via a SECURITY DEFINER RPC in a later phase.
create policy "read own memberships"
  on venue_memberships for select
  using (user_id = auth.uid());
