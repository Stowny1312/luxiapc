drop policy if exists "Clients can read their own profile" on public.profiles;
create policy "Clients can read their own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Clients can update their own profile" on public.profiles;
create policy "Clients can update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Clients can create their own profile" on public.profiles;
create policy "Clients can create their own profile"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Public can read available consultation slots" on public.consultation_slots;
drop policy if exists "Owner can read all consultation slots" on public.consultation_slots;
create policy "Visitors can read availability and owner can read all slots"
  on public.consultation_slots
  for select
  to anon, authenticated
  using (
    (
      status = 'available'
      and starts_at >= now()
      and starts_at < now() + interval '180 days'
    )
    or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'luxia_role', '') = 'owner'
  );

drop policy if exists "Owner can create consultation slots" on public.consultation_slots;
create policy "Owner can create consultation slots"
  on public.consultation_slots
  for insert
  to authenticated
  with check (
    coalesce((select auth.jwt()) -> 'app_metadata' ->> 'luxia_role', '') = 'owner'
    and created_by = (select auth.uid())
  );

drop policy if exists "Owner can update consultation slots" on public.consultation_slots;
create policy "Owner can update consultation slots"
  on public.consultation_slots
  for update
  to authenticated
  using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'luxia_role', '') = 'owner')
  with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'luxia_role', '') = 'owner');

drop policy if exists "Owner can delete available consultation slots" on public.consultation_slots;
create policy "Owner can delete available consultation slots"
  on public.consultation_slots
  for delete
  to authenticated
  using (
    coalesce((select auth.jwt()) -> 'app_metadata' ->> 'luxia_role', '') = 'owner'
    and status = 'available'
  );

drop policy if exists "Clients can read their own bookings" on public.bookings;
drop policy if exists "Owner can read all bookings" on public.bookings;
create policy "Clients can read their bookings and owner can read all bookings"
  on public.bookings
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'luxia_role', '') = 'owner'
  );

drop policy if exists "Owner can update bookings" on public.bookings;
create policy "Owner can update bookings"
  on public.bookings
  for update
  to authenticated
  using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'luxia_role', '') = 'owner')
  with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'luxia_role', '') = 'owner');
