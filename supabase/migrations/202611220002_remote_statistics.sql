do $$ begin
  if to_regclass('vault.secrets') is null then create extension if not exists supabase_vault with schema vault; end if;
end $$;

create table public.remote_statistics_sessions (
  user_id uuid primary key references public.statistics_collectors(user_id) on delete cascade,
  secret_id uuid not null unique,
  next_run_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz
);
alter table public.remote_statistics_sessions enable row level security;
revoke all on public.remote_statistics_sessions from public, anon, authenticated;

create function public.delete_remote_statistics_secret() returns trigger
language plpgsql security definer set search_path = '' as $$
begin delete from vault.secrets where id = old.secret_id; return old; end;
$$;
revoke all on function public.delete_remote_statistics_secret() from public, anon, authenticated;
create trigger delete_remote_statistics_secret after delete on public.remote_statistics_sessions
  for each row execute function public.delete_remote_statistics_secret();

create or replace function public.create_statistics_collector() returns text
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  delete from public.remote_statistics_sessions where user_id = owner_id;
  insert into public.statistics_collectors(user_id, token_hash) values(owner_id, extensions.digest(token, 'sha256'))
    on conflict(user_id) do update set token_hash = excluded.token_hash, created_at = now(), last_seen_at = null,
      state = 'waiting_for_login', message = 'Connectez Behaviour pour activer la synchronisation distante.';
  return token;
end;
$$;

create or replace function public.revoke_statistics_collector() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  delete from public.statistics_collectors where user_id = auth.uid();
end;
$$;

create or replace function public.statistics_collector_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('connected', true, 'remote', exists(
    select 1 from public.remote_statistics_sessions where user_id = auth.uid()),
    'state', state, 'message', message, 'lastSeenAt', last_seen_at)
    from public.statistics_collectors where user_id = auth.uid()),
    '{"connected":false,"remote":false,"state":"waiting_for_login","message":"Connectez Behaviour pour activer la synchronisation distante.","lastSeenAt":null}'::jsonb);
$$;

create function public.remote_statistics_owner(collector_token text) returns uuid
language sql stable security definer set search_path = '' as $$
  select user_id from public.statistics_collectors where length(collector_token) = 64 and token_hash = extensions.digest(collector_token, 'sha256');
$$;

