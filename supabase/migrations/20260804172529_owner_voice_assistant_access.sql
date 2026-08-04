create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table private.voice_calendar_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users(id) on delete cascade,
  token_hash bytea not null unique,
  label text not null default 'Voice assistants',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint voice_calendar_tokens_hash_length check (octet_length(token_hash) = 32),
  constraint voice_calendar_tokens_label_length check (char_length(label) between 1 and 80)
);

create table private.voice_calendar_audit (
  id bigint generated always as identity primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  slot_id uuid references public.consultation_slots(id) on delete set null,
  action text not null check (action in ('add', 'remove')),
  slot_type text not null check (slot_type in ('consultation', 'coaching')),
  starts_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes in (20, 60)),
  source text not null default 'voice_assistant',
  created_at timestamptz not null default now()
);

create index voice_calendar_audit_owner_created_idx
  on private.voice_calendar_audit (owner_user_id, created_at desc);

alter table private.voice_calendar_tokens enable row level security;
alter table private.voice_calendar_audit enable row level security;

revoke all on private.voice_calendar_tokens from public, anon, authenticated;
revoke all on private.voice_calendar_audit from public, anon, authenticated;

create or replace function public.register_voice_calendar_token(
  p_token_hash text,
  p_label text default 'Siri and Gemini'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_label text := left(trim(coalesce(p_label, 'Voice assistants')), 80);
begin
  if v_user_id is null then
    raise exception 'Please log in before connecting a voice assistant.';
  end if;

  if coalesce((select auth.jwt()) -> 'app_metadata' ->> 'luxia_role', '') <> 'owner' then
    raise exception 'Owner access is required.' using errcode = '42501';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'The voice credential is not valid.';
  end if;

  if v_label = '' then
    v_label := 'Voice assistants';
  end if;

  insert into private.voice_calendar_tokens (
    owner_user_id,
    token_hash,
    label
  ) values (
    v_user_id,
    decode(p_token_hash, 'hex'),
    v_label
  )
  on conflict (owner_user_id) do update set
    token_hash = excluded.token_hash,
    label = excluded.label,
    created_at = now(),
    last_used_at = null,
    revoked_at = null;
end;
$$;

create or replace function public.apply_voice_calendar_command(
  p_token text,
  p_action text,
  p_slot_type text,
  p_starts_at timestamptz,
  p_duration integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_slot_id uuid;
  v_slot_type text;
  v_duration integer;
  v_ends_at timestamptz;
  v_message text;
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 200 then
    raise exception 'Voice credential rejected.' using errcode = '42501';
  end if;

  select owner_user_id
  into v_owner_id
  from private.voice_calendar_tokens
  where token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
    and revoked_at is null
  for update;

  if v_owner_id is null then
    raise exception 'Voice credential rejected.' using errcode = '42501';
  end if;

  if p_action not in ('add', 'remove') then
    raise exception 'The command must add or remove a slot.';
  end if;

  if p_starts_at is null
    or p_starts_at < now() - interval '15 minutes'
    or p_starts_at > now() + interval '365 days' then
    raise exception 'Choose a valid future date within the next year.';
  end if;

  if p_action = 'add' then
    if p_starts_at <= now() then
      raise exception 'New availability must be in the future.';
    end if;

    if not (
      (p_slot_type = 'consultation' and p_duration = 20)
      or (p_slot_type = 'coaching' and p_duration = 60)
    ) then
      raise exception 'Choose a 20-minute consultation or a 60-minute coaching session.';
    end if;

    v_slot_type := p_slot_type;
    v_duration := p_duration;
    v_ends_at := p_starts_at + (p_duration * interval '1 minute');

    begin
      insert into public.consultation_slots (
        slot_type,
        duration_minutes,
        starts_at,
        ends_at,
        status,
        created_by
      ) values (
        v_slot_type,
        v_duration,
        p_starts_at,
        v_ends_at,
        'available',
        v_owner_id
      )
      returning id into v_slot_id;
    exception
      when exclusion_violation then
        raise exception 'That time overlaps another published or booked slot.';
    end;

    v_message := case
      when v_duration = 20 then 'The 20-minute consultation slot was added.'
      else 'The one-hour coaching slot was added.'
    end;
  else
    select id, slot_type, duration_minutes
    into v_slot_id, v_slot_type, v_duration
    from public.consultation_slots
    where created_by = v_owner_id
      and status = 'available'
      and starts_at between p_starts_at - interval '1 minute' and p_starts_at + interval '1 minute'
    order by abs(extract(epoch from (starts_at - p_starts_at)))
    limit 1
    for update;

    if v_slot_id is null then
      raise exception 'No free slot was found at that date and time.';
    end if;

    update public.consultation_slots
    set status = 'cancelled'
    where id = v_slot_id;

    v_message := 'The free slot was removed.';
  end if;

  update private.voice_calendar_tokens
  set last_used_at = now()
  where owner_user_id = v_owner_id;

  insert into private.voice_calendar_audit (
    owner_user_id,
    slot_id,
    action,
    slot_type,
    starts_at,
    duration_minutes
  ) values (
    v_owner_id,
    v_slot_id,
    p_action,
    v_slot_type,
    p_starts_at,
    v_duration
  );

  return jsonb_build_object(
    'ok', true,
    'message', v_message,
    'action', p_action,
    'slot_id', v_slot_id,
    'slot_type', v_slot_type,
    'duration_minutes', v_duration,
    'starts_at', p_starts_at
  );
end;
$$;

revoke all on function public.register_voice_calendar_token(text, text)
  from public, anon;
grant execute on function public.register_voice_calendar_token(text, text)
  to authenticated;

revoke all on function public.apply_voice_calendar_command(text, text, text, timestamptz, integer)
  from public, authenticated;
grant execute on function public.apply_voice_calendar_command(text, text, text, timestamptz, integer)
  to anon;
