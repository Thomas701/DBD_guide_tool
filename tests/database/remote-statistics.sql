begin;
insert into auth.users values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select set_config('test.alice_collector',public.create_statistics_collector(),true);
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
select set_config('test.bob_collector',public.create_statistics_collector(),true);
do $$ begin
  begin
    perform public.claim_remote_statistics(null);
    raise exception 'Users must never read Behaviour credentials';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.remote_statistics_sessions;
    raise exception 'Session table must be private';
  exception when insufficient_privilege then null; end;
end $$;

set local role service_role;
do $$ declare session jsonb := '{"authToken":{"token":"private-access","expirationDate":2000000000000},"refreshToken":{"token":"private-refresh","expirationDate":2100000000000}}'; jobs jsonb; lease uuid;
begin
  assert public.remote_statistics_owner(current_setting('test.alice_collector')) = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
  perform public.register_remote_statistics(current_setting('test.alice_collector'),session,repeat('a',64),'Europe/Paris');
  perform public.register_remote_statistics(current_setting('test.bob_collector'),session,repeat('b',64),'UTC');
  jobs := public.claim_remote_statistics('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert jsonb_array_length(jobs) = 1;
  assert jobs->0->>'userId' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  lease := (jobs->0->>'lease')::uuid;
  assert jsonb_array_length(public.claim_remote_statistics(null)) = 1, 'A claimed player cannot be claimed twice';
  assert jsonb_array_length(public.claim_remote_statistics(null)) = 0;
  perform public.save_remote_statistics_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',lease,
    session || '{"authToken":{"token":"renewed-access","expirationDate":2000000001000}}');
  perform public.finish_remote_statistics('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',lease,null,'[]','success','Remote synchronization successful');
  begin
    perform public.save_remote_statistics_session('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',lease,session);
    raise exception 'A player lease must never update another player';
  exception when insufficient_privilege then null; end;
  begin
    perform public.register_remote_statistics(current_setting('test.alice_collector'),session,repeat('c',64),'Europe/Paris');
    raise exception 'An unexpected Behaviour identity must be rejected';
  exception when insufficient_privilege then null; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$ begin
  assert (public.statistics_collector_status()->>'remote')::boolean;
  assert (public.statistics_collector_status()->>'state') = 'success';
end $$;
select public.revoke_statistics_collector();
reset role;
do $$ begin
  assert not exists(select 1 from public.remote_statistics_sessions where mod(extract(epoch from next_run_at),300) <> 0), 'Next runs align with the five-minute cron boundaries';
  assert not exists(select 1 from public.remote_statistics_sessions where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert (select count(*) from vault.secrets) = 1, 'Revoking Alice deletes her encrypted credentials, preserving Bob';
end $$;
set local role service_role;
do $$ begin
  assert public.remote_statistics_owner(current_setting('test.alice_collector')) is null;
  begin
    perform public.finish_remote_statistics('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',gen_random_uuid(),null,'[]','success','stale worker');
    raise exception 'Revoked workers must never upload';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
