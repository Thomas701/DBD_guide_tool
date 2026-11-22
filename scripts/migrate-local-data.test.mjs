import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { prepareLocalMigration } from "./migrate-local-data.mjs";
import { mapBehaviourMatches } from "../extension/behaviour-api.mjs";
import { behaviourHistory } from "../tests/fixtures/behaviour-api.mjs";

globalThis.crypto ??= webcrypto;
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const match = (await mapBehaviourMatches(behaviourHistory, new Date("2026-11-22T12:00:00Z"), "Europe/Paris"))[0];
const backup = rows => ({ data: {
  user_workspaces: { status: 200, rows: [{ user_id: owner, revision: 1, data: { "dbd-build-tool.builds": '[{"id":"cloud","name":"Cloud"}]', "dbd-build-tool.tier-overrides": '{"perk":"S"}' } }] },
  player_statistics: { status: 200, rows: [{ user_id: owner }] },
  player_matches: { status: 200, rows },
} });
const archive = () => ({ matchHistory: [structuredClone(match)], matchEdits: {}, deletedMatchIds: [] });

test("la migration conserve les corrections distantes, fusionne les builds et protège les préférences", () => {
  const old = { user_id: owner, match_id: match.id, entry: { ...match, resultLabel: "Escaped" }, edited: true, deleted: false };
  const local = archive(); local.matchEdits[match.id] = { resultLabel: "Dead" };
  const result = prepareLocalMigration(local, backup([old]), { "dbd-build-tool.builds": '[{"id":"cloud","name":"Old"},{"id":"local","name":"Local"}]', "dbd-build-tool.tier-overrides": '{"perk":"C","other":"B"}' });
  assert.equal(result.rows[0].entry.resultLabel, "Escaped");
  assert.deepEqual(JSON.parse(result.data["dbd-build-tool.builds"]), [{ id: "cloud", name: "Cloud" }, { id: "local", name: "Local" }]);
  assert.deepEqual(JSON.parse(result.data["dbd-build-tool.tier-overrides"]), { perk: "S", other: "B" });
});

test("les corrections locales gardent l’ID original et les suppressions restent des tombstones", () => {
  const local = archive(); local.matchEdits[match.id] = { score: 99999, participants: [{ resultLabel: "Escaped" }] };
  const result = prepareLocalMigration(local, backup([]));
  assert.equal(result.rows[0].match_id, match.id); assert.equal(result.rows[0].entry.id, match.id);
  assert.equal(result.rows[0].entry.score, 99999); assert.equal(result.rows[0].edited, true);
  assert.equal(result.rows[0].entry.participants[0].resultLabel, "Escaped");
  local.deletedMatchIds = [match.id]; delete local.matchEdits[match.id];
  assert.equal(prepareLocalMigration(local, backup([])).rows[0].deleted, true);
  const tombstone = { user_id: owner, match_id: match.id, entry: match, edited: true, deleted: true };
  assert.equal(prepareLocalMigration(archive(), backup([tombstone])).rows[0].deleted, true);
});

test("un export incomplet, plusieurs comptes et les clés de connexion sont refusés", () => {
  const remote = backup([]);
  assert.throws(() => prepareLocalMigration(archive(), { data: { ...remote.data, player_matches: { status: 401 } } }));
  const mixed = backup([{ user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }]);
  assert.throws(() => prepareLocalMigration(archive(), mixed), /one connected account/);
  assert.throws(() => prepareLocalMigration(archive(), backup([]), { "supabase.auth.token": "secret" }), /Unrecognized workspace key/);
});
