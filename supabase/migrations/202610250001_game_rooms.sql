-- Private server state is never readable from the browser.
create table if not exists public.game_private (
  room_code text primary key check (length(room_code) = 6),
  version bigint not null default 1,
  owner_id uuid not null,
  game_state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours'
);

-- This contains only a visitor-safe snapshot. Reads still go through the Edge
-- Function so knowing/guessing a code alone does not expose a room.
create table if not exists public.room_public (
  room_code text primary key references public.game_private(room_code) on delete cascade,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.game_private enable row level security;
alter table public.room_public enable row level security;
revoke all on public.game_private from anon, authenticated;
revoke all on public.room_public from anon, authenticated;
grant all on public.game_private to service_role;
grant all on public.room_public to service_role;

create index if not exists game_private_expires_at_idx on public.game_private (expires_at);

-- Periodically clean abandoned rooms; invoke manually or from a scheduled job.
create or replace function public.delete_expired_game_rooms()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare removed bigint;
begin
  delete from public.game_private where expires_at < now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.delete_expired_game_rooms() from public, anon, authenticated;
grant execute on function public.delete_expired_game_rooms() to service_role;
