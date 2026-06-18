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
