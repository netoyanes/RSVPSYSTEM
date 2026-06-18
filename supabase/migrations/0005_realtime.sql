-- 0005_realtime.sql — enable Supabase Realtime on reservations so the staff
-- floor panel updates live. RLS still applies: a staff device only receives
-- changes for rows in venues it belongs to.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reservations'
  ) then
    alter publication supabase_realtime add table reservations;
  end if;
end $$;
