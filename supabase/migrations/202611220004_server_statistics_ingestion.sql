-- Only the server collector may import statistics; browser imports would bypass admin edit permissions.
revoke all on function public.ingest_player_statistics(text, jsonb, jsonb, text, text) from anon, authenticated;
grant execute on function public.ingest_player_statistics(text, jsonb, jsonb, text, text) to service_role;
