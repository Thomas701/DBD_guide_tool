import assert from "node:assert/strict";
import test from "node:test";

import { classifyRevisions, hasBlockingChanges, isGitMissing } from "./app-updater.mjs";

test("classifyRevisions n’autorise que les commits distants plus récents", () => {
  assert.equal(classifyRevisions("same", "same", true, true), "same");
  assert.equal(classifyRevisions("old", "new", true, false), "behind");
  assert.equal(classifyRevisions("new", "old", false, true), "ahead");
  assert.equal(classifyRevisions("local", "remote", false, false), "diverged");
});

test("le build courant généré ne bloque pas une mise à jour", () => {
  assert.equal(hasBlockingChanges(" M .data/current-build.json"), false);
  assert.equal(hasBlockingChanges(" M .data/current-build.json\n M src/App.tsx"), true);
});

test("isGitMissing identifie l’absence de Git sans masquer les autres erreurs", () => {
  assert.equal(isGitMissing(new Error("spawn git ENOENT")), true);
  assert.equal(isGitMissing(new Error("fatal: impossible de joindre GitHub")), false);
});
