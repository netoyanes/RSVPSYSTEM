-- ==============================================================
-- RSVP System — full database setup (one-paste).
-- Paste this whole file into the Supabase SQL Editor and run it.
-- It is the concatenation of supabase/migrations/0001..0004.
-- ==============================================================


-- ----- supabase/migrations/0001_init.sql -----
-- 0001_init.sql — core multi-venue schema
-- All tenant-scoped tables carry venue_id; RLS (0002) enforces isolation.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type venue_status as enum ('active', 'onboarding', 'suspended');
create type reservation_status as enum (
  'held', 'pending_payment', 'confirmed', 'checked_in', 'no_show', 'cancelled'
);
create type staff_role as enum ('owner', 'manager', 'host');
create type payment_type as enum ('deposit', 'refund');
create type payment_status as enum (
  'requires_action', 'processing', 'succeeded', 'refunded', 'failed'
);
create type credit_type as enum ('earned', 'redeemed', 'expired', 'adjusted');
create type waitlist_status as enum (
  'waiting', 'offered', 'expired', 'converted', 'cancelled'
);

-- ---------------------------------------------------------------------------
-- Tenancy & branding
-- ---------------------------------------------------------------------------
create table venues (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  timezone    text not null default 'America/Mazatlan',
  currency    text not null default 'MXN',
  status      venue_status not null default 'onboarding',
  created_at  timestamptz not null default now()
);

create table venue_branding (
  venue_id     uuid primary key references venues(id) on delete cascade,
  logo_url     text,
  theme_tokens jsonb not null default '{}',
  font         text,
  copy         jsonb not null default '{}'
);

create table venue_settings (
  venue_id               uuid primary key references venues(id) on delete cascade,
  cancellation_window_hrs int not null default 24,
  hold_ttl_minutes       int not null default 10,
  no_show_policy         jsonb not null default '{"action":"retain_as_credit"}',
  reminder_offsets       jsonb not null default
    '[{"channel":"whatsapp","hours_before":24},{"channel":"whatsapp","hours_before":3}]',
  supported_languages    text[] not null default array['es','en'],
  default_slot_minutes   int not null default 120
);

-- ---------------------------------------------------------------------------
-- Inventory & rules
-- ---------------------------------------------------------------------------
create table rooms (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null references venues(id) on delete cascade,
  name         text not null,
  min_capacity int not null check (min_capacity > 0),
  max_capacity int not null check (max_capacity >= min_capacity),
  sort_order   int not null default 0,
  active       boolean not null default true
);
create index rooms_venue_idx on rooms(venue_id);

create table operating_hours (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references venues(id) on delete cascade,
  weekday         int not null check (weekday between 0 and 6),
  opens_at        time not null,
  closes_at       time not null,
  closes_next_day boolean not null default false,
  unique (venue_id, weekday)
);

create table slot_rules (
  id                       uuid primary key default gen_random_uuid(),
  venue_id                 uuid not null references venues(id) on delete cascade,
  name                     text not null,
  weekdays                 int[] not null,
  start_time               time not null,
  is_premium               boolean not null default false,
  deposit_per_person_cents int not null default 0,
  min_party_for_deposit    int not null default 0,
  active                   boolean not null default true
);
create index slot_rules_venue_idx on slot_rules(venue_id);

-- ---------------------------------------------------------------------------
-- Customers (CRM)
-- ---------------------------------------------------------------------------
create table customers (
  id               uuid primary key default gen_random_uuid(),
  venue_id         uuid not null references venues(id) on delete cascade,
  name             text not null,
  phone            text not null,
  email            text,
  birthday         date,
  marketing_opt_in boolean not null default false,
  total_visits     int not null default 0,
  last_visit       timestamptz,
  tags             text[] not null default '{}',
  created_at       timestamptz not null default now(),
  unique (venue_id, phone)
);

-- ---------------------------------------------------------------------------
-- Reservations
-- ---------------------------------------------------------------------------
create table reservations (
  id               uuid primary key default gen_random_uuid(),
  venue_id         uuid not null references venues(id) on delete cascade,
  room_id          uuid not null references rooms(id),
  customer_id      uuid not null references customers(id),
  status           reservation_status not null default 'held',
  reserved_date    date not null,
  slot_start       timestamptz not null,
  slot_end         timestamptz not null,
  party_size       int not null check (party_size > 0),
  deposit_required boolean not null default false,
  deposit_cents    int not null default 0,
  special_occasion text,
  notes            text,
  source           text not null default 'web',
  hold_expires_at  timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now()
);
create index reservations_day_idx on reservations(venue_id, reserved_date);

