-- Payment lifecycle for paid coaching bookings.
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings
  add constraint bookings_status_check check (status in ('pending_payment', 'upcoming', 'completed', 'cancelled'));

alter table public.bookings
  add column if not exists payment_status text not null default 'not_required',
  add column if not exists payment_amount_cents integer,
  add column if not exists payment_currency text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists payment_expires_at timestamptz,
  add column if not exists payment_completed_at timestamptz;

alter table public.bookings drop constraint if exists bookings_payment_status_check;
alter table public.bookings add constraint bookings_payment_status_check
  check (payment_status in ('not_required', 'pending', 'paid', 'failed', 'refunded'));
alter table public.bookings drop constraint if exists bookings_payment_amount_check;
alter table public.bookings add constraint bookings_payment_amount_check
  check (payment_amount_cents is null or payment_amount_cents > 0);

create unique index if not exists bookings_stripe_checkout_session_uidx
  on public.bookings (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create index if not exists bookings_pending_payment_expiry_idx
  on public.bookings (payment_expires_at)
  where status = 'pending_payment';

create or replace function public.book_consultation_slot(
  p_slot_id uuid,
  p_preferred_contact text default 'email',
  p_phone text default null,
  p_message text default null
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

  select * into v_slot from public.consultation_slots where id = p_slot_id for update;
  if not found or v_slot.status <> 'available' or v_slot.starts_at <= now() then
    raise exception 'This slot is no longer available.';
  end if;
  select email, raw_user_meta_data into v_email, v_metadata from auth.users where id = v_user_id;
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
    payment_currency, payment_expires_at
  ) values (
    v_slot.id, v_user_id, v_slot.slot_type, v_slot.starts_at, v_slot.ends_at,
    v_name, lower(v_email), v_phone, p_preferred_contact,
    nullif(trim(p_message), ''),
    case when v_slot.slot_type = 'coaching' then 'pending_payment' else 'upcoming' end,
    case when v_slot.slot_type = 'coaching' then 'pending' else 'not_required' end,
    case when v_slot.slot_type = 'coaching' then 'eur' else null end,
    case when v_slot.slot_type = 'coaching' then now() + interval '30 minutes' else null end
  ) returning id into v_booking_id;

  update public.consultation_slots set status = 'booked' where id = v_slot.id;
  return v_booking_id;
end;
$$;

revoke all on function public.book_consultation_slot(uuid, text, text, text) from public, anon;
grant execute on function public.book_consultation_slot(uuid, text, text, text) to authenticated;

create or replace function public.attach_booking_checkout(
  p_booking_id uuid, p_checkout_session_id text, p_amount_cents integer,
  p_currency text, p_expires_at timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required.'; end if;
  update public.bookings set
    stripe_checkout_session_id = p_checkout_session_id,
    payment_amount_cents = p_amount_cents,
    payment_currency = lower(p_currency),
    payment_expires_at = p_expires_at
  where id = p_booking_id and user_id = (select auth.uid())
    and status = 'pending_payment' and payment_status = 'pending'
    and stripe_checkout_session_id is null;
  return found;
end;
$$;
revoke all on function public.attach_booking_checkout(uuid, text, integer, text, timestamptz) from public, anon;
grant execute on function public.attach_booking_checkout(uuid, text, integer, text, timestamptz) to authenticated;

create or replace function public.cancel_own_pending_booking(p_booking_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_slot_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required.'; end if;
  update public.bookings set status='cancelled', payment_status='failed'
    where id=p_booking_id and user_id=(select auth.uid()) and status='pending_payment'
    returning slot_id into v_slot_id;
  if v_slot_id is not null then
    update public.consultation_slots set status='available' where id=v_slot_id and status='booked';
    return true;
  end if;
  return false;
end;
$$;
revoke all on function public.cancel_own_pending_booking(uuid) from public, anon;
grant execute on function public.cancel_own_pending_booking(uuid) to authenticated;

create or replace function public.complete_booking_payment(
  p_booking_id uuid, p_checkout_session_id text, p_payment_intent_id text,
  p_amount_cents integer, p_currency text
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings set
    status='upcoming', payment_status='paid', stripe_payment_intent_id=p_payment_intent_id,
    payment_amount_cents=p_amount_cents, payment_currency=lower(p_currency),
    payment_completed_at=coalesce(payment_completed_at, now())
  where id=p_booking_id and stripe_checkout_session_id=p_checkout_session_id
    and payment_status in ('pending','paid');
  return found;
end;
$$;
revoke all on function public.complete_booking_payment(uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.complete_booking_payment(uuid, text, text, integer, text) to service_role;

create or replace function public.expire_booking_payment(p_booking_id uuid, p_checkout_session_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_slot_id uuid;
begin
  update public.bookings set status='cancelled', payment_status='failed'
    where id=p_booking_id and stripe_checkout_session_id=p_checkout_session_id
      and status='pending_payment' and payment_status='pending'
    returning slot_id into v_slot_id;
  if v_slot_id is not null then
    update public.consultation_slots set status='available' where id=v_slot_id and status='booked';
    return true;
  end if;
  return false;
end;
$$;
revoke all on function public.expire_booking_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.expire_booking_payment(uuid, text) to service_role;

notify pgrst, 'reload schema';
