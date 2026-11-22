begin;
insert into auth.users(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.app_administrators(user_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.user_workspaces(user_id, data) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{"dbd-build-tool.perk-description-overrides":"old description"}');
insert into public.player_matches(user_id, match_id, entry) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', repeat('1', 40), '{"id":"1111111111111111111111111111111111111111"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select set_config('request.jwt.claims', '{"user_metadata":{"is_admin":true,"role":"admin"}}', true);
do $$ begin
  assert not public.is_admin(), 'User metadata must not grant admin permissions';
  assert not has_function_privilege('authenticated', 'public.ingest_player_statistics(text,jsonb,jsonb,text,text)', 'EXECUTE'), 'Direct imports must not bypass admin edit restrictions';
  assert not has_function_privilege('anon', 'public.ingest_player_statistics(text,jsonb,jsonb,text,text)', 'EXECUTE');
  assert has_function_privilege('service_role', 'public.ingest_player_statistics(text,jsonb,jsonb,text,text)', 'EXECUTE');
  assert public.save_workspace('{"dbd-build-tool.builds":"Bob","dbd-build-tool.perk-description-overrides":"old description"}', 1) = 2, 'Existing customizations must not block build saves';
  begin
    perform public.save_workspace('{"dbd-build-tool.perk-description-overrides":"forged"}', 2);
    raise exception 'Non-admin description edits must fail';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_workspace('{"dbd-build-tool.perk-description-overrides":"old description","dbd-build-tool.perk-category-overrides":"forged"}', 2);
    raise exception 'Non-admin category edits must fail';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_workspace('{}', 2);
    raise exception 'Non-admin resets must fail';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.app_administrators(user_id) values (auth.uid());
    raise exception 'Self-promotion must fail';
  exception when insufficient_privilege then null; end;
  begin
    perform public.edit_player_match(repeat('1', 40), '{"id":"1111111111111111111111111111111111111111","characterName":"forged"}');
    raise exception 'Non-admin edits of own matches must fail';
  exception when insufficient_privilege then null; end;
  begin
    perform public.edit_player_match(repeat('1', 40), null, true);
    raise exception 'Non-admin deletions of own matches must fail';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
do $$ begin
  assert public.is_admin();
  assert public.save_workspace('{"dbd-build-tool.perk-description-overrides":"admin description","dbd-build-tool.perk-category-overrides":"admin categories"}', 0) = 1;
  assert public.save_workspace('{}', 1) = 2;
  begin
    perform public.edit_player_match(repeat('1', 40), null, true);
    raise exception 'Admin must not gain access to another account matches';
  exception when invalid_parameter_value then null; end;
end $$;
rollback;
