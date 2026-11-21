create extension if not exists pgcrypto with schema extensions;

create table public.user_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.user_workspaces enable row level security;
create policy "Read own workspace" on public.user_workspaces for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.user_workspaces from anon, authenticated;
grant select on public.user_workspaces to authenticated;

create function public.save_workspace(workspace_data jsonb, expected_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); next_revision bigint;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if expected_revision < 0 or expected_revision is null or jsonb_typeof(workspace_data) is distinct from 'object'
    or octet_length(workspace_data::text) > 5242880 then
    raise exception 'Invalid workspace' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(workspace_data) as item where jsonb_typeof(item.value) <> 'string' or item.key <> all(array[
    'dbd-build-tool.builds', 'dbd-build-tool.current-session', 'dbd-build-tool.perk-description-overrides',
    'dbd-build-tool.perk-category-overrides', 'dbd-build-tool.tier-overrides', 'dbd-build-tool.assistant-conversations',
    'dbd-build-tool.assistant-build-keys', 'dbd-build-tool.assistant-session', 'dbd-build-tool.assistant-provider'
  ])) then raise exception 'Invalid workspace keys' using errcode = '22023'; end if;
  if expected_revision = 0 then
    insert into public.user_workspaces(user_id, data) values (owner_id, workspace_data)
      on conflict (user_id) do nothing returning revision into next_revision;
  else
    update public.user_workspaces set data = workspace_data, revision = revision + 1, updated_at = now()
      where user_id = owner_id and revision = expected_revision returning revision into next_revision;
  end if;
  if next_revision is null then raise exception 'Workspace changed on another device' using errcode = '40001'; end if;
  return next_revision;
end;
$$;
revoke all on function public.save_workspace(jsonb, bigint) from public, anon;
grant execute on function public.save_workspace(jsonb, bigint) to authenticated;

create table public.player_statistics (
  user_id uuid primary key references auth.users(id) on delete cascade,
  overview jsonb,
  updated_at timestamptz,
  fetched_count integer not null default 0,
  imported_count integer not null default 0
);
create table public.player_matches (
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id text not null,
  entry jsonb not null,
  updated_at timestamptz not null default now(),
  edited boolean not null default false,
  deleted boolean not null default false,
  primary key (user_id, match_id)
);
create index player_matches_changes on public.player_matches(user_id, updated_at, match_id);
create table public.statistics_collectors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  state text not null default 'waiting_for_login' check (state in ('waiting_for_login', 'success', 'error')),
  message text not null default 'Connectez-vous à Behaviour dans votre navigateur.'
);
alter table public.player_statistics enable row level security;
alter table public.player_matches enable row level security;
alter table public.statistics_collectors enable row level security;
create policy "Read own statistics" on public.player_statistics for select to authenticated using ((select auth.uid()) = user_id);
create policy "Read own matches" on public.player_matches for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.player_statistics, public.player_matches, public.statistics_collectors from anon, authenticated;
grant select on public.player_statistics, public.player_matches to authenticated;

create function public.create_statistics_collector() returns text
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.statistics_collectors(user_id, token_hash) values (owner_id, extensions.digest(token, 'sha256'))
    on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = now(), last_seen_at = null,
      state = 'waiting_for_login', message = 'Connectez-vous à Behaviour dans votre navigateur.';
  return token;
end;
$$;

create function public.revoke_statistics_collector() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  delete from public.statistics_collectors where user_id = auth.uid();
end;
$$;

create function public.statistics_collector_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('connected', true, 'state', state, 'message', message, 'lastSeenAt', last_seen_at)
    from public.statistics_collectors where user_id = auth.uid()),
    '{"connected": false, "state": "waiting_for_login", "message": "Connectez l’extension pour importer vos statistiques.", "lastSeenAt": null}'::jsonb);
$$;