create function public.register_remote_statistics(collector_token text, behaviour_session jsonb, fingerprint text, time_zone text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := public.remote_statistics_owner(collector_token); existing public.remote_statistics_sessions;
  previous jsonb; secret uuid;
begin
  if owner_id is null then raise exception 'Collector revoked' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  if public.remote_statistics_owner(collector_token) is distinct from owner_id then raise exception 'Collector revoked' using errcode = '42501'; end if;
  if jsonb_typeof(behaviour_session) is distinct from 'object' or octet_length(behaviour_session::text) > 40000
    or jsonb_typeof(behaviour_session->'authToken'->'token') is distinct from 'string'
    or jsonb_typeof(behaviour_session->'refreshToken'->'token') is distinct from 'string'
    or jsonb_typeof(behaviour_session->'authToken'->'expirationDate') is distinct from 'number'
    or jsonb_typeof(behaviour_session->'refreshToken'->'expirationDate') is distinct from 'number'
    or coalesce(fingerprint, '') !~ '^[a-f0-9]{64}$'
    or not exists(select 1 from pg_timezone_names where name = time_zone)
  then raise exception 'Invalid Behaviour session' using errcode = '22023'; end if;
  select * into existing from public.remote_statistics_sessions where user_id = owner_id for update;
  if found then
    select decrypted_secret::jsonb into previous from vault.decrypted_secrets where id = existing.secret_id;
    if previous->>'fingerprint' is distinct from fingerprint then raise exception 'Behaviour account changed' using errcode = '42501'; end if;
    if (previous->'session'->'authToken'->>'expirationDate')::numeric >= (behaviour_session->'authToken'->>'expirationDate')::numeric then return owner_id; end if;
    if existing.lease_until > clock_timestamp() then raise exception 'Synchronization in progress; retry' using errcode = '40001'; end if;
    secret := existing.secret_id;
    perform vault.update_secret(secret, jsonb_build_object('collectorToken', collector_token, 'session', behaviour_session, 'fingerprint', fingerprint, 'timeZone', time_zone)::text);
  else
    secret := vault.create_secret(jsonb_build_object('collectorToken', collector_token, 'session', behaviour_session, 'fingerprint', fingerprint, 'timeZone', time_zone)::text);
  end if;
  insert into public.remote_statistics_sessions(user_id, secret_id) values(owner_id, secret)
    on conflict(user_id) do update set next_run_at = now(), lease_token = null, lease_until = null;
  update public.statistics_collectors set message = 'Synchronisation distante activée, même navigateur fermé.' where user_id = owner_id;
  return owner_id;
end;
$$;

create function public.claim_remote_statistics(target_user uuid default null) returns jsonb
language sql security definer set search_path = '' as $$
  with candidates as (
    select user_id from public.remote_statistics_sessions
      where next_run_at <= now() and (lease_until is null or lease_until < now())
        and (target_user is null or user_id = target_user)
      order by next_run_at, user_id limit 10 for update skip locked
  ), claimed as (
    update public.remote_statistics_sessions r set lease_token = gen_random_uuid(), lease_until = now() + interval '2 minutes',
      next_run_at = to_timestamp((floor(extract(epoch from now()) / 300) + 1) * 300)
      from candidates c where r.user_id = c.user_id returning r.user_id, r.lease_token, r.secret_id
  ) select coalesce(jsonb_agg(jsonb_build_object('userId', c.user_id, 'lease', c.lease_token, 'credentials', v.decrypted_secret::jsonb)), '[]'::jsonb)
    from claimed c join vault.decrypted_secrets v on v.id = c.secret_id;
$$;

create function public.save_remote_statistics_session(owner_id uuid, lease uuid, behaviour_session jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare stored_secret_id uuid; credentials jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  select secret_id into stored_secret_id from public.remote_statistics_sessions
    where user_id = owner_id and lease_token = lease and lease_until > clock_timestamp() for update;
  if stored_secret_id is null then raise exception 'Synchronization revoked or expired' using errcode = '42501'; end if;
  if jsonb_typeof(behaviour_session) is distinct from 'object' or octet_length(behaviour_session::text) > 40000 then raise exception 'Invalid session' using errcode = '22023'; end if;
  select decrypted_secret::jsonb into credentials from vault.decrypted_secrets where id = stored_secret_id;
  perform vault.update_secret(stored_secret_id, (credentials || jsonb_build_object('session', behaviour_session))::text);
end;
$$;

create function public.finish_remote_statistics(owner_id uuid, lease uuid, statistics jsonb, matches jsonb, state text, detail text)
returns void language plpgsql security definer set search_path = '' as $$
declare token text;
begin
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  select v.decrypted_secret::jsonb->>'collectorToken' into token from public.remote_statistics_sessions r
    join vault.decrypted_secrets v on v.id = r.secret_id
    where r.user_id = owner_id and r.lease_token = lease and r.lease_until > clock_timestamp() for update of r;
  if token is null then raise exception 'Synchronization revoked or expired' using errcode = '42501'; end if;
  perform public.ingest_player_statistics(token, statistics, matches, state, detail);
  update public.remote_statistics_sessions set lease_token = null, lease_until = null where user_id = owner_id;
end;
$$;

create function public.authorize_statistics_cron(token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select length(token) = 64 and exists(select 1 from vault.decrypted_secrets
    where name = 'dbd_statistics_cron_token' and extensions.digest(decrypted_secret, 'sha256') = extensions.digest(token, 'sha256'));
$$;

revoke all on function public.remote_statistics_owner(text), public.register_remote_statistics(text,jsonb,text,text), public.claim_remote_statistics(uuid),
  public.save_remote_statistics_session(uuid,uuid,jsonb), public.finish_remote_statistics(uuid,uuid,jsonb,jsonb,text,text), public.authorize_statistics_cron(text)
  from public, anon, authenticated;
grant execute on function public.remote_statistics_owner(text), public.register_remote_statistics(text,jsonb,text,text), public.claim_remote_statistics(uuid),
  public.save_remote_statistics_session(uuid,uuid,jsonb), public.finish_remote_statistics(uuid,uuid,jsonb,jsonb,text,text), public.authorize_statistics_cron(text) to service_role;
