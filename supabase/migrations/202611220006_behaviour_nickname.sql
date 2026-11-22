begin;

revoke insert, update on public.player_profiles from authenticated;
revoke update(nickname) on public.player_profiles from authenticated;
drop policy "Create own profile" on public.player_profiles;
drop policy "Update own profile" on public.player_profiles;

create function public.sync_behaviour_nickname() returns trigger
language plpgsql security definer set search_path = '' as $$
declare behaviour_name text := btrim(new.overview->>'nickname');
begin
  if jsonb_typeof(new.overview->'nickname') = 'string' and char_length(behaviour_name) between 2 and 40
    and behaviour_name !~ '[[:cntrl:]]' then
    update public.player_profiles set nickname = behaviour_name
      where user_id = new.user_id and player_profiles.nickname is distinct from behaviour_name;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_behaviour_nickname() from public, anon, authenticated;
create trigger sync_behaviour_nickname after insert or update of overview on public.player_statistics
  for each row execute function public.sync_behaviour_nickname();

update public.player_profiles p set nickname = btrim(s.overview->>'nickname') from public.player_statistics s
  where p.user_id = s.user_id and jsonb_typeof(s.overview->'nickname') = 'string'
    and char_length(btrim(s.overview->>'nickname')) between 2 and 40 and s.overview->>'nickname' !~ '[[:cntrl:]]';

commit;