-- A room/slot can only be actively held once. The partial unique index makes
-- double-booking the premium slot impossible at the database level.
create unique index reservations_active_slot_uq
  on reservations(room_id, slot_start)
  where status in ('held', 'pending_payment', 'confirmed', 'checked_in');

-- ---------------------------------------------------------------------------
-- Payments & redeemable credit ledger
-- ---------------------------------------------------------------------------
create table payments (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references venues(id) on delete cascade,
  reservation_id  uuid not null references reservations(id) on delete cascade,
  provider        text not null default 'stripe',
  provider_ref    text,
  amount_cents    int not null,
  type            payment_type not null default 'deposit',
  status          payment_status not null default 'processing',
  applied_to_bill boolean not null default false,
  applied_at      timestamptz,
  raw_payload     jsonb,
  created_at      timestamptz not null default now()
);
create index payments_reservation_idx on payments(reservation_id);

-- Wallet ledger: a customer's balance = sum(amount_cents) for the venue.
create table customer_credits (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid not null references venues(id) on delete cascade,
  customer_id    uuid not null references customers(id) on delete cascade,
  reservation_id uuid references reservations(id) on delete set null,
  payment_id     uuid references payments(id) on delete set null,
  type           credit_type not null,
  amount_cents   int not null, -- + earned, - redeemed
  redeemed_by    uuid,
  note           text,
  created_at     timestamptz not null default now()
);
create index customer_credits_customer_idx on customer_credits(venue_id, customer_id);

-- ---------------------------------------------------------------------------
-- Waitlist
-- ---------------------------------------------------------------------------
create table waitlist (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references venues(id) on delete cascade,
  slot_rule_id    uuid not null references slot_rules(id) on delete cascade,
  reserved_date   date not null,
  customer_id     uuid not null references customers(id) on delete cascade,
  party_size      int not null,
  position        int not null,
  status          waitlist_status not null default 'waiting',
  offer_expires_at timestamptz,
  created_at      timestamptz not null default now()
);
create index waitlist_queue_idx
  on waitlist(venue_id, slot_rule_id, reserved_date, position);

-- ---------------------------------------------------------------------------
-- Staff, roles, notifications, audit
-- ---------------------------------------------------------------------------
-- staff identities live in Supabase auth.users; this maps them to venues/roles.
create table venue_memberships (
  user_id  uuid not null references auth.users(id) on delete cascade,
  venue_id uuid not null references venues(id) on delete cascade,
  role     staff_role not null,
  primary key (user_id, venue_id)
);

create table notifications (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid not null references venues(id) on delete cascade,
  reservation_id uuid references reservations(id) on delete set null,
  channel        text not null,
  template       text not null,
  status         text not null default 'queued',
  sent_at        timestamptz,
  provider_ref   text,
  created_at     timestamptz not null default now()
);

create table audit_log (
  id        uuid primary key default gen_random_uuid(),
  venue_id  uuid not null references venues(id) on delete cascade,
  actor_id  uuid,
  action    text not null,
  entity    text not null,
  before    jsonb,
  after     jsonb,
  at        timestamptz not null default now()
);
create index audit_log_venue_idx on audit_log(venue_id, at desc);


-- ----- supabase/migrations/0002_rls.sql -----
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

-- Membership visibility: a user sees memberships of venues they belong to.
create policy "staff read memberships"
  on venue_memberships for select
  using (venue_id in (select auth_member_venue_ids()));

-- Only owners/managers can change memberships.
create policy "owners manage memberships"
  on venue_memberships for all
  using (
    venue_id in (
      select venue_id from venue_memberships
      where user_id = auth.uid() and role in ('owner','manager')
    )
  )
  with check (
    venue_id in (
      select venue_id from venue_memberships
      where user_id = auth.uid() and role in ('owner','manager')
    )
  );


-- ----- supabase/migrations/0003_seed_bruma.sql -----
-- 0003_seed_bruma.sql — BRUMA venue seed data.
-- Demonstrates that the entire venue (rooms, hours, premium rule, branding) is
-- pure data. Onboarding another venue = another seed like this, no code change.

insert into venues (id, slug, name, timezone, currency, status)
values (
  '00000000-0000-0000-0000-0000000000b1',
  'bruma', 'BRUMA', 'America/Mazatlan', 'MXN', 'active'
)
on conflict (slug) do nothing;

-- Branding: dark, warm, analog/vinyl (mirrors src/styles/tokens.css).
insert into venue_branding (venue_id, theme_tokens, font)
values (
  '00000000-0000-0000-0000-0000000000b1',
  '{
    "color-bg": "18 15 13",
    "color-surface": "28 23 20",
    "color-accent": "196 142 74",
    "color-text": "242 234 224"
  }',
  'Fraunces'
)
on conflict (venue_id) do nothing;

