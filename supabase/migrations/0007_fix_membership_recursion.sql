-- 0007_fix_membership_recursion.sql
-- The "staff read memberships" and "owners manage memberships" policies query
-- venue_memberships from within a policy ON venue_memberships. SECURITY DEFINER
-- did not bypass RLS in practice, so evaluation recursed infinitely
-- ("infinite recursion detected in policy for relation venue_memberships"),
-- aborting every read and blocking /admin. Drop them; keep only the simple,
-- non-recursive self-read policy.

drop policy if exists "staff read memberships" on venue_memberships;
drop policy if exists "owners manage memberships" on venue_memberships;

drop policy if exists "read own memberships" on venue_memberships;
create policy "read own memberships"
  on venue_memberships for select
  using (user_id = auth.uid());
