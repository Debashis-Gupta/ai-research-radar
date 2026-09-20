-- Existing projects: run this in the SQL Editor once. Safe to rerun.
alter table public.radar_profiles
  add column if not exists youtube_channels jsonb not null default '[]'
  check (jsonb_typeof(youtube_channels) = 'array' and jsonb_array_length(youtube_channels) <= 30);
