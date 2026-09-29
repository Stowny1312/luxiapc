create schema if not exists private;

create table if not exists private.booking_zoom_sessions (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  meeting_number text not null,
  meeting_passcode text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on table private.booking_zoom_sessions from public, anon, authenticated;

create or replace function public.store_booking_zoom_session(
  p_booking_id uuid,
  p_meeting_number text,
  p_meeting_passcode text,
  p_meeting_url text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if (select auth.uid()) is null
    or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'luxia_role', '') <> 'owner' then
    raise exception 'Owner access is required.';
  end if;

  if not exists (
    select 1 from public.bookings
    where id = p_booking_id and status = 'upcoming' and ends_at > now()
  ) then
    raise exception 'This booking cannot be confirmed.';
  end if;

  insert into private.booking_zoom_sessions (booking_id, meeting_number, meeting_passcode)
  values (p_booking_id, p_meeting_number, p_meeting_passcode)
  on conflict (booking_id) do update set
    meeting_number = excluded.meeting_number,
    meeting_passcode = excluded.meeting_passcode,
    updated_at = now();

  update public.bookings
  set meeting_url = p_meeting_url
  where id = p_booking_id;
end;
$$;

create or replace function public.get_booking_zoom_access(p_booking_id uuid)
returns table (
  meeting_number text,
  meeting_passcode text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_owner boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_is_owner boolean := coalesce((select auth.jwt()) -> 'app_metadata' ->> 'luxia_role', '') = 'owner';
  v_booking public.bookings%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if not found or (not v_is_owner and v_booking.user_id <> v_user_id) then
    raise exception 'Session not found.';
  end if;
  if v_booking.status <> 'upcoming' then
    raise exception 'This session is not active.';
  end if;
  if now() < v_booking.starts_at - interval '10 minutes' then
    raise exception 'This private session opens 10 minutes before the reserved time.';
  end if;
  if now() >= v_booking.ends_at then
    raise exception 'This private session has expired.';
  end if;

  return query
  select z.meeting_number, z.meeting_passcode, v_booking.starts_at, v_booking.ends_at, v_is_owner
  from private.booking_zoom_sessions z
  where z.booking_id = p_booking_id;

  if not found then
    raise exception 'This booking is waiting for owner confirmation.';
  end if;
end;
$$;

revoke all on function public.store_booking_zoom_session(uuid, text, text, text) from public, anon;
revoke all on function public.get_booking_zoom_access(uuid) from public, anon;
grant execute on function public.store_booking_zoom_session(uuid, text, text, text) to authenticated;
grant execute on function public.get_booking_zoom_access(uuid) to authenticated;
