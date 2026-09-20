-- Run once in your Supabase project's SQL Editor before enabling sign-in.
begin;

create table public.radar_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  interests text[] not null default '{}',
  youtube_channels jsonb not null default '[]'
    check (jsonb_typeof(youtube_channels) = 'array' and jsonb_array_length(youtube_channels) <= 30),
  theme text not null default 'light' check (theme in ('light', 'dark'))
);

create table public.radar_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  item jsonb not null check (jsonb_typeof(item) = 'object'),
  primary key (user_id, item_id)
);

alter table public.radar_profiles enable row level security;
alter table public.radar_favorites enable row level security;

revoke all on public.radar_profiles, public.radar_favorites from anon, authenticated;
grant select, insert, update, delete on public.radar_profiles, public.radar_favorites to authenticated;

create policy "Users manage their own profile" on public.radar_profiles
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage their own favorites" on public.radar_favorites
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;
