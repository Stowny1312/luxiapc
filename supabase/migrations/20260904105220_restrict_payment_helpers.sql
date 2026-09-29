revoke execute on function public.attach_booking_checkout(uuid, text, integer, text, timestamptz) from authenticated;
grant execute on function public.attach_booking_checkout(uuid, text, integer, text, timestamptz) to service_role;

revoke execute on function public.cancel_own_pending_booking(uuid) from authenticated;
grant execute on function public.cancel_own_pending_booking(uuid) to service_role;
