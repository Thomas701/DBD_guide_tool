begin;

create table public.app_administrators (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.app_administrators enable row level security;
revoke all on public.app_administrators from public, anon, authenticated;

insert into public.app_administrators(user_id)
  select id from auth.users where lower(email) = 'mynoteet@gmail.com' and email_confirmed_at is not null;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.app_administrators where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create function public.protect_perk_customizations() returns trigger
language plpgsql security definer set search_path = '' as $$
declare previous jsonb := case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end;
begin
  if auth.uid() is not null and not public.is_admin() and (
    new.data->'dbd-build-tool.perk-description-overrides' is distinct from previous->'dbd-build-tool.perk-description-overrides'
    or new.data->'dbd-build-tool.perk-category-overrides' is distinct from previous->'dbd-build-tool.perk-category-overrides'
  ) then raise exception 'Administrator permission required for perk changes' using errcode = '42501'; end if;
  return new;
end;
$$;
revoke all on function public.protect_perk_customizations() from public, anon, authenticated;
create trigger protect_perk_customizations before insert or update on public.user_workspaces
  for each row execute function public.protect_perk_customizations();

create or replace function public.edit_player_match(match_id text, changes jsonb default null, remove_match boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare sync_at timestamptz;
begin
  if not public.is_admin() then raise exception 'Administrator permission required for match changes' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  sync_at := clock_timestamp();
  if not remove_match and (jsonb_typeof(changes) is distinct from 'object' or changes->>'id' is distinct from match_id
    or octet_length(changes::text) > 65536) then raise exception 'Invalid match' using errcode = '22023'; end if;
  update public.player_matches set entry = case when remove_match then entry else changes end, edited = true, deleted = remove_match, updated_at = sync_at
    where user_id = auth.uid() and player_matches.match_id = edit_player_match.match_id;
  if not found then raise exception 'Match not found' using errcode = '22023'; end if;
  update public.player_statistics set updated_at = sync_at where user_id = auth.uid();
end;
$$;

commit;
