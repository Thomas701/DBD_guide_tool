begin;
insert into auth.users(id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'staff@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'consultant@example.test'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'player@example.test');
insert into public.app_administrators(user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'administrator'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'consultant');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select public.save_shared_perk_description('survivor-wicked', '<p>Description</p>');
select public.save_shared_perk_name('survivor-wicked', '  Autre nom  ');
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select public.save_shared_perk_name('survivor-wicked', 'Malice');
select set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
do $$ begin
  assert (select name_fr from public.shared_perk_names where perk_id = 'survivor-wicked') = 'Malice';
  assert (select description_html from public.shared_perk_descriptions where perk_id = 'survivor-wicked') = '<p>Description</p>';
  begin perform public.save_shared_perk_name('survivor-wicked', null); raise exception 'A player reset a shared name'; exception when insufficient_privilege then null; end;
  begin delete from public.shared_perk_names; raise exception 'Direct writes must fail'; exception when insufficient_privilege then null; end;
  assert not has_table_privilege('anon', 'public.shared_perk_names', 'SELECT');
  assert not has_function_privilege('anon', 'public.save_shared_perk_name(text,text)', 'EXECUTE');
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select public.save_shared_perk_name('survivor-wicked', null);
do $$ begin
  assert not exists (select 1 from public.shared_perk_names where perk_id = 'survivor-wicked');
end $$;
reset role;

insert into public.statistics_collectors(user_id, token_hash) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', extensions.digest(repeat('a', 64), 'sha256'));

do $$
declare legacy_id text := 'bf3e8c54f473593cff9e617dfd969e483559b225';
  current_id text := 'afc7c77bad12231fd80b7efb2f14e06a1e12103a';
  original jsonb := jsonb_build_object('id', legacy_id, 'role', 'killer', 'characterName', 'K45', 'score', 21000,
    'playedAt', '2026-11-25T19:42:00.000Z', 'durationLabel', '9:00', 'mapName', 'LM_Liminal',
    'sourceUrl', 'https://stats.deadbydaylight.com/match-history/', 'participants', '[{"name":"K45","role":"killer"},{"name":"Sienna Shaw","role":"survivor"}]'::jsonb);
  refreshed jsonb := original || jsonb_build_object('id', current_id, 'characterName', 'The Terrifier', 'mapName', 'Hartshorne Mall', 'resultLabel', 'Merciless');
begin
  assert public.ingest_player_statistics(repeat('a', 64), null, jsonb_build_array(original))->>'importedCount' = '1';
  assert (select entry->>'characterName' from public.player_matches where match_id = legacy_id) = 'The Terrifier';
  assert (select entry->>'mapName' from public.player_matches where match_id = legacy_id) = 'Hartshorne Mall';
  assert (select entry->'participants'->0->>'name' from public.player_matches where match_id = legacy_id) = 'The Terrifier';
  assert (select entry->'participants'->1->>'name' from public.player_matches where match_id = legacy_id) = 'Sienna Shaw';
  assert public.ingest_player_statistics(repeat('a', 64), null, jsonb_build_array(refreshed))->>'importedCount' = '0';
  assert (select entry->>'id' from public.player_matches where match_id = legacy_id) = legacy_id;
  assert (select entry->>'resultLabel' from public.player_matches where match_id = legacy_id) = 'Merciless';
  update public.player_matches set deleted = true, edited = true, entry = entry || '{"characterName":"Nom corrigé"}' where match_id = legacy_id;
  assert public.ingest_player_statistics(repeat('a', 64), null, jsonb_build_array(refreshed))->>'importedCount' = '0';
  assert (select deleted and edited and entry->>'characterName' = 'Nom corrigé' from public.player_matches where match_id = legacy_id);
  assert not exists (select 1 from public.player_matches where match_id = current_id);
end $$;
rollback;
