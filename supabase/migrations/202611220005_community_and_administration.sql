begin;

create table public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(btrim(nickname)) between 2 and 40 and nickname !~ '[[:cntrl:]]')
);
alter table public.player_profiles enable row level security;
revoke all on public.player_profiles from public, anon, authenticated;
grant select, insert on public.player_profiles to authenticated;
grant update(nickname) on public.player_profiles to authenticated;
create policy "Read own profile" on public.player_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "Create own profile" on public.player_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own profile" on public.player_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function public.create_player_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.player_profiles(user_id, nickname) values (new.id, 'Joueur ' || left(new.id::text, 8)) on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.create_player_profile() from public, anon, authenticated;
create trigger create_player_profile after insert on auth.users for each row execute function public.create_player_profile();
insert into public.player_profiles(user_id, nickname) select id, 'Joueur ' || left(id::text, 8) from auth.users;

create table public.shared_perk_descriptions (
  perk_id text primary key check (perk_id ~ '^[a-z0-9][a-z0-9_-]{0,119}$'),
  description_html text check (description_html is null or octet_length(description_html) between 1 and 65536),
  updated_at timestamptz not null default now()
);
alter table public.shared_perk_descriptions enable row level security;
revoke all on public.shared_perk_descriptions from public, anon, authenticated;
grant select on public.shared_perk_descriptions to authenticated;
create policy "Read shared descriptions" on public.shared_perk_descriptions for select to authenticated using (true);

