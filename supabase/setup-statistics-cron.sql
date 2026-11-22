-- Run after deploying sync-statistics; the URL is public and contains no credential.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
revoke all on net.http_request_queue from public, anon, authenticated;
revoke all on vault.secrets, vault.decrypted_secrets from public, anon, authenticated;

do $$ begin
  if not exists(select 1 from vault.secrets where name = 'dbd_statistics_cron_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'dbd_statistics_cron_token', 'Authentication for the DBD statistics scheduler');
  end if;
end $$;

select cron.schedule('dbd-statistics-sync', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://stlhqufxhcaqsllspmgr.supabase.co/functions/v1/sync-statistics',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dbd-cron-token',
      (select decrypted_secret from vault.decrypted_secrets where name = 'dbd_statistics_cron_token')),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);
