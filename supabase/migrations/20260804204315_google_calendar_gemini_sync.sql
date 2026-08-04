create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create table private.google_calendar_integrations (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  feed_url text not null,
  enabled boolean not null default true,
  last_sync_started_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_integrations_feed_url_length
    check (char_length(feed_url) between 40 and 2048)
);

alter table private.google_calendar_integrations enable row level security;

revoke all on private.google_calendar_integrations
  from public, anon, authenticated;

alter table public.consultation_slots
  add column if not exists external_provider text,
  add column if not exists external_event_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'consultation_slots_external_source_check'
      and conrelid = 'public.consultation_slots'::regclass
  ) then
    alter table public.consultation_slots
      add constraint consultation_slots_external_source_check
      check (
        (external_provider is null and external_event_id is null)
        or (
          external_provider = 'google_calendar'
          and external_event_id is not null
          and char_length(external_event_id) between 1 and 512
        )
      );
  end if;
end
$$;

create unique index if not exists consultation_slots_external_event_idx
  on public.consultation_slots (external_provider, external_event_id)
  where external_provider is not null and external_event_id is not null;

create index if not exists consultation_slots_google_available_idx
  on public.consultation_slots (starts_at)
  where external_provider = 'google_calendar' and status = 'available';

create or replace function private.configure_google_calendar_feed(
  p_feed_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_feed_url text := trim(coalesce(p_feed_url, ''));
begin
  if v_user_id is null then
    raise exception 'Please log in before connecting Google Calendar.';
  end if;

  if coalesce((select auth.jwt()) -> 'app_metadata' ->> 'luxia_role', '') <> 'owner' then
    raise exception 'Owner access is required.' using errcode = '42501';
  end if;

  if char_length(v_feed_url) > 2048
    or v_feed_url !~ '^https://calendar[.]google[.]com/calendar/ical/[^/?#]+/(public|private-[A-Za-z0-9_-]+)/basic[.]ics$' then
    raise exception 'Paste the Google Calendar address ending in /basic.ics.';
  end if;

  insert into private.google_calendar_integrations (
    owner_user_id,
    feed_url,
    enabled
  ) values (
    v_user_id,
    v_feed_url,
    true
  )
  on conflict (owner_user_id) do update set
    feed_url = excluded.feed_url,
    enabled = true,
    last_sync_started_at = null,
    last_error = null,
    updated_at = now();

  return jsonb_build_object(
    'configured', true,
    'enabled', true,
    'message', 'Google Calendar is connected.'
  );
end;
$$;

create or replace function private.get_google_calendar_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Please log in before viewing Google Calendar status.';
  end if;

  if coalesce((select auth.jwt()) -> 'app_metadata' ->> 'luxia_role', '') <> 'owner' then
    raise exception 'Owner access is required.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'configured', true,
    'enabled', integration.enabled,
    'last_sync_started_at', integration.last_sync_started_at,
    'last_synced_at', integration.last_synced_at,
    'last_error', integration.last_error
  )
  into v_result
  from private.google_calendar_integrations as integration
  where integration.owner_user_id = v_user_id;

  return coalesce(
    v_result,
    jsonb_build_object(
      'configured', false,
      'enabled', false,
      'last_sync_started_at', null,
      'last_synced_at', null,
      'last_error', null
    )
  );
end;
$$;

create or replace function private.disable_google_calendar_feed()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_cancelled integer;
begin
  if v_user_id is null then
    raise exception 'Please log in before disconnecting Google Calendar.';
  end if;

  if coalesce((select auth.jwt()) -> 'app_metadata' ->> 'luxia_role', '') <> 'owner' then
    raise exception 'Owner access is required.' using errcode = '42501';
  end if;

  update private.google_calendar_integrations
  set enabled = false,
      last_sync_started_at = null,
      last_error = null,
      updated_at = now()
  where owner_user_id = v_user_id;

  update public.consultation_slots
  set status = 'cancelled'
  where created_by = v_user_id
    and external_provider = 'google_calendar'
    and status = 'available'
    and starts_at > now();

  get diagnostics v_cancelled = row_count;

  return jsonb_build_object(
    'configured', true,
    'enabled', false,
    'cancelled_slots', v_cancelled,
    'message', 'Google Calendar synchronization is disconnected.'
  );
