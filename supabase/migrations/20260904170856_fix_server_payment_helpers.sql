create or replace function public.attach_booking_checkout(
  p_booking_id uuid, p_checkout_session_id text, p_amount_cents integer,
  p_currency text, p_expires_at timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings set
    stripe_checkout_session_id = p_checkout_session_id,
    payment_amount_cents = p_amount_cents,
    payment_currency = lower(p_currency),
    payment_expires_at = p_expires_at
  where id = p_booking_id and status = 'pending_payment' and payment_status = 'pending'
    and stripe_checkout_session_id is null;
  return found;
end;
$$;
revoke all on function public.attach_booking_checkout(uuid, text, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.attach_booking_checkout(uuid, text, integer, text, timestamptz) to service_role;

create or replace function public.cancel_own_pending_booking(p_booking_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_slot_id uuid;
begin
  update public.bookings set status='cancelled', payment_status='failed'
    where id=p_booking_id and status='pending_payment'
    returning slot_id into v_slot_id;
  if v_slot_id is not null then
    update public.consultation_slots set status='available' where id=v_slot_id and status='booked';
    return true;
  end if;
  return false;
end;
$$;
revoke all on function public.cancel_own_pending_booking(uuid) from public, anon, authenticated;
grant execute on function public.cancel_own_pending_booking(uuid) to service_role;

notify pgrst, 'reload schema';
