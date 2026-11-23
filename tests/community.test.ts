import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appStorage, createAccountStorage, setAccountStorage } from "../src/services/account-storage.js";
import { setCloudClient } from "../src/services/cloud-client.js";
import { cachedLeaderboard, loadLeaderboard, readLeaderboardFilters, saveLeaderboardFilters } from "../src/services/leaderboard.js";
import { readPublicStatistics } from "../src/services/public-statistics.js";
import { LocalTierOverrideRepository } from "../src/services/tier-list.js";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test("les filtres et pages de classement sont conservés par compte, puis actualisés après expiration", async t => {
  const backing = storage(), alice = createAccountStorage(backing, "alice", () => {}).storage, bob = createAccountStorage(backing, "bob", () => {}).storage;
  let requests = 0;
  setCloudClient({ rpc: async () => { requests++; return { error: null, data: { total: 0, players: [], killers: ["The Trapper"] } }; } } as unknown as SupabaseClient);
  setAccountStorage(alice);
  t.after(() => { setCloudClient(null); setAccountStorage(null); });
  const filters = { mode: "1v4-killer", killer: "The Trapper", page: 2 };
  saveLeaderboardFilters(filters);
  await loadLeaderboard(filters); await loadLeaderboard(filters);
  assert.equal(requests, 1);
  assert.deepEqual(readLeaderboardFilters(), filters);
  setAccountStorage(bob);
  assert.equal(cachedLeaderboard(filters), null);
  assert.equal(readLeaderboardFilters().mode, "1v4-survivor");
  setAccountStorage(alice);
  const cache = JSON.parse(appStorage.getItem("dbd-build-tool.leaderboard-cache")!);
  for (const item of Object.values(cache) as { at: number }[]) item.at -= 120_000;
  appStorage.setItem("dbd-build-tool.leaderboard-cache", JSON.stringify(cache));
  assert.ok(cachedLeaderboard(filters));
  await loadLeaderboard(filters);
  assert.equal(requests, 2);
});

test("un profil public pagine toutes ses statistiques sans demander d’espace privé", async t => {
  const now = new Date().toISOString(), batches: number[] = [];
  const entries = Array.from({ length: 501 }, (_, index) => ({ id: String(index).padStart(4, "0"), characterName: "Jake Park", role: "survivor", sourceUrl: "https://stats.deadbydaylight.com/match-history/", importedAt: now, participants: [] }));
  setCloudClient({ rpc: async (name: string, args: { after_match?: string; match_ids?: string[] }) => {
    if (name === "player_match_accounts") { batches.push(args.match_ids!.length); return { error: null, data: [] }; }
    assert.equal(name, "player_statistics_page");
    return { error: null, data: { nickname: "Public player", updatedAt: now, matchHistory: args.after_match ? entries.slice(500) : entries.slice(0, 500), nextCursor: args.after_match ? null : "0499", importedCount: 0, fetchedCount: 30 } };
  } } as unknown as SupabaseClient);
  t.after(() => setCloudClient(null));
  const profile = await readPublicStatistics("public-pagination-test");
  assert.equal(profile.snapshot.matchHistory.length, 501);
  assert.deepEqual(batches, [500, 1]);
});

test("Reset replace toute la liste active en non classés et conserve les autres listes", () => {
  const repository = new LocalTierOverrideRepository(storage());
  repository.update("killers", "trapper", "S+"); repository.update("perks", "bond", "A+");
  const reset = repository.reset("perks", ["bond", "flow-state"]);
  assert.deepEqual(reset.perks, { bond: "unranked", "flow-state": "unranked" });
  assert.equal(reset.killers.trapper, "S+");
  assert.deepEqual(repository.list(), reset);
  assert.throws(() => repository.reset("perks", ["__proto__"]));
});
