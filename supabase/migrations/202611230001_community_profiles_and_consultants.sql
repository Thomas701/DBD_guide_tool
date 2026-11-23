begin;

alter table public.app_administrators add column role text not null default 'administrator'
  check(role in ('administrator', 'consultant'));

create function public.can_manage_accounts() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.app_administrators where user_id = auth.uid() and role = 'administrator');
$$;
revoke all on function public.can_manage_accounts() from public, anon;
grant execute on function public.can_manage_accounts() to authenticated;

create function public.admin_promote_consultant(target_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_accounts() then raise exception 'Administrator permission required' using errcode = '42501'; end if;
  if not exists(select 1 from auth.users where id = target_user) then raise exception 'Account not found' using errcode = '22023'; end if;
  insert into public.app_administrators(user_id, role) values(target_user, 'consultant') on conflict do nothing;
end;
$$;

create function public.admin_delete_account(target_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_accounts() then raise exception 'Administrator permission required' using errcode = '42501'; end if;
  if target_user = auth.uid() then raise exception 'Vous ne pouvez pas supprimer votre propre compte.' using errcode = '22023'; end if;
  delete from auth.users where id = target_user;
  if not found then raise exception 'Account not found' using errcode = '22023'; end if;
end;
$$;
revoke all on function public.admin_promote_consultant(uuid), public.admin_delete_account(uuid) from public, anon;
grant execute on function public.admin_promote_consultant(uuid), public.admin_delete_account(uuid) to authenticated;

create or replace function public.admin_users(page_index integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator permission required' using errcode = '42501'; end if;
  if page_index is null or page_index < 0 or page_index > 100000 then raise exception 'Invalid page' using errcode = '22023'; end if;
  return jsonb_build_object('total', (select count(*) from auth.users), 'users', (
    select coalesce(jsonb_agg(to_jsonb(list)), '[]') from (
      select u.id, u.email, u.created_at, u.last_sign_in_at,
        coalesce(a.role = 'administrator', false) as administrator,
        coalesce(a.role = 'consultant', false) as consultant,
        exists(select 1 from public.remote_statistics_sessions r join public.statistics_collectors c using(user_id) where r.user_id = u.id and c.state <> 'waiting_for_login') as behaviour_synced
      from auth.users u left join public.app_administrators a on a.user_id = u.id
      order by u.created_at, u.id limit 50 offset page_index * 50
    ) list
  ));
end;
$$;

create function public.save_remote_statistics_profile(owner_id uuid, lease uuid, nickname text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  if not exists(select 1 from public.remote_statistics_sessions where user_id = owner_id and lease_token = lease and lease_until > clock_timestamp())
    then raise exception 'Synchronization revoked or expired' using errcode = '42501'; end if;
  if nickname is null or char_length(btrim(nickname)) not between 2 and 40 or nickname ~ '[[:cntrl:]]'
    then raise exception 'Invalid Behaviour nickname' using errcode = '22023'; end if;
  update public.player_profiles set nickname = btrim(save_remote_statistics_profile.nickname)
    where user_id = owner_id and player_profiles.nickname is distinct from btrim(save_remote_statistics_profile.nickname);
end;
$$;
revoke all on function public.save_remote_statistics_profile(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.save_remote_statistics_profile(uuid,uuid,text) to service_role;

create function public.statistics_public_entry(entry jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce((select jsonb_object_agg(key, value) from jsonb_each(entry) where key = any(array[
    'id','role','characterName','resultLabel','score','characterImageUrl','perkIconUrls','perkIconLabels',
    'equipmentIconUrls','equipmentIconLabels','emblemIconUrls','emblemIconLabels','survivalTimeLabel',
    'mapName','mapImageUrl','playedAt','playedAtLabel','durationLabel','queueLabel','sourceUrl','importedAt'
  ])), '{}') || jsonb_build_object('participants', (
    select coalesce(jsonb_agg((select jsonb_object_agg(key,value) from jsonb_each(player) where key = any(array[
      'name','role','imageUrl','score','valueLabel','survivalTimeLabel','resultLabel','perkIconUrls','perkIconLabels',
      'equipmentIconUrls','equipmentIconLabels','emblemIconUrls','emblemIconLabels'
    ]))), '[]') from jsonb_array_elements(coalesce(entry->'participants', '[]')) player
  ));
$$;
revoke all on function public.statistics_public_entry(jsonb) from public, anon, authenticated;

create function public.player_statistics_page(target_user uuid, after_match text default '') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if target_user is null or after_match is null or length(after_match) > 100 then raise exception 'Invalid page' using errcode = '22023'; end if;
  with matches as materialized (
    select match_id, entry from public.player_matches where user_id = target_user and not deleted and match_id > after_match order by match_id limit 501
  ), page as (select * from matches order by match_id limit 500)
  select jsonb_build_object('nickname', p.nickname, 'updatedAt', s.updated_at, 'statistics', null,
    'importedCount', coalesce(s.imported_count, 0), 'fetchedCount', coalesce(s.fetched_count, 0),
    'matchHistory', (select coalesce(jsonb_agg(public.statistics_public_entry(entry) order by match_id), '[]') from page),
    'nextCursor', case when (select count(*) from matches) > 500 then (select max(match_id) from page) end
  ) into result from public.player_profiles p left join public.player_statistics s using(user_id) where p.user_id = target_user;
  if result is null then raise exception 'Player not found' using errcode = '22023'; end if;
  return result;
end;
$$;
revoke all on function public.player_statistics_page(uuid,text) from public, anon;
grant execute on function public.player_statistics_page(uuid,text) to authenticated;

create index player_matches_shared_game on public.player_matches((entry->>'sharedMatchId'), user_id) where not deleted and not edited;

create function public.player_match_accounts(target_user uuid, match_ids text[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if target_user is null or match_ids is null or cardinality(match_ids) > 500 then raise exception 'Invalid matches' using errcode = '22023'; end if;
  return (with source as materialized (
    select m.* from public.player_matches m where m.user_id = target_user and m.match_id = any(match_ids)
      and not m.deleted and not m.edited and m.entry->>'sharedMatchId' ~ '^[a-f0-9]{64}$'
  ), peers as materialized (
    select s.match_id as source_id, m.user_id, m.entry, p.nickname from source s
    join public.player_matches m on m.entry->>'sharedMatchId' = s.entry->>'sharedMatchId' and m.user_id <> s.user_id and not m.deleted and not m.edited
    join public.player_profiles p on p.user_id = m.user_id
  ) select coalesce(jsonb_agg(jsonb_build_object('matchId', s.match_id,
    'player', jsonb_build_object('user_id', p.user_id, 'nickname', p.nickname),
    'participants', (select coalesce(jsonb_agg(jsonb_build_object('index', participant.ordinality - 1, 'player', found.player)), '[]')
      from jsonb_array_elements(s.entry->'participants') with ordinality participant(value, ordinality)
      cross join lateral (
        select case when count(distinct peer.user_id) = 1 then jsonb_build_object('user_id', min(peer.user_id::text), 'nickname', min(peer.nickname)) end as player
        from peers peer where peer.source_id = s.match_id
          and peer.entry->>'role' = participant.value->>'role'
          and peer.entry->>'characterName' = participant.value->>'name'
          and peer.entry->'score' = participant.value->'score'
          and jsonb_typeof(participant.value->'score') = 'number'
      ) found where found.player is not null and (
        select count(*) from jsonb_array_elements(s.entry->'participants' || jsonb_build_array(jsonb_build_object(
          'name', s.entry->>'characterName', 'role', s.entry->>'role', 'score', s.entry->'score'))) roster
        where roster->>'name' = participant.value->>'name' and roster->>'role' = participant.value->>'role' and roster->'score' = participant.value->'score'
      ) = 1)
  )), '[]') from source s join public.player_profiles p on p.user_id = s.user_id where exists(select 1 from peers where source_id = s.match_id));
end;
$$;
revoke all on function public.player_match_accounts(uuid,text[]) from public, anon;
grant execute on function public.player_match_accounts(uuid,text[]) to authenticated;

commit;