end;
$$;

create or replace function private.claim_google_calendar_sync()
returns table (
  owner_user_id uuid,
  feed_url text
)
language sql
security definer
set search_path = ''
as $$
  update private.google_calendar_integrations as integration
  set last_sync_started_at = now(),
      updated_at = now()
  where integration.enabled
    and (
      integration.last_sync_started_at is null
      or integration.last_sync_started_at < now() - interval '45 seconds'
    )
  returning integration.owner_user_id, integration.feed_url;
$$;

create or replace function private.record_google_calendar_sync_error(
  p_owner_user_id uuid,
  p_error text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.google_calendar_integrations
  set last_error = left(coalesce(p_error, 'Google Calendar synchronization failed.'), 500),
      updated_at = now()
  where owner_user_id = p_owner_user_id;
$$;

create or replace function private.apply_google_calendar_snapshot(
  p_owner_user_id uuid,
  p_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event jsonb;
  v_external_event_id text;
  v_slot_type text;
  v_duration integer;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_existing_id uuid;
  v_existing_status text;
  v_seen text[] := array[]::text[];
  v_added integer := 0;
  v_updated integer := 0;
  v_preserved integer := 0;
  v_cancelled integer := 0;
  v_skipped integer := 0;
begin
  if not exists (
    select 1
    from private.google_calendar_integrations as integration
    where integration.owner_user_id = p_owner_user_id
      and integration.enabled
  ) then
    raise exception 'Google Calendar is not connected.';
  end if;

  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'The calendar snapshot must be a JSON array.';
  end if;

  if jsonb_array_length(p_events) > 500 then
    raise exception 'The calendar snapshot contains too many events.';
  end if;

  for v_event in
    select value from jsonb_array_elements(p_events)
  loop
    begin
      v_external_event_id := trim(coalesce(v_event ->> 'external_event_id', ''));
      v_slot_type := trim(coalesce(v_event ->> 'slot_type', ''));

      if char_length(v_external_event_id) not between 1 and 512
        or v_slot_type not in ('consultation', 'coaching')
        or coalesce(v_event ->> 'duration_minutes', '') !~ '^(20|60)$'
        or coalesce(v_event ->> 'starts_at', '') = ''
        or coalesce(v_event ->> 'ends_at', '') = '' then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      v_duration := (v_event ->> 'duration_minutes')::integer;
      v_starts_at := (v_event ->> 'starts_at')::timestamptz;
      v_ends_at := (v_event ->> 'ends_at')::timestamptz;

      if not (
        (v_slot_type = 'consultation' and v_duration = 20)
        or (v_slot_type = 'coaching' and v_duration = 60)
      )
        or v_ends_at <> v_starts_at + (v_duration * interval '1 minute')
        or v_starts_at < now() - interval '15 minutes'
        or v_starts_at > now() + interval '365 days' then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      v_seen := array_append(v_seen, v_external_event_id);
      v_existing_id := null;
      v_existing_status := null;

      select slot.id, slot.status
      into v_existing_id, v_existing_status
      from public.consultation_slots as slot
      where slot.external_provider = 'google_calendar'
        and slot.external_event_id = v_external_event_id
      for update;

      if v_existing_id is not null and v_existing_status = 'booked' then
        v_preserved := v_preserved + 1;
        continue;
      end if;

      begin
        if v_existing_id is null then
          insert into public.consultation_slots (
            slot_type,
            duration_minutes,
            starts_at,
            ends_at,
            status,
            created_by,
            external_provider,
            external_event_id
          ) values (
            v_slot_type,
            v_duration,
            v_starts_at,
            v_ends_at,
            'available',
            p_owner_user_id,
            'google_calendar',
            v_external_event_id
          );
          v_added := v_added + 1;
        else
          update public.consultation_slots
          set slot_type = v_slot_type,
              duration_minutes = v_duration,
              starts_at = v_starts_at,
              ends_at = v_ends_at,
              status = 'available'
          where id = v_existing_id;
          v_updated := v_updated + 1;
        end if;
      exception
        when exclusion_violation or unique_violation then
          v_skipped := v_skipped + 1;
      end;
    exception
      when invalid_text_representation or datetime_field_overflow then
        v_skipped := v_skipped + 1;
    end;
  end loop;

  update public.consultation_slots
  set status = 'cancelled'
  where created_by = p_owner_user_id
    and external_provider = 'google_calendar'
    and status = 'available'
    and starts_at >= now() - interval '15 minutes'
    and not (external_event_id = any(v_seen));

  get diagnostics v_cancelled = row_count;

  update private.google_calendar_integrations
  set last_synced_at = now(),
      last_error = case
        when v_skipped > 0 then concat(v_skipped, ' calendar event(s) were skipped because they were invalid or overlapped another slot.')
        else null
      end,
      updated_at = now()
  where owner_user_id = p_owner_user_id;

  return jsonb_build_object(
    'ok', true,
    'added', v_added,
    'updated', v_updated,
    'booked_preserved', v_preserved,
    'cancelled', v_cancelled,
    'skipped', v_skipped
  );
end;
$$;

revoke all on function private.configure_google_calendar_feed(text)
  from public, anon, authenticated;
grant execute on function private.configure_google_calendar_feed(text)
  to authenticated;

revoke all on function private.get_google_calendar_status()
  from public, anon, authenticated;
grant execute on function private.get_google_calendar_status()
  to authenticated;

revoke all on function private.disable_google_calendar_feed()
  from public, anon, authenticated;
grant execute on function private.disable_google_calendar_feed()
  to authenticated;

revoke all on function private.claim_google_calendar_sync()
  from public, anon, authenticated;
grant execute on function private.claim_google_calendar_sync()
  to service_role;

revoke all on function private.record_google_calendar_sync_error(uuid, text)
  from public, anon, authenticated;
grant execute on function private.record_google_calendar_sync_error(uuid, text)
  to service_role;

revoke all on function private.apply_google_calendar_snapshot(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function private.apply_google_calendar_snapshot(uuid, jsonb)
  to service_role;

create function public.configure_google_calendar_feed(
  p_feed_url text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.configure_google_calendar_feed(p_feed_url);
$$;

create function public.get_google_calendar_status()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_google_calendar_status();
$$;

create function public.disable_google_calendar_feed()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.disable_google_calendar_feed();
$$;

create function public.claim_google_calendar_sync()
returns table (
  owner_user_id uuid,
  feed_url text
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.claim_google_calendar_sync();
$$;

create function public.record_google_calendar_sync_error(
  p_owner_user_id uuid,
  p_error text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.record_google_calendar_sync_error(p_owner_user_id, p_error);
$$;

create function public.apply_google_calendar_snapshot(
  p_owner_user_id uuid,
  p_events jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.apply_google_calendar_snapshot(p_owner_user_id, p_events);
$$;

revoke all on function public.configure_google_calendar_feed(text)
  from public, anon;
grant execute on function public.configure_google_calendar_feed(text)
  to authenticated;

revoke all on function public.get_google_calendar_status()
  from public, anon;
grant execute on function public.get_google_calendar_status()
  to authenticated;

revoke all on function public.disable_google_calendar_feed()
  from public, anon;
grant execute on function public.disable_google_calendar_feed()
  to authenticated;

revoke all on function public.claim_google_calendar_sync()
  from public, anon, authenticated;
grant execute on function public.claim_google_calendar_sync()
  to service_role;

revoke all on function public.record_google_calendar_sync_error(uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_google_calendar_sync_error(uuid, text)
  to service_role;

revoke all on function public.apply_google_calendar_snapshot(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_google_calendar_snapshot(uuid, jsonb)
  to service_role;

select cron.schedule(
  'luxia-google-calendar-sync',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := 'https://tapvkveybfotgskqjeof.supabase.co/functions/v1/google-calendar-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'sb_publishable__BsA8Xl7RTgowZRkw5cjSQ_K-2FaQt5',
        'Authorization', 'Bearer sb_publishable__BsA8Xl7RTgowZRkw5cjSQ_K-2FaQt5'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    ) as request_id;
  $cron$
);
