import assert from "node:assert/strict";
import test from "node:test";
import { createAccountStorage, readWorkspaceData, type AppStorage, type WorkspaceData } from "../src/services/account-storage.js";
import { CloudWorkspace, WorkspaceConflictError, type WorkspaceRemote } from "../src/services/cloud-workspace.js";

function memory(): AppStorage {
  const data = new Map<string, string>();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}
const key = "dbd-build-tool.builds";

test("les comptes et le mode local ne partagent pas leurs données", () => {
  const backing = memory();
  backing.setItem(key, "ancien mode local");
  const alice = createAccountStorage(backing, "alice", () => {});
  const bob = createAccountStorage(backing, "bob", () => {});
  alice.storage.setItem(key, "build Alice");
  assert.equal(bob.storage.getItem(key), null);
  assert.equal(backing.getItem(key), "ancien mode local");
  assert.deepEqual(alice.snapshot(), { [key]: "build Alice" });
  assert.throws(() => readWorkspaceData({ "supabase.auth.token": "secret" }));
});

test("un chargement distant en conflit conserve les changements locaux", async () => {
  const local = createAccountStorage(memory(), "alice", () => {});
  local.replace({ [key]: "version 1" }, 1);
  local.storage.setItem(key, "modification hors ligne");
  const sync = new CloudWorkspace(local, { read: async () => ({ data: { [key]: "autre appareil" }, revision: 2 }), save: async () => 3 });
  await assert.rejects(sync.load(), WorkspaceConflictError);
  assert.equal(local.storage.getItem(key), "modification hors ligne");
  assert.equal(local.pending(), true);
});

test("une sauvegarde en échec reste en attente puis peut être reprise", async () => {
  const local = createAccountStorage(memory(), "alice", () => {});
  local.storage.setItem(key, "mon build");
  let fail = true;
  const remote: WorkspaceRemote = { read: async () => ({ data: {}, revision: 0 }), save: async (_data, revision) => {
    assert.equal(revision, 0);
    if (fail) throw new Error("hors ligne");
    return 1;
  } };
  const sync = new CloudWorkspace(local, remote);
  await assert.rejects(sync.flush(), /hors ligne/);
  assert.equal(local.pending(), true);
  fail = false;
  await sync.flush();
  assert.equal(local.pending(), false);
  assert.equal(local.revision(), 1);
});

test("les modifications pendant une sauvegarde sont envoyées avec la nouvelle version", async () => {
  const local = createAccountStorage(memory(), "alice", () => {});
  const saves: { data: WorkspaceData; revision: number }[] = [];
  const remote: WorkspaceRemote = { read: async () => ({ data: {}, revision: 0 }), save: async (data, revision) => {
    saves.push({ data, revision });
    if (saves.length === 1) local.storage.setItem(key, "deuxième build");
    return revision + 1;
  } };
  local.storage.setItem(key, "premier build");
  await new CloudWorkspace(local, remote).flush();
  assert.deepEqual(saves, [{ data: { [key]: "premier build" }, revision: 0 }, { data: { [key]: "deuxième build" }, revision: 1 }]);
  assert.equal(local.pending(), false);
});
