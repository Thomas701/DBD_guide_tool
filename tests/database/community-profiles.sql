begin;
insert into auth.users(id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin-private@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob-private@example.test'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'consultant-private@example.test');
insert into public.app_administrators(user_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.user_workspaces(user_id,data) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{"dbd-build-tool.assistant-conversations":"private chat"}');
insert into public.statistics_collectors(user_id, token_hash) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', extensions.digest('test-delete-only','sha256'));
select set_config('test.deleted_secret', vault.create_secret('test-delete-only')::text, true);
insert into public.remote_statistics_sessions(user_id, secret_id) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', current_setting('test.deleted_secret')::uuid);
update public.player_profiles set nickname = 'Bob public' where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
insert into public.player_matches(user_id, match_id, entry) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice-game', jsonb_build_object('id','alice-game','sharedMatchId',repeat('a',64), 'characterName','Jake Park','role','survivor','score',10000,'email','must-not-leak',
    'participants','[{"name":"Meg Thomas","role":"survivor","score":20000,"email":"must-not-leak"}]'::jsonb)),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob-game', jsonb_build_object('id','bob-game','sharedMatchId',repeat('a',64),'characterName','Meg Thomas','role','survivor','score',20000,'participants','[]'::jsonb));
insert into public.player_matches(user_id, match_id, entry, deleted) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'deleted', '{"id":"deleted","participants":[]}', true);

set local role authenticated;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
do $$ declare result jsonb; begin
  assert not public.can_manage_accounts();
  begin perform public.admin_delete_account('cccccccc-cccc-4ccc-8ccc-cccccccccccc'); raise exception 'Ordinary user deleted an account'; exception when insufficient_privilege then null; end;
  begin perform public.admin_promote_consultant(auth.uid()); raise exception 'Self promotion succeeded'; exception when insufficient_privilege then null; end;
  assert (select count(*) from public.user_workspaces where user_id <> auth.uid()) = 0;
  result := public.player_statistics_page('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert not result::text like '%must-not-leak%';
  assert not result::text like '%private chat%';
  assert not result::text like '%admin-private%';
  assert jsonb_array_length(result->'matchHistory') = 1;
  result := public.player_statistics_page(auth.uid());
  assert jsonb_array_length(result->'matchHistory') = 1, 'Deleted games must remain hidden';
  result := public.player_match_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['alice-game']);
  assert result->0->'participants'->0->'player'->>'nickname' = 'Bob public';
  assert not result::text like '%private@example%';
end $$;

select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select public.admin_promote_consultant('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
do $$ begin
  assert public.is_admin(), 'Consultants inherit existing staff permissions';
  assert not public.can_manage_accounts();
  assert public.admin_users()->>'total' = '3';
  perform public.admin_user_workspace('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  perform public.save_shared_perk_description('agitation','<p>Consultant edit</p>');
  begin perform public.admin_delete_account('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); raise exception 'Consultant deleted a user'; exception when insufficient_privilege then null; end;
  begin perform public.admin_promote_consultant('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); raise exception 'Consultant promoted a user'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.player_matches set entry = jsonb_set(entry, '{participants}', '[{"name":"Meg Thomas","role":"survivor","score":20000},{"name":"Meg Thomas","role":"survivor","score":20000}]') where match_id='alice-game';
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$ begin
  assert public.player_match_accounts(auth.uid(),array['alice-game'])->0->'participants' = '[]', 'Ambiguous identical characters must not identify a player';
  begin perform public.admin_delete_account(auth.uid()); raise exception 'Self deletion should fail'; exception when invalid_parameter_value then null; end;
  perform public.admin_delete_account('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert public.admin_users()->>'total' = '2';
  assert public.player_match_accounts(auth.uid(),array['alice-game']) = '[]', 'Deleted accounts must not be linked';
  assert not has_function_privilege('authenticated','public.save_remote_statistics_profile(uuid,uuid,text)','EXECUTE');
  assert not has_function_privilege('anon','public.player_statistics_page(uuid,text)','EXECUTE');
end $$;
reset role;
do $$ begin
  assert not exists(select 1 from public.user_workspaces where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert not exists(select 1 from public.statistics_collectors where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert not exists(select 1 from public.remote_statistics_sessions where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert not exists(select 1 from vault.secrets where id=current_setting('test.deleted_secret')::uuid), 'Deleting an account must remove its stored Behaviour authorization';
end $$;
rollback;
