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
