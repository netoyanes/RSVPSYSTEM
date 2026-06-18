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
