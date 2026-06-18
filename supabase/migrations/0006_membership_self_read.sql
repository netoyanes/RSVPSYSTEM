-- 0006_membership_self_read.sql
-- The original venue-scoped membership read policy resolved to no rows via its
-- helper function, blocking /admin ("Sin acceso"). Add a simple, non-recursive
-- policy so a signed-in staff member can always read their OWN membership rows.

drop policy if exists "read own memberships" on venue_memberships;
create policy "read own memberships"
  on venue_memberships for select
  using (user_id = auth.uid());
