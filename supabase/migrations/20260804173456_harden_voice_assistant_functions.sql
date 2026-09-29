alter function public.register_voice_calendar_token(text, text)
  set schema private;

alter function public.apply_voice_calendar_command(text, text, text, timestamptz, integer)
  set schema private;

grant usage on schema private to anon, authenticated;

revoke all on function private.register_voice_calendar_token(text, text)
  from public, anon, authenticated;
grant execute on function private.register_voice_calendar_token(text, text)
  to authenticated;

revoke all on function private.apply_voice_calendar_command(text, text, text, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function private.apply_voice_calendar_command(text, text, text, timestamptz, integer)
  to anon;

create function public.register_voice_calendar_token(
  p_token_hash text,
  p_label text default 'Siri and Gemini'
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.register_voice_calendar_token(p_token_hash, p_label);
$$;

create function public.apply_voice_calendar_command(
  p_token text,
  p_action text,
  p_slot_type text,
  p_starts_at timestamptz,
  p_duration integer
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.apply_voice_calendar_command(
    p_token,
    p_action,
    p_slot_type,
    p_starts_at,
    p_duration
  );
$$;

revoke all on function public.register_voice_calendar_token(text, text)
  from public, anon;
grant execute on function public.register_voice_calendar_token(text, text)
  to authenticated;

revoke all on function public.apply_voice_calendar_command(text, text, text, timestamptz, integer)
  from public, authenticated;
grant execute on function public.apply_voice_calendar_command(text, text, text, timestamptz, integer)
  to anon;

create index voice_calendar_audit_slot_id_idx
  on private.voice_calendar_audit (slot_id);
