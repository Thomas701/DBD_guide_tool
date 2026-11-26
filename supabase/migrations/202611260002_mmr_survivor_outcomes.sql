begin;

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
        case when selected_mode like '%-killer' then case when deaths >= 3 then 9 when possible_eliminations < 2 then -9 else 0 end
          when jsonb_typeof(e.entry->'score') <> 'number' or peers = 0 then 0
          when lower_scores > peers / 2.0 then 9 when higher_scores > peers / 2.0 then -9 else 0 end as delta
      from eligible e cross join lateral (
        select count(*) filter(where p->>'role' = 'survivor' and p->>'resultLabel' ~* 'dead|killed|sacrificed|mori|disconnected|surrendered') as deaths,
          count(*) filter(where p->>'role' = 'survivor') -
            count(*) filter(where p->>'role' = 'survivor' and p->>'resultLabel' ~* 'escaped|évasion|échapp') as possible_eliminations,
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
        count(*) filter(where case when selected_mode like '%-killer' then possible_eliminations < 2 else s.entry->>'resultLabel' ~* 'dead|killed|sacrificed|mori|mort|sacrifi|disconnect|surrendered' end) as losses
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

commit;