insert into venue_settings (venue_id) values
  ('00000000-0000-0000-0000-0000000000b1')
on conflict (venue_id) do nothing;

-- Rooms / capacities.
insert into rooms (venue_id, name, min_capacity, max_capacity, sort_order) values
  ('00000000-0000-0000-0000-0000000000b1', 'Room 1', 4, 6, 1),
  ('00000000-0000-0000-0000-0000000000b1', 'Room 2', 2, 8, 2),
  ('00000000-0000-0000-0000-0000000000b1', 'Room 3', 4, 4, 3),
  ('00000000-0000-0000-0000-0000000000b1', 'Room 4', 7, 7, 4),
  ('00000000-0000-0000-0000-0000000000b1', 'Room 5', 5, 5, 5),
  ('00000000-0000-0000-0000-0000000000b1', 'Bar',   12, 15, 6);

-- Operating hours (weekday: 0=Sun … 6=Sat). Monday omitted = closed.
-- Sun/Tue/Wed 18:00–00:00 ; Thu/Fri/Sat 18:00–02:00 (closes next day).
insert into operating_hours (venue_id, weekday, opens_at, closes_at, closes_next_day) values
  ('00000000-0000-0000-0000-0000000000b1', 0, '18:00', '00:00', false), -- Sun
  ('00000000-0000-0000-0000-0000000000b1', 2, '18:00', '00:00', false), -- Tue
  ('00000000-0000-0000-0000-0000000000b1', 3, '18:00', '00:00', false), -- Wed
  ('00000000-0000-0000-0000-0000000000b1', 4, '18:00', '02:00', true),  -- Thu
  ('00000000-0000-0000-0000-0000000000b1', 5, '18:00', '02:00', true),  -- Fri
  ('00000000-0000-0000-0000-0000000000b1', 6, '18:00', '02:00', true);  -- Sat

-- Premium rule: Fri & Sat 10pm, party > 5 → $200 MXN/person deposit.
insert into slot_rules (
  venue_id, name, weekdays, start_time, is_premium,
  deposit_per_person_cents, min_party_for_deposit
) values (
  '00000000-0000-0000-0000-0000000000b1',
  'Premium 10pm DJ', array[5, 6], '22:00', true, 20000, 6
);


-- ----- supabase/migrations/0004_booking.sql -----
-- 0004_booking.sql — secure booking RPCs (SECURITY DEFINER).
--
-- Anonymous customers never touch the reservations/customers tables directly
-- (RLS denies it). They call these two functions instead, which expose only the
-- minimum: slot availability (no PII) and atomic hold creation. All money/rule
-- math is computed server-side here, never trusted from the client.

