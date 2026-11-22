-- Test double for Vault's API; encryption itself is checked only on hosted Supabase.
create role service_role nologin;
create schema vault;
create table vault.secrets(id uuid primary key default gen_random_uuid(), secret text not null, name text unique);
create view vault.decrypted_secrets as select *, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid
language plpgsql as $$ declare result uuid; begin
  insert into vault.secrets(secret,name) values(new_secret,new_name) returning id into result; return result;
end $$;
create function vault.update_secret(secret_id uuid, new_secret text) returns void
language sql as $$ update vault.secrets set secret = new_secret where id = secret_id $$;
