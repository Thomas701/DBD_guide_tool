begin;

alter table public.player_statistics add column mmr_adjustments jsonb not null default '{}';

create function public.admin_set_player_mmr(target_user uuid, selected_mode text, selected_killer text, rating integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  anchor_id text;
  anchor_at text;
  series_key text;
  adjustments jsonb;
begin
  if not public.can_manage_accounts() then raise exception 'Droits administrateur requis.' using errcode = '42501'; end if;
  if target_user is null or rating is null or selected_mode is null
    or selected_mode <> all(array['1v4-survivor','2v8-survivor','lights-out-survivor','1v4-killer','2v8-killer','lights-out-killer'])
    or selected_killer is null or length(selected_killer) > 160
    or (selected_mode like '%-killer') <> (selected_killer <> '')
    then raise exception 'Réglage MMR invalide.' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_user::text, 0));
  select m.match_id, coalesce(nullif(m.entry->>'playedAt', ''), m.entry->>'importedAt', '')
    into anchor_id, anchor_at
    from public.player_matches m
    where m.user_id = target_user and not m.deleted and public.match_mmr_mode(m.entry) = selected_mode
      and (selected_killer = '' or lower(m.entry->>'characterName') = lower(selected_killer))
      and m.entry->>'importedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    order by coalesce(nullif(m.entry->>'playedAt', ''), m.entry->>'importedAt', '') collate pg_catalog."C" desc,
      m.match_id collate pg_catalog."C" desc
    limit 1;
  if not found then raise exception 'Aucune partie enregistrée pour ce MMR.' using errcode = '22023'; end if;

  series_key := selected_mode || case when selected_killer = '' then '' else ':' || lower(selected_killer) end;
  insert into public.player_statistics(user_id, updated_at, mmr_adjustments)
    values(target_user, clock_timestamp(), jsonb_build_object(series_key, jsonb_build_object(
      'matchId', anchor_id, 'at', anchor_at, 'rating', rating)))
    on conflict(user_id) do update set
      mmr_adjustments = player_statistics.mmr_adjustments || excluded.mmr_adjustments,
      updated_at = excluded.updated_at
    returning mmr_adjustments into adjustments;
  return adjustments;
end;
$$;
revoke all on function public.admin_set_player_mmr(uuid,text,text,integer) from public, anon;
grant execute on function public.admin_set_player_mmr(uuid,text,text,integer) to authenticated;

create or replace function public.player_leaderboard(selected_mode text default '1v4-survivor', selected_killer text default '', page_index integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if selected_mode is null or selected_mode <> all(array['1v4-survivor','2v8-survivor','lights-out-survivor','1v4-killer','2v8-killer','lights-out-killer'])
    or selected_killer is null or length(selected_killer) > 160 or page_index is null or page_index < 0 or page_index > 100000 then raise exception 'Invalid filters' using errcode = '22023'; end if;
  return (
    with eligible as materialized (
      select m.user_id, m.match_id, m.entry, coalesce(nullif(m.entry->>'playedAt', ''), m.entry->>'importedAt', '') as played_at
      from public.player_matches m where not m.deleted and public.match_mmr_mode(m.entry) = selected_mode
    ), scored as (
      select e.*, counts.*,
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
      where selected_mode not like '%-killer' or (selected_killer <> '' and lower(e.entry->>'characterName') = lower(selected_killer))
    ), standings as (
      select s.user_id, p.nickname, coalesce(
        (anchor->>'rating')::bigint + coalesce(sum(delta) filter(where
          (s.played_at collate pg_catalog."C", s.match_id collate pg_catalog."C") >
          (anchor->>'at' collate pg_catalog."C", anchor->>'matchId' collate pg_catalog."C")), 0),
        600 + sum(delta)) as mmr,
        count(*) filter(where case when selected_mode like '%-killer' then deaths >= 3 else s.entry->>'resultLabel' ~* 'escaped|évasion|échapp' end) as wins,
        count(*) filter(where case when selected_mode like '%-killer' then deaths <= 1 else s.entry->>'resultLabel' ~* 'dead|killed|sacrificed|mori|mort|sacrifi|disconnect' end) as losses
      from scored s join public.player_profiles p using(user_id)
      left join public.player_statistics ps using(user_id)
      cross join lateral (select ps.mmr_adjustments->(selected_mode ||
        case when selected_mode like '%-killer' then ':' || lower(selected_killer) else '' end) as anchor) a
      group by s.user_id, p.nickname, anchor
    ), ranked as (
      select row_number() over(order by mmr desc, wins desc, losses, user_id) as rank, user_id, nickname, mmr, wins, losses from standings
    ) select jsonb_build_object('total', (select count(*) from ranked), 'players', (select coalesce(jsonb_agg(to_jsonb(page) order by rank), '[]') from (select * from ranked order by rank limit 50 offset page_index * 50) page),
      'killers', (select coalesce(jsonb_agg(name order by name), '[]') from (select distinct entry->>'characterName' as name from eligible where selected_mode like '%-killer' and coalesce(entry->>'characterName', '') <> '') names))
  );
end;
$$;

create or replace function public.player_statistics_page(target_user uuid, after_match text default '') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if target_user is null or after_match is null or length(after_match) > 100 then raise exception 'Invalid page' using errcode = '22023'; end if;
  with matches as materialized (
    select match_id, entry from public.player_matches where user_id = target_user and not deleted and match_id > after_match order by match_id limit 501
  ), page as (select * from matches order by match_id limit 500)
  select jsonb_build_object('nickname', p.nickname, 'updatedAt', s.updated_at, 'statistics', null,
    'mmrAdjustments', coalesce(s.mmr_adjustments, '{}'),
    'importedCount', coalesce(s.imported_count, 0), 'fetchedCount', coalesce(s.fetched_count, 0),
    'matchHistory', (select coalesce(jsonb_agg(public.statistics_public_entry(entry) order by match_id), '[]') from page),
    'nextCursor', case when (select count(*) from matches) > 500 then (select max(match_id) from page) end
  ) into result from public.player_profiles p left join public.player_statistics s using(user_id) where p.user_id = target_user;
  if result is null then raise exception 'Player not found' using errcode = '22023'; end if;
  return result;
end;
$$;

commit;