create function public.save_shared_perk_description(target_perk text, html text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator permission required' using errcode = '42501'; end if;
  insert into public.shared_perk_descriptions(perk_id, description_html) values (target_perk, html)
    on conflict(perk_id) do update set description_html = excluded.description_html, updated_at = now();
end;
$$;
revoke all on function public.save_shared_perk_description(text, text) from public, anon;
grant execute on function public.save_shared_perk_description(text, text) to authenticated;

-- Existing browser versions save descriptions in their workspace; publish those edits too.
create function public.publish_workspace_descriptions() returns trigger
language plpgsql security definer set search_path = '' as $$
declare before_map jsonb := '{}'; after_map jsonb := '{}'; item record;
begin
  if not public.is_admin() then return new; end if;
  if tg_op = 'UPDATE' and old.data->'dbd-build-tool.perk-description-overrides' is not distinct from new.data->'dbd-build-tool.perk-description-overrides' then return new; end if;
  begin
    if tg_op = 'UPDATE' then before_map := coalesce((old.data->>'dbd-build-tool.perk-description-overrides')::jsonb, '{}'); end if;
    after_map := coalesce((new.data->>'dbd-build-tool.perk-description-overrides')::jsonb, '{}');
  exception when invalid_text_representation then return new; end;
  if jsonb_typeof(before_map) <> 'object' or jsonb_typeof(after_map) <> 'object' then return new; end if;
  for item in select key from jsonb_object_keys(before_map || after_map) as keys(key) loop
    if before_map->item.key is distinct from after_map->item.key and (after_map->item.key is null or jsonb_typeof(after_map->item.key) = 'string') then
      perform public.save_shared_perk_description(item.key, after_map->>item.key);
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.publish_workspace_descriptions() from public, anon, authenticated;
create trigger publish_workspace_descriptions after insert or update on public.user_workspaces for each row execute function public.publish_workspace_descriptions();

-- Preserve existing administrator edits, with the most recently saved description taking precedence.
do $$ declare workspace record; descriptions jsonb; item record; begin
  for workspace in select w.data from public.user_workspaces w join public.app_administrators a using(user_id) order by w.updated_at loop
    begin descriptions := (workspace.data->>'dbd-build-tool.perk-description-overrides')::jsonb;
    exception when invalid_text_representation then continue; end;
    if jsonb_typeof(descriptions) = 'object' then
      for item in select key, value from jsonb_each(descriptions) loop
        if jsonb_typeof(item.value) = 'string' and item.key ~ '^[a-z0-9][a-z0-9_-]{0,119}$' and octet_length(item.value #>> '{}') between 1 and 65536 then
          insert into public.shared_perk_descriptions(perk_id, description_html) values(item.key, item.value #>> '{}')
            on conflict(perk_id) do update set description_html = excluded.description_html;
        end if;
      end loop;
    end if;
  end loop;
end $$;

create function public.admin_users(page_index integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator permission required' using errcode = '42501'; end if;
  if page_index is null or page_index < 0 or page_index > 100000 then raise exception 'Invalid page' using errcode = '22023'; end if;
  return jsonb_build_object('total', (select count(*) from auth.users), 'users', (
    select coalesce(jsonb_agg(to_jsonb(list)), '[]') from (
      select u.id, u.email, u.created_at, u.last_sign_in_at,
        exists(select 1 from public.app_administrators a where a.user_id = u.id) as administrator,
        exists(select 1 from public.remote_statistics_sessions r join public.statistics_collectors c using(user_id) where r.user_id = u.id and c.state <> 'waiting_for_login') as behaviour_synced
      from auth.users u order by u.created_at, u.id limit 50 offset page_index * 50
    ) list
  ));
end;
$$;

create function public.admin_user_workspace(target_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator permission required' using errcode = '42501'; end if;
  if not exists(select 1 from auth.users where id = target_user) then raise exception 'Account not found' using errcode = '22023'; end if;
  return coalesce((select jsonb_object_agg(item.key, item.value) from public.user_workspaces w
    cross join lateral jsonb_each(w.data) item where w.user_id = target_user and item.key = any(array[
      'dbd-build-tool.builds', 'dbd-build-tool.current-session', 'dbd-build-tool.tier-overrides',
      'dbd-build-tool.perk-description-overrides', 'dbd-build-tool.perk-category-overrides'
    ])), '{}');
end;
$$;

create policy "Administrators read player statistics" on public.player_statistics for select to authenticated using ((select public.is_admin()));
create policy "Administrators read player matches" on public.player_matches for select to authenticated using ((select public.is_admin()));
create function public.admin_statistics_status(target_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator permission required' using errcode = '42501'; end if;
  return coalesce((select jsonb_build_object('state', state, 'message', message, 'lastSeenAt', last_seen_at) from public.statistics_collectors where user_id = target_user), '{"state":"waiting_for_login","message":"Aucune synchronisation Behaviour activée.","lastSeenAt":null}');
end;
$$;
revoke all on function public.admin_users(integer), public.admin_user_workspace(uuid), public.admin_statistics_status(uuid) from public, anon;
grant execute on function public.admin_users(integer), public.admin_user_workspace(uuid), public.admin_statistics_status(uuid) to authenticated;

create function public.match_mmr_mode(entry jsonb) returns text
language sql immutable set search_path = '' as $$
  select case when entry->>'role' not in ('killer', 'survivor') then null
    when entry->>'queueLabel' ~* '^lights?\s*out$' or entry->>'resultLabel' ~* '\mLights Out\M' then 'lights-out-' || (entry->>'role')
    when coalesce(nullif(entry->>'queueLabel', ''), '1v4') in ('1v4', '2v8') then coalesce(nullif(entry->>'queueLabel', ''), '1v4') || '-' || (entry->>'role')
    else null end;
$$;
revoke all on function public.match_mmr_mode(jsonb) from public, anon, authenticated;

create function public.player_leaderboard(selected_mode text default '1v4-survivor', selected_killer text default '', page_index integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if selected_mode is null or selected_mode <> all(array['1v4-survivor','2v8-survivor','lights-out-survivor','1v4-killer','2v8-killer','lights-out-killer'])
    or selected_killer is null or length(selected_killer) > 160 or page_index is null or page_index < 0 or page_index > 100000 then raise exception 'Invalid filters' using errcode = '22023'; end if;
  return (
    with eligible as materialized (
      select m.user_id, m.entry from public.player_matches m where not m.deleted and public.match_mmr_mode(m.entry) = selected_mode
    ), scored as (
      select e.user_id, e.entry, counts.*,
        case when selected_mode like '%-killer' then case when deaths >= 3 then 9 when deaths = 2 then 0 else -9 end
          when jsonb_typeof(e.entry->'score') <> 'number' or peers = 0 then 0
          when lower_scores > peers / 2.0 then 9 when higher_scores > peers / 2.0 then -9 else 0 end as delta
      from eligible e cross join lateral (
        select count(*) filter(where p->>'role' = 'survivor' and p->>'resultLabel' ~* 'dead|killed|sacrificed|mori|disconnected') as deaths,
          count(*) filter(where p->>'role' = 'survivor' and jsonb_typeof(p->'score') = 'number') as peers,
          count(*) filter(where p->>'role' = 'survivor' and jsonb_typeof(p->'score') = 'number' and (p->'score')::numeric < case when jsonb_typeof(e.entry->'score') = 'number' then (e.entry->'score')::numeric end) as lower_scores,
          count(*) filter(where p->>'role' = 'survivor' and jsonb_typeof(p->'score') = 'number' and (p->'score')::numeric > case when jsonb_typeof(e.entry->'score') = 'number' then (e.entry->'score')::numeric end) as higher_scores
        from jsonb_array_elements(case when jsonb_typeof(e.entry->'participants') = 'array' then e.entry->'participants' else '[]' end) p
      ) counts
      where selected_mode not like '%-killer' or (selected_killer <> '' and e.entry->>'characterName' = selected_killer)
    ), standings as (
      select s.user_id, p.nickname, 600 + sum(delta) as mmr,
        count(*) filter(where case when selected_mode like '%-killer' then deaths >= 3 else s.entry->>'resultLabel' ~* 'escaped|évasion|échapp' end) as wins,
        count(*) filter(where case when selected_mode like '%-killer' then deaths <= 1 else s.entry->>'resultLabel' ~* 'dead|killed|sacrificed|mori|mort|sacrifi|disconnect' end) as losses
      from scored s join public.player_profiles p using(user_id) group by s.user_id, p.nickname
    ), ranked as (
      select row_number() over(order by mmr desc, wins desc, losses, user_id) as rank, user_id, nickname, mmr, wins, losses from standings
    ) select jsonb_build_object('total', (select count(*) from ranked), 'players', (select coalesce(jsonb_agg(to_jsonb(page) order by rank), '[]') from (select * from ranked order by rank limit 50 offset page_index * 50) page),
      'killers', (select coalesce(jsonb_agg(name order by name), '[]') from (select distinct entry->>'characterName' as name from eligible where selected_mode like '%-killer' and coalesce(entry->>'characterName', '') <> '') names))
  );
end;
$$;
revoke all on function public.player_leaderboard(text, text, integer) from public, anon;
grant execute on function public.player_leaderboard(text, text, integer) to authenticated;

commit;
