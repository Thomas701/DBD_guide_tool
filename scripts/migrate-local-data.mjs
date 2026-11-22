import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { mergeMatchHistoryEntries } from "./local-data-files.mjs";

export function prepareLocalMigration(local, backup, workspace = {}) {
  const remote = backup.data;
  for (const table of ["user_workspaces", "player_statistics", "player_matches"]) assert.equal(remote?.[table]?.status, 200, `Backup ${table} incomplete`);
  const owners = new Set(Object.values(remote).flatMap(table => table.rows.map(row => row.user_id)));
  assert.equal(owners.size, 1, "Export exactly one connected account before importing");
  const [userId] = owners;
  assert.match(userId, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  const matches = mergeMatchHistoryEntries([], local.matchHistory);
  assert.equal(matches.length, local.matchHistory.length, "Invalid or duplicate local matches: archive left unchanged");
  const current = new Map(remote.player_matches.rows.map(row => [row.match_id, row]));
  const deleted = new Set(local.deletedMatchIds ?? []);
  const rows = matches.map(entry => {
    const source = local.matchHistory.find(item => item.id === entry.id);
    assert.ok(source, "Normalize the archive IDs before migrating its edits");
    const old = current.get(entry.id), patch = local.matchEdits?.[entry.id];
    if (old?.edited || old?.deleted) return old;
    if (patch) entry = { ...entry, ...patch, id: entry.id, participants: entry.participants.map((participant, index) => ({ ...participant, ...patch.participants?.[index] })) };
    else if (old) {
      const [merged] = mergeMatchHistoryEntries([entry], [old.entry]);
      for (const key of ["perkIconUrls", "perkIconLabels", "equipmentIconUrls", "equipmentIconLabels", "emblemIconUrls", "emblemIconLabels"]) {
        if (!merged[key]?.length && entry[key]?.length) merged[key] = entry[key];
      }
      entry = merged;
    }
    return { match_id: entry.id, entry, edited: Boolean(patch) || deleted.has(entry.id), deleted: deleted.has(entry.id) };
  });
  assert.ok([...deleted, ...Object.keys(local.matchEdits ?? {})].every(id => rows.some(row => row.match_id === id)), "An edit or deletion has no matching local game");
  const oldWorkspace = remote.user_workspaces.rows[0];
  const data = { ...oldWorkspace?.data };
  for (const [key, value] of Object.entries(workspace.workspace ?? workspace)) {
    assert.ok(/^dbd-build-tool\.(builds|current-session|perk-description-overrides|perk-category-overrides|tier-overrides|assistant-conversations|assistant-build-keys|assistant-session|assistant-provider)$/.test(key) && typeof value === "string", "Unrecognized workspace key");
    if (data[key] === undefined) data[key] = value;
    else if (["dbd-build-tool.builds", "dbd-build-tool.assistant-conversations"].includes(key)) {
      const previous = JSON.parse(data[key]), incoming = JSON.parse(value);
      assert.ok(Array.isArray(previous) && Array.isArray(incoming));
      const items = new Map(incoming.map(item => [item.id, item]));
      for (const item of previous) items.set(item.id, item);
      data[key] = JSON.stringify([...items.values()]);
    } else if (key.endsWith("overrides")) data[key] = JSON.stringify({ ...JSON.parse(value), ...JSON.parse(data[key]) });
  }
  return { userId, rows, data, overview: local.statistics, expectedWorkspace: oldWorkspace ?? null, expectedMatches: remote.player_matches.rows.map(({ match_id, entry, edited, deleted }) => ({ match_id, entry, edited, deleted })) };
}

export function migrationSql(payload) {
  const literal = JSON.stringify(payload).replaceAll("'", "''");
  let delimiter = "$migration$";
  while (literal.includes(delimiter)) delimiter = `$${delimiter.slice(1, -1)}_$`;
  return `begin;
set local standard_conforming_strings = on;
do ${delimiter}
declare payload jsonb := '${literal}'::jsonb; owner_id uuid := (payload->>'userId')::uuid;
  item jsonb; sync_at timestamptz; current_workspace jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  sync_at := clock_timestamp();
  if not exists (select 1 from auth.users where id = owner_id) then raise exception 'Account not found'; end if;
  select to_jsonb(w) into current_workspace from public.user_workspaces w where user_id = owner_id for update;
  if coalesce(current_workspace->'data', '{}'::jsonb) is distinct from coalesce(payload->'expectedWorkspace'->'data', '{}'::jsonb)
    or coalesce(current_workspace->'revision', '0'::jsonb) is distinct from coalesce(payload->'expectedWorkspace'->'revision', '0'::jsonb)
  then raise exception 'Workspace changed: export the account again'; end if;
  if (select count(*) from public.player_matches where user_id = owner_id) <> jsonb_array_length(payload->'expectedMatches')
    or exists (select 1 from jsonb_array_elements(payload->'expectedMatches') e where not exists (
      select 1 from public.player_matches m where m.user_id = owner_id and m.match_id = e->>'match_id'
      and m.entry = e->'entry' and m.edited = (e->>'edited')::boolean and m.deleted = (e->>'deleted')::boolean))
  then raise exception 'Statistics changed: export the account again'; end if;
  for item in select value from jsonb_array_elements(payload->'rows') loop
    insert into public.player_matches(user_id, match_id, entry, edited, deleted, updated_at)
      values(owner_id, item->>'match_id', item->'entry', (item->>'edited')::boolean, (item->>'deleted')::boolean, sync_at)
      on conflict(user_id, match_id) do update set entry = excluded.entry, edited = excluded.edited, deleted = excluded.deleted, updated_at = sync_at
      where not player_matches.edited and not player_matches.deleted;
  end loop;
  insert into public.player_statistics(user_id, overview, updated_at) values(owner_id, payload->'overview', sync_at)
    on conflict(user_id) do update set overview = coalesce(player_statistics.overview, excluded.overview), updated_at = sync_at;
  if coalesce(current_workspace->'data', '{}'::jsonb) is distinct from payload->'data' then
    insert into public.user_workspaces(user_id, data) values(owner_id, payload->'data')
      on conflict(user_id) do update set data = excluded.data, revision = user_workspaces.revision + 1, updated_at = sync_at;
  end if;
end;
${delimiter};
commit;
select count(*) filter(where not deleted) as visible_matches, count(*) filter(where edited and not deleted) as corrected_matches,
  count(*) filter(where deleted) as deleted_matches from public.player_matches where user_id = '${payload.userId}'::uuid;
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [localFile, remoteFile, workspaceFile, output] = process.argv.slice(2);
  assert.ok(localFile && remoteFile && workspaceFile && output, "Usage: node scripts/migrate-local-data.mjs local-statistics.json remote-backup.json local-workspace.json output.sql");
  const [local, remote, workspace] = await Promise.all([localFile, remoteFile, workspaceFile].map(async file => JSON.parse(await readFile(file, "utf8"))));
  const payload = prepareLocalMigration(local, remote, workspace);
  await writeFile(output, migrationSql(payload), { flag: "wx", encoding: "utf8" });
  console.log(`Prepared ${payload.rows.length} local games; ${payload.rows.filter(row => row.edited && !row.deleted).length} corrections; ${payload.rows.filter(row => row.deleted).length} deletions. Review and run ${output} in the Supabase SQL editor.`);
}
