begin;
insert into auth.users(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('test.nickname_collector', public.create_statistics_collector(), true);
set local role service_role;
do $$ declare lease uuid; jobs jsonb; begin
  perform public.register_remote_statistics(current_setting('test.nickname_collector'),
    '{"authToken":{"token":"private-access","expirationDate":2000000000000},"refreshToken":{"token":"private-refresh","expirationDate":2100000000000}}', repeat('a',64), 'Europe/Paris');
  jobs := public.claim_remote_statistics('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  lease := (jobs->0->>'lease')::uuid;
  perform public.finish_remote_statistics('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', lease,
    '{"hoursPlayed":"1 hrs","matchesPlayed":"1","bloodpointsEarned":"1000","sourceUrl":"https://stats.deadbydaylight.com/statistics/","nickname":"Donoteet"}',
    '[]', 'success', 'Synchronized');
end $$;
reset role;
do $$ declare invalid jsonb; begin
  assert (select nickname from public.player_profiles where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 'Donoteet';
  assert (select nickname from public.player_profiles where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 'Joueur bbbbbbbb';
  for invalid in select value from jsonb_array_elements(jsonb_build_array(null, 42, '', ' ', 'a' || chr(10) || 'b', repeat('a', 41))) loop
    update public.player_statistics set overview = jsonb_set(overview, '{nickname}', invalid) where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    assert (select nickname from public.player_profiles where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 'Donoteet', 'Invalid metadata must retain the known nickname';
  end loop;
  update public.player_statistics set overview = overview - 'nickname' where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert (select nickname from public.player_profiles where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 'Donoteet';
  update public.player_statistics set overview = overview || '{"nickname":" Nouveau pseudo#1234 "}' where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert (select nickname from public.player_profiles where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 'Nouveau pseudo#1234';
  assert not has_table_privilege('authenticated', 'public.player_profiles', 'INSERT');
  assert not has_column_privilege('authenticated', 'public.player_profiles', 'nickname', 'UPDATE');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
do $$ begin
  begin
    update public.player_profiles set nickname = 'Forged' where user_id = auth.uid();
    raise exception 'Nicknames come from the trusted Behaviour collector';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.player_profiles) = 1;
end $$;
rollback;

begin;
insert into auth.users(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('test.nickname_only_collector', public.create_statistics_collector(), true);
set local role service_role;
do $$ declare lease uuid; jobs jsonb; begin
  perform public.register_remote_statistics(current_setting('test.nickname_only_collector'),
    '{"authToken":{"token":"private-access","expirationDate":2000000000000},"refreshToken":{"token":"private-refresh","expirationDate":2100000000000}}', repeat('a',64), 'Europe/Paris');
  jobs := public.claim_remote_statistics('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  lease := (jobs->0->>'lease')::uuid;
  begin
    perform public.save_remote_statistics_profile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gen_random_uuid(), 'Forged');
    raise exception 'Invalid lease must not change a nickname';
  exception when insufficient_privilege then null; end;
  perform public.save_remote_statistics_profile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', lease, ' Emma Behaviour ');
  perform public.finish_remote_statistics('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', lease, null, '[]', 'success', 'Synchronized');
end $$;
reset role;
do $$ begin
  assert (select nickname from public.player_profiles where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 'Emma Behaviour';
  assert (select overview from public.player_statistics where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is null, 'A nickname must not require aggregate statistics';
end $$;
rollback;
