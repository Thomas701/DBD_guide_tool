begin;
insert into auth.users(id, email, created_at, last_sign_in_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@example.test', '2026-01-01', '2026-11-22'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@example.test', '2026-01-02', null);
insert into auth.users(id, email, created_at)
  select ('cccccccc-cccc-4ccc-8ccc-' || lpad(n::text, 12, '0'))::uuid, 'player' || n || '@example.test', '2026-02-01' from generate_series(1, 52) n;
insert into public.app_administrators(user_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
update public.player_profiles set nickname = 'Bob public' where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
insert into public.user_workspaces(user_id, data) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{"dbd-build-tool.builds":"Bob", "dbd-build-tool.tier-overrides":"private tiers", "dbd-build-tool.assistant-conversations":"private chat"}');
insert into public.statistics_collectors(user_id, token_hash, state, message)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', extensions.digest('test-only', 'sha256'), 'success', 'Synchronized');
insert into public.remote_statistics_sessions(user_id, secret_id)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', gen_random_uuid());
insert into public.player_matches(user_id, match_id, entry)
  select id, 'survivor', jsonb_build_object('role', 'survivor', 'characterName', 'Jake Park', 'score', 20000,
    'resultLabel', case when id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' then 'Sacrificed' else 'Escaped' end,
    'participants', '[{"role":"survivor","score":10000},{"role":"survivor","score":15000},{"role":"survivor","score":25000}]'::jsonb)
  from auth.users;
insert into public.player_matches(user_id, match_id, entry) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'killer-win', '{"role":"killer","characterName":"The Trapper","participants":[{"role":"survivor","resultLabel":"Sacrificed"},{"role":"survivor","resultLabel":"Killed"},{"role":"survivor","resultLabel":"Disconnected"},{"role":"survivor","resultLabel":"Escaped"}]}'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'killer-draw', '{"role":"killer","characterName":"The Trapper","participants":[{"role":"survivor","resultLabel":"Sacrificed"},{"role":"survivor","resultLabel":"Killed"},{"role":"survivor","resultLabel":"Escaped"},{"role":"survivor","resultLabel":"Escaped"}]}'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'killer-loss', '{"role":"killer","characterName":"The Nurse","participants":[{"role":"survivor","resultLabel":"Escaped"}]}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2v8', '{"role":"survivor","queueLabel":"2v8","resultLabel":"Escaped","score":null,"participants":[]}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'lights-out', '{"role":"survivor","queueLabel":"Lights Out","resultLabel":"Disconnected","score":null,"participants":[]}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'unsupported', '{"role":"survivor","queueLabel":"Chaos Shuffle","participants":[]}');
insert into public.player_matches(user_id, match_id, entry, deleted) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'deleted', '{"role":"survivor","resultLabel":"Escaped","participants":[]}', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
do $$ declare result jsonb; begin
  assert (select count(*) from public.player_profiles) = 1;
  begin
    update public.player_profiles set nickname = 'Forged' where user_id = auth.uid();
    raise exception 'Behaviour nicknames must not be forged';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.player_matches where user_id <> auth.uid()) = 0;
  assert (select count(*) from public.user_workspaces where user_id <> auth.uid()) = 0;
  begin perform public.admin_users(); raise exception 'Users must not list accounts'; exception when insufficient_privilege then null; end;
  begin perform public.admin_user_workspace('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); raise exception 'Users must not inspect accounts'; exception when insufficient_privilege then null; end;
  begin perform public.admin_statistics_status('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); raise exception 'Users must not inspect status'; exception when insufficient_privilege then null; end;
  begin perform public.save_shared_perk_description('agitation', '<p>Forged</p>'); raise exception 'Users must not edit descriptions'; exception when insufficient_privilege then null; end;
  begin insert into public.shared_perk_descriptions values ('agitation', 'Forged', now()); raise exception 'Direct edits must fail'; exception when insufficient_privilege then null; end;
  result := public.player_leaderboard();
  assert (result->>'total')::int = 54;
  assert jsonb_array_length(result->'players') = 50;
  assert (result->'players'->0->>'mmr')::int = 609, 'MMR must match the application score-majority rule';
  assert not (result->'players'->0 ? 'email'), 'Emails must not be public';
  result := public.player_leaderboard('1v4-survivor', '', 1);
  assert jsonb_array_length(result->'players') = 4;
  assert (result->'players'->0->>'rank')::int = 51;
  result := public.player_leaderboard('1v4-killer', 'The Trapper');
  assert (result->>'total')::int = 1;
  assert (result->'players'->0->>'mmr')::int = 609;
  assert (result->'players'->0->>'wins')::int = 1;
  assert (result->'players'->0->>'losses')::int = 0, 'Draws must not count as losses';
  assert result->'killers' = '["The Nurse", "The Trapper"]'::jsonb;
  result := public.player_leaderboard('1v4-killer', 'The Nurse');
  assert (result->'players'->0->>'mmr')::int = 591;
  assert (result->'players'->0->>'losses')::int = 1;
  result := public.player_leaderboard('2v8-survivor');
  assert (result->>'total')::int = 1;
  assert result->'players'->0->>'nickname' = 'Bob public';
  assert (result->'players'->0->>'mmr')::int = 600;
  assert (result->'players'->0->>'wins')::int = 1;
  result := public.player_leaderboard('lights-out-survivor');
  assert (result->'players'->0->>'losses')::int = 1;
  begin perform public.player_leaderboard('invalid'); raise exception 'Bad modes must fail'; exception when invalid_parameter_value then null; end;
  begin perform public.player_leaderboard('1v4-survivor', '', -1); raise exception 'Bad pages must fail'; exception when invalid_parameter_value then null; end;
end $$;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
do $$ declare result jsonb; begin
  result := public.admin_users();
  assert (result->>'total')::int = 54;
  assert jsonb_array_length(result->'users') = 50;
  assert result->'users'->0->>'email' = 'alice@example.test';
  assert (result->'users'->0->>'administrator')::boolean;
  assert not (result->'users'->0->>'behaviour_synced')::boolean;
  assert result->'users'->0->>'last_sign_in_at' is not null;
  assert (result->'users'->1->>'behaviour_synced')::boolean;
  assert result->'users'->1->>'last_sign_in_at' is null;
  assert jsonb_array_length(public.admin_users(1)->'users') = 4;
  begin perform public.admin_users(-1); raise exception 'Bad pages must fail'; exception when invalid_parameter_value then null; end;
  result := public.admin_user_workspace('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert result->>'dbd-build-tool.builds' = 'Bob';
  assert result->>'dbd-build-tool.tier-overrides' = 'private tiers';
  assert not (result ? 'dbd-build-tool.assistant-conversations'), 'Inspection must not expose conversations';
  assert public.admin_user_workspace('cccccccc-cccc-4ccc-8ccc-000000000001') = '{}'::jsonb;
  begin perform public.admin_user_workspace(gen_random_uuid()); raise exception 'Unknown accounts must fail'; exception when invalid_parameter_value then null; end;
  assert public.admin_statistics_status('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->>'state' = 'success';
  assert (select count(*) from public.player_matches where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') > 0;
  begin perform public.edit_player_match('2v8', null, true); raise exception 'Inspection must not enable edits of another account'; exception when invalid_parameter_value then null; end;
  perform public.save_shared_perk_description('agitation', '<p>Common description</p>');
  assert public.save_workspace('{"dbd-build-tool.perk-description-overrides":"{\"bond\":\"<p>Legacy client</p>\"}"}', 0) = 1;
  assert (select description_html from public.shared_perk_descriptions where perk_id = 'bond') = '<p>Legacy client</p>';
  assert public.save_workspace('{"dbd-build-tool.perk-description-overrides":"{}"}', 1) = 2;
  assert (select description_html is null from public.shared_perk_descriptions where perk_id = 'bond'), 'Resets must clear legacy overrides';
end $$;

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
do $$ begin
  assert (select description_html from public.shared_perk_descriptions where perk_id = 'agitation') = '<p>Common description</p>';
  assert (select data->>'dbd-build-tool.tier-overrides' from public.user_workspaces) = 'private tiers';
  assert not has_table_privilege('authenticated', 'public.remote_statistics_sessions', 'SELECT');
  assert not has_table_privilege('anon', 'public.player_profiles', 'SELECT');
  assert not has_table_privilege('anon', 'public.shared_perk_descriptions', 'SELECT');
  assert not has_function_privilege('anon', 'public.player_leaderboard(text,text,integer)', 'EXECUTE');
  assert not has_function_privilege('anon', 'public.admin_users(integer)', 'EXECUTE');
end $$;
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  begin perform public.player_leaderboard(); raise exception 'Authentication required'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.player_matches set entry = entry || '{"playedAt":"2026-11-22T12:00:00.000Z","importedAt":"2026-11-22T12:00:00.000Z"}'
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and match_id in ('killer-win','killer-draw');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
do $$ declare adjustments jsonb; begin
  adjustments := public.admin_set_player_mmr(auth.uid(), '1v4-killer', 'The Trapper', 900);
  assert adjustments->'1v4-killer:the trapper'->>'matchId' = 'killer-win', 'Match ID breaks timestamp ties';
  assert public.player_statistics_page(auth.uid())->'mmrAdjustments' = adjustments;
  assert (public.player_leaderboard('1v4-killer', 'The Trapper')->'players'->0->>'mmr')::int = 900;
  assert (public.player_leaderboard('1v4-killer', 'The Nurse')->'players'->0->>'mmr')::int = 591;
  perform public.admin_set_player_mmr(auth.uid(), '1v4-killer', 'The Trapper', 800);
  assert (public.player_leaderboard('1v4-killer', 'The Trapper')->'players'->0->>'mmr')::int = 800;
  assert not has_table_privilege('authenticated', 'public.player_statistics', 'UPDATE');
  assert not has_function_privilege('anon', 'public.admin_set_player_mmr(uuid,text,text,integer)', 'EXECUTE');
end $$;
reset role;
insert into public.player_matches(user_id, match_id, entry)
select user_id, 'future', entry || '{"playedAt":"2026-11-22T12:01:00.000Z"}'
from public.player_matches where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and match_id = 'killer-win';
insert into public.app_administrators(user_id, role) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'consultant');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
do $$ begin
  assert (public.player_leaderboard('1v4-killer', 'The Trapper')->'players'->0->>'mmr')::int = 809;
  begin
    perform public.admin_set_player_mmr('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '1v4-killer', 'The Trapper', 0);
    raise exception 'Consultants must not set MMR';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
