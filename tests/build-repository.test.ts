import assert from "node:assert/strict";
import test from "node:test";

import { BUILDS_STORAGE_KEY, LocalBuildRepository } from "../src/services/build-repository.js";
import { CATEGORY_OVERRIDES_STORAGE_KEY, LocalCategoryOverrideRepository } from "../src/services/description-overrides.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function repository(storage = new MemoryStorage()) {
  const ids = ["build-1", "build-2"];
  const dates = [
    "2026-01-01T10:00:00.000Z",
    "2026-01-02T10:00:00.000Z",
    "2026-01-03T10:00:00.000Z",
  ];
  return {
    storage,
    repository: new LocalBuildRepository(storage, {
      generateId: () => ids.shift()!,
      now: () => new Date(dates.shift()!),
    }),
  };
}

test("le repository crée, modifie, duplique et supprime sans changer les identités", () => {
  const { repository: builds } = repository();
  const created = builds.create({
    name: "  Ghost Face — Aura  ",
    killerId: "ghost-face",
    perkIds: ["nurses-calling", "lethal-pursuer"],
  });

  assert.deepEqual(created, {
    id: "build-1",
    name: "Ghost Face — Aura",
    killerId: "ghost-face",
    perkIds: ["nurses-calling", "lethal-pursuer"],
    createdAt: "2026-01-01T10:00:00.000Z",
    updatedAt: "2026-01-01T10:00:00.000Z",
  });

  const updated = builds.update("build-1", { perkIds: ["nurses-calling"] });
  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.updatedAt, "2026-01-02T10:00:00.000Z");
  assert.deepEqual(updated.perkIds, ["nurses-calling"]);

  const copy = builds.duplicate("build-1", "Ghost Face — Aura (copie)");
  assert.equal(copy.id, "build-2");
  assert.equal(copy.createdAt, "2026-01-03T10:00:00.000Z");
  assert.deepEqual(copy.perkIds, updated.perkIds);
  assert.notEqual(copy.perkIds, updated.perkIds);

  assert.equal(builds.delete("build-1"), true);
  assert.equal(builds.delete("inconnu"), false);
  assert.deepEqual(builds.list(), [copy]);
});

test("le repository refuse les builds incomplets, dupliqués ou trop grands", () => {
  const { repository: builds } = repository();

  assert.throws(
    () => builds.create({ name: " ", killerId: "", perkIds: [] }),
    /missing_name, invalid_killer_id/,
  );
  assert.throws(
    () => builds.create({ name: "Test", killerId: "trapper", perkIds: ["a", "a"] }),
    /duplicate_perks/,
  );
  assert.throws(
    () => builds.create({ name: "Test", killerId: "trapper", perkIds: ["a", "b", "c", "d", "e"] }),
    /too_many_perks/,
  );
  assert.throws(
    () => builds.create({ name: "Test", killerId: "trapper", perkIds: [""] }),
    /invalid_perk_id/,
  );
  assert.deepEqual(builds.list(), []);
});

test("le repository signale un localStorage corrompu sans l'écraser", () => {
  const storage = new MemoryStorage();
  storage.setItem(BUILDS_STORAGE_KEY, "{pas du json");
  const { repository: builds } = repository(storage);

  assert.throws(() => builds.list(), /illisible/);
  assert.equal(storage.getItem(BUILDS_STORAGE_KEY), "{pas du json");
  builds.clear();
  assert.deepEqual(builds.list(), []);
});

test("les catégories locales acceptent une liste vide et peuvent revenir au natif", () => {
  const storage = new MemoryStorage();
  const categories = new LocalCategoryOverrideRepository(storage);

  assert.deepEqual(categories.update("agitation", ["speed", "speed", "hook"]), { agitation: ["speed", "hook"] });
  assert.deepEqual(categories.update("agitation", []), { agitation: [] });
  assert.equal(storage.getItem(CATEGORY_OVERRIDES_STORAGE_KEY), JSON.stringify({ agitation: [] }));
  assert.deepEqual(categories.delete("agitation"), {});
  assert.equal(storage.getItem(CATEGORY_OVERRIDES_STORAGE_KEY), null);
});
