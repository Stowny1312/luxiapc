-- Record explicit acceptance of the legal policy version used for account creation
-- and every booking. These records are intentionally append-only to clients.
alter table public.profiles
  add column if not exists legal_policy_version text,
  add column if not exists legal_policy_accepted_at timestamptz;

alter table public.bookings
  add column if not exists legal_policy_version text,
  add column if not exists legal_policy_accepted_at timestamptz;

create table if not exists public.legal_acceptances (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  context text not null check (context in ('account', 'booking')),
  policy_version text not null,
  accepted_at timestamptz not null default now()
);

create index if not exists legal_acceptances_user_id_idx
  on public.legal_acceptances (user_id, accepted_at desc);

alter table public.legal_acceptances enable row level security;
revoke all on table public.legal_acceptances from public, anon, authenticated;
grant select on table public.legal_acceptances to authenticated;

drop policy if exists "Owner can read legal acceptances" on public.legal_acceptances;
create policy "Owner can read legal acceptances"
  on public.legal_acceptances for select
  to authenticated
  using (coalesce((select auth.jwt() -> 'app_metadata' ->> 'luxia_role'), '') = 'owner');

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy_version text := new.raw_user_meta_data ->> 'legal_policy_version';
  v_accepted_at timestamptz;
begin
  if v_policy_version <> '2026-09-29'
    or nullif(new.raw_user_meta_data ->> 'legal_policy_accepted_at', '') is null then
    raise exception 'Acceptance of the current Terms and Conditions and Privacy Notice is required.';
  end if;

  begin
    v_accepted_at := (new.raw_user_meta_data ->> 'legal_policy_accepted_at')::timestamptz;
  exception when others then
    raise exception 'The legal policy acceptance timestamp is invalid.';
  end;

  insert into public.profiles (
    id, first_name, last_name, date_of_birth, gender,
    legal_policy_version, legal_policy_accepted_at
  ) values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    nullif(new.raw_user_meta_data ->> 'date_of_birth', '')::date,
    coalesce(new.raw_user_meta_data ->> 'gender', 'other'),
    v_policy_version,
    v_accepted_at
  )
  on conflict (id) do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    date_of_birth = excluded.date_of_birth,
    gender = excluded.gender,
    legal_policy_version = excluded.legal_policy_version,
    legal_policy_accepted_at = excluded.legal_policy_accepted_at;

  insert into public.legal_acceptances (user_id, context, policy_version, accepted_at)
  values (new.id, 'account', v_policy_version, v_accepted_at);

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop function if exists public.book_consultation_slot(uuid, text, text, text);

create function public.book_consultation_slot(
  p_slot_id uuid,
  p_preferred_contact text default 'email',
  p_phone text default null,
  p_message text default null,
  p_legal_consent boolean default false,
  p_legal_policy_version text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_slot public.consultation_slots%rowtype;
  v_booking_id uuid;
  v_email text;
  v_metadata jsonb;
  v_name text;
  v_phone text;
begin
  if v_user_id is null then raise exception 'Authentication is required.'; end if;
  if p_preferred_contact not in ('email', 'phone') then raise exception 'Invalid preferred contact method.'; end if;
  if p_legal_consent is not true or p_legal_policy_version <> '2026-09-29' then
    raise exception 'Acceptance of the current Terms and Conditions and Cancellation Policy is required.';
  end if;

  select * into v_slot
  from public.consultation_slots
  where id = p_slot_id
  for update;

  if not found or v_slot.status <> 'available' or v_slot.starts_at <= now() then
    raise exception 'This slot is no longer available.';
  end if;

  select email, raw_user_meta_data into v_email, v_metadata
  from auth.users where id = v_user_id;
  if v_email is null then raise exception 'Your account email could not be verified.'; end if;
  v_name := trim(concat_ws(' ', v_metadata->>'first_name', v_metadata->>'last_name'));
  if v_name = '' then v_name := split_part(v_email, '@', 1); end if;
  v_phone := coalesce(nullif(trim(p_phone), ''), nullif(trim(v_metadata->>'phone'), ''));
  if p_preferred_contact = 'phone' and v_phone is null then
    raise exception 'Add a phone number to be contacted by phone.';
  end if;

  insert into public.bookings (
    slot_id, user_id, session_type, starts_at, ends_at, client_name, client_email,
    client_phone, preferred_contact, client_message, status, payment_status,
    payment_currency, payment_expires_at, legal_policy_version, legal_policy_accepted_at
  ) values (
    v_slot.id, v_user_id, v_slot.slot_type, v_slot.starts_at, v_slot.ends_at,
    v_name, lower(v_email), v_phone, p_preferred_contact,
    nullif(left(trim(coalesce(p_message, '')), 2000), ''),
    case when v_slot.slot_type = 'coaching' then 'pending_payment' else 'upcoming' end,
    case when v_slot.slot_type = 'coaching' then 'pending' else 'not_required' end,
    case when v_slot.slot_type = 'coaching' then 'eur' else null end,
    case when v_slot.slot_type = 'coaching' then now() + interval '15 minutes' else null end,
    p_legal_policy_version,
    now()
  ) returning id into v_booking_id;

  insert into public.legal_acceptances (user_id, booking_id, context, policy_version)
  values (v_user_id, v_booking_id, 'booking', p_legal_policy_version);

  update public.consultation_slots set status = 'booked' where id = v_slot.id;
  return v_booking_id;
end;
$$;

revoke all on function public.book_consultation_slot(uuid, text, text, text, boolean, text)
  from public, anon;
grant execute on function public.book_consultation_slot(uuid, text, text, text, boolean, text)
  to authenticated;

notify pgrst, 'reload schema';
