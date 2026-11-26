begin;

create table public.shared_perk_names (
  perk_id text primary key check (perk_id ~ '^[a-z0-9][a-z0-9_-]{0,119}$'),
  name_fr text not null check (char_length(name_fr) between 1 and 120 and name_fr = btrim(name_fr) and name_fr !~ '[[:cntrl:]]')
);
alter table public.shared_perk_names enable row level security;
revoke all on public.shared_perk_names from public, anon, authenticated;
grant select on public.shared_perk_names to authenticated;
create policy "Read shared perk names" on public.shared_perk_names for select to authenticated using (true);

create function public.save_shared_perk_name(target_perk text, new_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Staff permission required' using errcode = '42501'; end if;
  if target_perk is null or target_perk !~ '^[a-z0-9][a-z0-9_-]{0,119}$' then
    raise exception 'Invalid perk identifier' using errcode = '22023';
  end if;
  if new_name is null then
    delete from public.shared_perk_names where perk_id = target_perk;
  else
    insert into public.shared_perk_names(perk_id, name_fr) values (target_perk, btrim(new_name))
      on conflict(perk_id) do update set name_fr = excluded.name_fr;
  end if;
end;
$$;
revoke all on function public.save_shared_perk_name(text, text) from public, anon;
grant execute on function public.save_shared_perk_name(text, text) to authenticated;

create function public.normalize_terrifier_match(entry jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
begin
  if lower(btrim(entry->>'characterName')) in ('k45', 'the terrifier') then
    entry := jsonb_set(entry, '{characterName}', '"The Terrifier"');
  end if;
  if lower(btrim(entry->>'mapName')) in ('lm_liminal', 'hartshorne mall') then
    entry := jsonb_set(entry, '{mapName}', '"Hartshorne Mall"');
  end if;
  if jsonb_typeof(entry->'participants') = 'array' and exists (
    select 1 from jsonb_array_elements(entry->'participants') as p(value)
    where lower(btrim(p.value->>'name')) in ('k45', 'the terrifier') and p.value->>'name' <> 'The Terrifier'
  ) then
    entry := jsonb_set(entry, '{participants}', (
      select jsonb_agg(case when lower(btrim(p.value->>'name')) in ('k45', 'the terrifier')
        then jsonb_set(p.value, '{name}', '"The Terrifier"') else p.value end order by p.position)
      from jsonb_array_elements(entry->'participants') with ordinality as p(value, position)
    ));
  end if;
  return entry;
end;
$$;
revoke all on function public.normalize_terrifier_match(jsonb) from public, anon, authenticated;

create function public.normalize_terrifier_match_row() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.entry := public.normalize_terrifier_match(new.entry);
  return new;
end;
$$;
revoke all on function public.normalize_terrifier_match_row() from public, anon, authenticated;
create trigger normalize_terrifier_match before insert or update of entry on public.player_matches
  for each row execute function public.normalize_terrifier_match_row();

update public.player_matches
set entry = public.normalize_terrifier_match(entry), updated_at = clock_timestamp()
where entry is distinct from public.normalize_terrifier_match(entry);

-- Rebuild the existing collector's SHA-1 for the alternative labels, including rows since edited or hidden.
create function public.terrifier_match_alias_id(entry jsonb, character_name text, map_name text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(
    '{"role":' || coalesce((entry->'role')::text, 'null')
    || ',"characterName":' || coalesce(to_json(character_name)::text, 'null')
    || ',"score":' || coalesce((entry->'score')::text, 'null')
    || ',"playedAt":' || coalesce(nullif(entry->'playedAt', 'null'), entry->'playedAtLabel', 'null')::text
    || ',"durationLabel":' || coalesce((entry->'durationLabel')::text, 'null')
    || ',"queueLabel":' || case when entry->>'queueLabel' = '2v8' then '"2v8"' else '"1v4"' end
    || ',"mapName":' || coalesce(to_json(map_name)::text, 'null') || '}', 'sha1'), 'hex');
$$;
revoke all on function public.terrifier_match_alias_id(jsonb, text, text) from public, anon, authenticated;

create function public.find_terrifier_match_id(owner_id uuid, incoming jsonb) returns text
language sql stable set search_path = '' as $$
  select m.match_id
  from public.player_matches m
  where m.user_id = owner_id and m.match_id in (
    select public.terrifier_match_alias_id(incoming, names.character_name, maps.map_name)
    from unnest(case when lower(btrim(incoming->>'characterName')) in ('k45', 'the terrifier')
      then array['K45', 'The Terrifier', incoming->>'characterName'] else array[incoming->>'characterName'] end) as names(character_name)
    cross join unnest(case when lower(btrim(incoming->>'mapName')) in ('lm_liminal', 'hartshorne mall')
      then array['LM_Liminal', 'Hartshorne Mall', incoming->>'mapName'] else array[incoming->>'mapName'] end) as maps(map_name)
  )
  order by (m.match_id = incoming->>'id') desc, (m.edited or m.deleted) desc, m.updated_at desc, m.match_id
  limit 1;
$$;
revoke all on function public.find_terrifier_match_id(uuid, jsonb) from public, anon, authenticated;

create or replace function public.ingest_player_statistics(collector_token text, statistics jsonb default null, matches jsonb default '[]'::jsonb,
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
    if lower(btrim(item->>'characterName')) in ('k45', 'the terrifier')
      or lower(btrim(item->>'mapName')) in ('lm_liminal', 'hartshorne mall') then
      item := jsonb_set(item, '{id}', to_jsonb(coalesce(public.find_terrifier_match_id(owner_id, item), item->>'id')));
    end if;
    item := public.normalize_terrifier_match(item);
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

notify pgrst, 'reload schema';
commit;
