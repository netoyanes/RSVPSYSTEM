-- 0008_bot.sql — omnichannel conversational bot state.
-- The bot runs server-side with the service role (bypasses RLS) to read/write
-- these tables. Staff get read access (venue-scoped) so handoffs are visible.

create table bot_conversations (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid not null references venues(id) on delete cascade,
  channel        text not null,            -- whatsapp | instagram
  external_id    text not null,            -- wa_id (phone) or IG-scoped sender id
  profile_name   text,
  customer_id    uuid references customers(id) on delete set null,
  flow           text not null default 'idle',   -- idle | reserve
  step           text,                            -- date | party | choice | name | phone
  context        jsonb not null default '{}',
  locale         text not null default 'es',
  assigned_human boolean not null default false,  -- handed off to staff
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (channel, external_id)
);
create index bot_conversations_venue_idx on bot_conversations(venue_id, updated_at desc);

create table bot_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references bot_conversations(id) on delete cascade,
  venue_id        uuid not null references venues(id) on delete cascade,
  direction       text not null,            -- in | out
  text            text not null,
  created_at      timestamptz not null default now()
);
create index bot_messages_conversation_idx on bot_messages(conversation_id, created_at);

alter table bot_conversations enable row level security;
alter table bot_messages      enable row level security;

-- Staff (venue members) can read conversations + messages for their venues.
create policy "staff read bot conversations"
  on bot_conversations for select
  using (venue_id in (select auth_member_venue_ids()));

create policy "staff read bot messages"
  on bot_messages for select
  using (venue_id in (select auth_member_venue_ids()));

-- Realtime so staff can watch handoffs live (optional, mirrors reservations).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'bot_conversations'
  ) then
    alter publication supabase_realtime add table bot_conversations;
  end if;
end $$;