-- ---------------------------------------------------------------------------
-- get_availability: rooms + bookable slots that fit a party on a given date,
-- excluding slots already taken, with the server-computed deposit per slot.
-- ---------------------------------------------------------------------------
create or replace function get_availability(
  p_venue_slug text,
  p_date date,
  p_party int
) returns table (
  room_id uuid,
  room_name text,
  slot_start timestamptz,
  deposit_cents int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v venues%rowtype;
  s venue_settings%rowtype;
  oh operating_hours%rowtype;
  v_dow int;
  v_open_local timestamp;
  v_close_local timestamp;
  v_step interval;
begin
  select * into v from venues where slug = p_venue_slug and status = 'active';
  if not found then return; end if;

  select * into s from venue_settings where venue_id = v.id;
  v_dow := extract(dow from p_date)::int;

  select * into oh from operating_hours where venue_id = v.id and weekday = v_dow;
  if not found then return; end if;  -- closed that weekday

  v_open_local := p_date::timestamp + oh.opens_at;
  v_close_local := p_date::timestamp + oh.closes_at
    + (case when oh.closes_next_day then interval '1 day' else interval '0 day' end);
  v_step := make_interval(mins => coalesce(s.default_slot_minutes, 120));

  return query
  with slots as (
    select gs as slot_local,
           (gs at time zone v.timezone) as slot_ts
    from generate_series(v_open_local, v_close_local - v_step, v_step) gs
  ),
  candidate as (
    select r.id as room_id, r.name as room_name, sl.slot_ts, sl.slot_local
    from rooms r
    cross join slots sl
    where r.venue_id = v.id
      and r.active
      and p_party between r.min_capacity and r.max_capacity
  )
  select
    c.room_id,
    c.room_name,
    c.slot_ts,
    coalesce((
      select sr.deposit_per_person_cents * p_party
      from slot_rules sr
      where sr.venue_id = v.id
        and sr.active
        and sr.is_premium
        and v_dow = any(sr.weekdays)
        and sr.start_time = c.slot_local::time
        and p_party >= sr.min_party_for_deposit
      limit 1
    ), 0) as deposit_cents
  from candidate c
  where not exists (
    select 1 from reservations res
    where res.room_id = c.room_id
      and res.slot_start = c.slot_ts
      and res.status in ('held', 'pending_payment', 'confirmed', 'checked_in')
  )
  order by c.slot_ts, c.room_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_hold: atomically place a held reservation. The partial unique index
-- guarantees no double-booking; the advisory lock serializes concurrent racers
-- on the same room/slot so the loser gets a clean 'slot_taken' instead of a race.
-- ---------------------------------------------------------------------------
create or replace function create_hold(
  p_venue_slug text,
  p_room_id uuid,
  p_slot_start timestamptz,
  p_party int,
  p_name text,
  p_phone text,
  p_email text default null,
  p_occasion text default null
) returns table (
  reservation_id uuid,
  status reservation_status,
  deposit_cents int,
  hold_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
-- Output params (status, deposit_cents, hold_expires_at, reservation_id) share
-- names with reservations columns used in the INSERT below; tell plpgsql to read
-- ambiguous identifiers as columns so the DML isn't rejected.
#variable_conflict use_column
declare
  v venues%rowtype;
  s venue_settings%rowtype;
  r rooms%rowtype;
  v_local_ts timestamp;
  v_slot_time time;
  v_service_date date;
  v_dow int;
  v_deposit int := 0;
  v_status reservation_status;
  v_hold_expires timestamptz;
  v_cust uuid;
  v_res reservations%rowtype;
begin
  select * into v from venues where slug = p_venue_slug and status = 'active';
  if not found then raise exception 'venue_not_found'; end if;

  select * into s from venue_settings where venue_id = v.id;

  select * into r from rooms where id = p_room_id and venue_id = v.id and active;
  if not found then raise exception 'room_not_found'; end if;

  if p_party < r.min_capacity or p_party > r.max_capacity then
    raise exception 'party_out_of_range';
  end if;

  -- Serialize concurrent holds for this exact room + slot.
  perform pg_advisory_xact_lock(
    hashtextextended(p_room_id::text || p_slot_start::text, 0)
  );

  -- Derive the service night and local time-of-day to evaluate premium rules.
  v_local_ts := p_slot_start at time zone v.timezone;
  v_slot_time := v_local_ts::time;
  v_service_date := case
    when v_local_ts::time < time '12:00' then v_local_ts::date - 1
    else v_local_ts::date
  end;
  v_dow := extract(dow from v_service_date)::int;

  -- Deposit computed server-side from slot_rules (never trust the client).
  select coalesce(sr.deposit_per_person_cents * p_party, 0)
    into v_deposit
  from slot_rules sr
  where sr.venue_id = v.id
    and sr.active
    and sr.is_premium
    and v_dow = any(sr.weekdays)
    and sr.start_time = v_slot_time
    and p_party >= sr.min_party_for_deposit
  limit 1;
  v_deposit := coalesce(v_deposit, 0);

  -- No deposit → confirm immediately. Deposit due → hold until payment clears.
  if v_deposit > 0 then
    v_status := 'held';
    v_hold_expires := now() + make_interval(mins => coalesce(s.hold_ttl_minutes, 10));
  else
    v_status := 'confirmed';
    v_hold_expires := null;
  end if;

  -- Upsert the CRM customer record (dedup by phone within the venue).
  insert into customers (venue_id, name, phone, email)
  values (v.id, p_name, p_phone, p_email)
  on conflict (venue_id, phone) do update
    set name = excluded.name,
        email = coalesce(excluded.email, customers.email)
  returning id into v_cust;

  begin
    insert into reservations (
      venue_id, room_id, customer_id, status, reserved_date,
      slot_start, slot_end, party_size, deposit_required, deposit_cents,
      special_occasion, source, hold_expires_at
    ) values (
      v.id, p_room_id, v_cust, v_status, v_service_date,
      p_slot_start,
      p_slot_start + make_interval(mins => coalesce(s.default_slot_minutes, 120)),
      p_party, v_deposit > 0, v_deposit,
      p_occasion, 'web', v_hold_expires
    )
    returning * into v_res;
  exception when unique_violation then
    raise exception 'slot_taken' using errcode = '23505';
  end;

  reservation_id := v_res.id;
  status := v_res.status;
  deposit_cents := v_res.deposit_cents;
  hold_expires_at := v_res.hold_expires_at;
  return next;
end;
$$;

grant execute on function get_availability(text, date, int) to anon, authenticated;
grant execute on function create_hold(
  text, uuid, timestamptz, int, text, text, text, text
) to anon, authenticated;

