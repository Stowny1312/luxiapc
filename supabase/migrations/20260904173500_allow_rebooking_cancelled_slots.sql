drop index if exists public.bookings_slot_id_idx;

create unique index bookings_slot_id_idx
  on public.bookings (slot_id)
  where slot_id is not null
    and status <> 'cancelled';