create function public.ingest_player_statistics(collector_token text, statistics jsonb default null, matches jsonb default '[]'::jsonb,
  collector_state text default 'success', collector_message text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare owner_id uuid; item jsonb; merged_entry jsonb; sync_at timestamptz; inserted integer := 0; affected integer;
begin
  if collector_token is null or length(collector_token) <> 64 then raise exception 'Invalid collector' using errcode = '42501'; end if;
  select user_id into owner_id from public.statistics_collectors where token_hash = extensions.digest(collector_token, 'sha256');
  if owner_id is null then raise exception 'Collector revoked' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  sync_at := clock_timestamp();
  if collector_state not in ('waiting_for_login', 'success', 'error') or collector_state is null
    or jsonb_typeof(matches) is distinct from 'array' or jsonb_array_length(matches) > 200
    or octet_length(matches::text) > 2097152 or length(collector_message) > 500 then
    raise exception 'Invalid statistics payload' using errcode = '22023';
  end if;
  if statistics is not null and (
    jsonb_typeof(statistics) is distinct from 'object' or octet_length(statistics::text) > 4096
    or jsonb_typeof(statistics->'hoursPlayed') is distinct from 'string'
    or jsonb_typeof(statistics->'matchesPlayed') is distinct from 'string'
    or jsonb_typeof(statistics->'bloodpointsEarned') is distinct from 'string'
    or statistics->>'sourceUrl' is distinct from 'https://stats.deadbydaylight.com/statistics/'
  ) then raise exception 'Invalid overview' using errcode = '22023'; end if;
  for item in select value from jsonb_array_elements(matches) loop
    if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'id', '') !~ '^[a-f0-9]{40}$'
      or jsonb_typeof(item->'characterName') is distinct from 'string'
      or coalesce(item->>'role', '') not in ('killer', 'survivor', 'unknown')
      or item->>'sourceUrl' is distinct from 'https://stats.deadbydaylight.com/match-history/'
      or jsonb_typeof(item->'participants') is distinct from 'array'
    then raise exception 'Invalid match' using errcode = '22023'; end if;
    insert into public.player_matches(user_id, match_id, entry, updated_at) values (owner_id, item->>'id', item, sync_at)
      on conflict (user_id, match_id) do nothing;
    get diagnostics affected = row_count;
    inserted := inserted + affected;
    if affected = 0 then
      select entry || item || jsonb_build_object('participants', (
        select coalesce(jsonb_agg(coalesce(player_matches.entry->'participants'->((participant.ordinality - 1)::integer), '{}'::jsonb)
          || participant.value order by participant.ordinality), '[]'::jsonb)
        from jsonb_array_elements(item->'participants') with ordinality as participant(value, ordinality)
      )) into merged_entry from public.player_matches where user_id = owner_id and match_id = item->>'id';
      update public.player_matches set entry = merged_entry, updated_at = sync_at
        where user_id = owner_id and match_id = item->>'id' and not edited and not deleted and entry is distinct from merged_entry;
    end if;
  end loop;
  if collector_state = 'success' then
    insert into public.player_statistics(user_id, overview, updated_at, fetched_count, imported_count)
      values (owner_id, statistics, sync_at, jsonb_array_length(matches), inserted)
      on conflict (user_id) do update set overview = coalesce(excluded.overview, public.player_statistics.overview),
        updated_at = sync_at, fetched_count = excluded.fetched_count, imported_count = excluded.imported_count;
  end if;
  update public.statistics_collectors set last_seen_at = now(), state = collector_state, message = collector_message where user_id = owner_id;
  return jsonb_build_object('importedCount', inserted);
end;
$$;

create function public.edit_player_match(match_id text, changes jsonb default null, remove_match boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare sync_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
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

revoke all on function public.create_statistics_collector(), public.revoke_statistics_collector(), public.statistics_collector_status(), public.edit_player_match(text, jsonb, boolean) from public, anon;
grant execute on function public.create_statistics_collector(), public.revoke_statistics_collector(), public.statistics_collector_status(), public.edit_player_match(text, jsonb, boolean) to authenticated;
revoke all on function public.ingest_player_statistics(text, jsonb, jsonb, text, text) from public;
grant execute on function public.ingest_player_statistics(text, jsonb, jsonb, text, text) to anon, authenticated;
