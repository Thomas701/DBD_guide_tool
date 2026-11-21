begin;
insert into auth.users(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
do $$ begin
  assert public.save_workspace('{"dbd-build-tool.builds":"Alice"}', 0) = 1;
  assert public.save_workspace('{"dbd-build-tool.builds":"Alice modifié"}', 1) = 2;
  begin
    perform public.save_workspace('{"dbd-build-tool.builds":"Ancien appareil"}', 1);
    raise exception 'Stale writes must fail';
  exception when serialization_failure then null; end;
  begin
    perform public.save_workspace('{"supabase.auth.token":"secret"}', 2);
    raise exception 'Unknown workspace keys must fail';
  exception when invalid_parameter_value then null; end;
  begin
    update public.user_workspaces set data = '{}';
    raise exception 'Direct writes must fail';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('test.collector_token', public.create_statistics_collector(), true);

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
do $$ begin
  assert (select count(*) from public.user_workspaces) = 0, 'Bob must not see Alice';
  assert public.save_workspace('{"dbd-build-tool.builds":"Bob"}', 0) = 1;
  assert (select data->>'dbd-build-tool.builds' from public.user_workspaces) = 'Bob';
  assert not (public.statistics_collector_status()->>'connected')::boolean;
end $$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  begin
    perform * from public.user_workspaces;
    raise exception 'Anonymous reads must fail';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_statistics_collector();
    raise exception 'Anonymous pairing must fail';
  exception when insufficient_privilege then null; end;
  begin
    perform public.ingest_player_statistics(repeat('0', 64));
    raise exception 'Invalid collector token must fail';
  exception when insufficient_privilege then null; end;
  perform public.ingest_player_statistics(current_setting('test.collector_token'),
    '{"hoursPlayed":"100","matchesPlayed":"20","bloodpointsEarned":"2000","sourceUrl":"https://stats.deadbydaylight.com/statistics/"}',
    '[{"id":"1111111111111111111111111111111111111111","characterName":"Meg","role":"survivor","sourceUrl":"https://stats.deadbydaylight.com/match-history/","participants":[]}]');
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
do $$ begin
  assert (select count(*) from public.player_statistics) = 0, 'Collector must only write to its owner';
  assert (select count(*) from public.player_matches) = 0, 'Bob must not see Alice matches';
  begin
    perform public.edit_player_match(repeat('1', 40), null, true);
    raise exception 'Bob must not edit Alice matches';
  exception when invalid_parameter_value then null; end;
end $$;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
do $$ begin
  assert (select count(*) from public.player_matches) = 1;
  perform public.ingest_player_statistics(current_setting('test.collector_token'), null,
    '[{"id":"1111111111111111111111111111111111111111","characterName":"Meg","role":"survivor","sourceUrl":"https://stats.deadbydaylight.com/match-history/","participants":[{"name":"David","perkIconUrls":["perk.png"],"equipmentIconUrls":[]}]}]');
  perform public.ingest_player_statistics(current_setting('test.collector_token'), null,
    '[{"id":"1111111111111111111111111111111111111111","characterName":"Meg","role":"survivor","sourceUrl":"https://stats.deadbydaylight.com/match-history/","participants":[{"name":"David"}]}]');
  assert (select entry->'participants'->0->'perkIconUrls' from public.player_matches) = '["perk.png"]'::jsonb, 'Partial retries must retain detailed equipment';
  perform public.edit_player_match(repeat('1',40), '{"id":"1111111111111111111111111111111111111111","characterName":"Meg corrigée"}');
  perform public.ingest_player_statistics(current_setting('test.collector_token'), null,
    '[{"id":"1111111111111111111111111111111111111111","characterName":"Meg","role":"survivor","sourceUrl":"https://stats.deadbydaylight.com/match-history/","participants":[]}]');
  assert (select entry->>'characterName' from public.player_matches) = 'Meg corrigée', 'Sync must preserve manual edits';
  perform public.edit_player_match(repeat('1',40), null, true);
  perform public.ingest_player_statistics(current_setting('test.collector_token'), null,
    '[{"id":"1111111111111111111111111111111111111111","characterName":"Meg","role":"survivor","sourceUrl":"https://stats.deadbydaylight.com/match-history/","participants":[]}]');
  assert (select deleted from public.player_matches), 'Sync must preserve deletions';
  perform public.revoke_statistics_collector();
  begin
    perform public.ingest_player_statistics(current_setting('test.collector_token'));
    raise exception 'Revoked collector token must fail';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
