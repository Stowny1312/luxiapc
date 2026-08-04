create table public.consultation_slots (
  id uuid primary key default gen_random_uuid(),
  slot_type text not null check (slot_type in ('consultation', 'coaching')),
  duration_minutes integer not null check (duration_minutes in (20, 60)),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'available' check (status in ('available', 'booked', 'cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consultation_slots_duration_matches_type check (
    (slot_type = 'consultation' and duration_minutes = 20)
    or (slot_type = 'coaching' and duration_minutes = 60)
  ),
  constraint consultation_slots_time_range check (
    ends_at = starts_at + (duration_minutes * interval '1 minute')
  ),
  constraint consultation_slots_no_overlap exclude using gist (
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('available', 'booked'))
);

create index consultation_slots_available_starts_at_idx
  on public.consultation_slots (starts_at)
  where status = 'available';

create index consultation_slots_created_by_idx
  on public.consultation_slots (created_by);

alter table public.bookings
  add column if not exists slot_id uuid references public.consultation_slots(id) on delete restrict,
  add column if not exists client_name text,
  add column if not exists client_email text,
  add column if not exists client_phone text,
  add column if not exists preferred_contact text,
  add column if not exists client_message text;

create unique index if not exists bookings_slot_id_idx
  on public.bookings (slot_id)
  where slot_id is not null;

create index if not exists bookings_user_id_idx
  on public.bookings (user_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookings_preferred_contact_check'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_preferred_contact_check
      check (preferred_contact is null or preferred_contact in ('email', 'phone'));
  end if;
end
$$;

alter table public.consultation_slots enable row level security;

drop policy if exists "Public can read available consultation slots" on public.consultation_slots;
create policy "Public can read available consultation slots"
  on public.consultation_slots
  for select
  to anon, authenticated
  using (
    status = 'available'
    and starts_at >= now()
    and starts_at < now() + interval '180 days'
  );

drop policy if exists "Owner can read all consultation slots" on public.consultation_slots;
create policy "Owner can read all consultation slots"
  on public.consultation_slots
  for select
  to authenticated
  using (
    coalesce((select auth.jwt() -> 'app_metadata' ->> 'luxia_role'), '') = 'owner'
  );

drop policy if exists "Owner can create consultation slots" on public.consultation_slots;
create policy "Owner can create consultation slots"
  on public.consultation_slots
  for insert
  to authenticated
  with check (
    coalesce((select auth.jwt() -> 'app_metadata' ->> 'luxia_role'), '') = 'owner'
    and created_by = (select auth.uid())
  );

drop policy if exists "Owner can update consultation slots" on public.consultation_slots;
create policy "Owner can update consultation slots"
  on public.consultation_slots
  for update
  to authenticated
  using (
    coalesce((select auth.jwt() -> 'app_metadata' ->> 'luxia_role'), '') = 'owner'
  )
  with check (
    coalesce((select auth.jwt() -> 'app_metadata' ->> 'luxia_role'), '') = 'owner'
  );

drop policy if exists "Owner can delete available consultation slots" on public.consultation_slots;
create policy "Owner can delete available consultation slots"
  on public.consultation_slots
  for delete
  to authenticated
  using (
    coalesce((select auth.jwt() -> 'app_metadata' ->> 'luxia_role'), '') = 'owner'
    and status = 'available'
  );

drop policy if exists "Clients can create their own bookings" on public.bookings;

drop policy if exists "Clients can read their own bookings" on public.bookings;
create policy "Clients can read their own bookings"
  on public.bookings
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Owner can read all bookings" on public.bookings;
create policy "Owner can read all bookings"
  on public.bookings
  for select
  to authenticated
  using (
    coalesce((select auth.jwt() -> 'app_metadata' ->> 'luxia_role'), '') = 'owner'
  );

drop policy if exists "Owner can update bookings" on public.bookings;
create policy "Owner can update bookings"
  on public.bookings
  for update
  to authenticated
  using (
    coalesce((select auth.jwt() -> 'app_metadata' ->> 'luxia_role'), '') = 'owner'
  )
  with check (
    coalesce((select auth.jwt() -> 'app_metadata' ->> 'luxia_role'), '') = 'owner'
  );

drop trigger if exists consultation_slots_set_updated_at on public.consultation_slots;
create trigger consultation_slots_set_updated_at
  before update on public.consultation_slots
  for each row
  execute function public.set_updated_at();

create or replace function public.book_consultation_slot(
  p_slot_id uuid,
  p_preferred_contact text default 'email',
  p_phone text default null,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_slot public.consultation_slots%rowtype;
  v_booking_id uuid;
  v_email text;
  v_metadata jsonb;
  v_name text;
  v_phone text;
begin
  if v_user_id is null then
    raise exception 'Please log in before booking a consultation.';
  end if;

  if p_preferred_contact not in ('email', 'phone') then
    raise exception 'Choose email or phone as the preferred contact method.';
  end if;

  select email, raw_user_meta_data
  into v_email, v_metadata
  from auth.users
  where id = v_user_id;

  if v_email is null then
    raise exception 'Your account email could not be verified.';
  end if;

  v_name := trim(concat_ws(' ', v_metadata ->> 'first_name', v_metadata ->> 'last_name'));
  if v_name = '' then
    v_name := split_part(v_email, '@', 1);
  end if;

  v_phone := coalesce(nullif(trim(p_phone), ''), nullif(trim(v_metadata ->> 'phone'), ''));
  if p_preferred_contact = 'phone' and v_phone is null then
    raise exception 'Add a phone number to be contacted by phone.';
  end if;

  select *
  into v_slot
  from public.consultation_slots
  where id = p_slot_id
    and status = 'available'
    and starts_at > now()
  for update;

  if not found then
    raise exception 'This time is no longer available. Please choose another slot.';
  end if;

  insert into public.bookings (
    slot_id,
    user_id,
    session_type,
    starts_at,
    ends_at,
    status,
    client_name,
    client_email,
    client_phone,
    preferred_contact,
    client_message,
    notes
  ) values (
    v_slot.id,
    v_user_id,
    v_slot.slot_type,
    v_slot.starts_at,
    v_slot.ends_at,
    'upcoming',
    v_name,
    lower(v_email),
    v_phone,
    p_preferred_contact,
    nullif(left(trim(coalesce(p_message, '')), 2000), ''),
    nullif(left(trim(coalesce(p_message, '')), 2000), '')
  )
  returning id into v_booking_id;

  update public.consultation_slots
  set status = 'booked'
  where id = v_slot.id;

  return v_booking_id;
end;
$$;

revoke all on public.consultation_slots from public, anon, authenticated;
grant select on public.consultation_slots to anon, authenticated;
grant insert, update, delete on public.consultation_slots to authenticated;

revoke insert on public.bookings from anon, authenticated;
grant select on public.bookings to authenticated;
grant update on public.bookings to authenticated;

revoke execute on function public.book_consultation_slot(uuid, text, text, text)
  from public, anon;
grant execute on function public.book_consultation_slot(uuid, text, text, text)
  to authenticated;
