import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildMatchHistoryEntryId } from "./match-history-id.mjs";

import { deleteMatchHistoryEntry, mergeMatchHistoryEntries, readStatisticsSnapshot, syncStatisticsSnapshot, updateMatchHistoryEntry, updateNativePerk } from "./local-data-files.mjs";

test("une nouvelle installation initialise un historique vide sans fichier local préalable", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dbd-first-install-"));
  const previousWorkingDirectory = process.cwd();
  try {
    process.chdir(workspace);
    const snapshot = await readStatisticsSnapshot();
    assert.deepEqual(snapshot.matchHistory, []);
    assert.equal(snapshot.statistics, null);
    assert.equal(snapshot.importedCount, 0);
    assert.deepEqual((await readStatisticsSnapshot()).matchHistory, []);
  } finally {
    process.chdir(previousWorkingDirectory);
    await rm(workspace, { recursive: true, force: true });
  }
});

test("la correction d’un mode spécial ne crée pas de doublon et résiste à une carte partielle", () => {
  const initial = matchHistoryEntry("normal");
  const corrected = { ...initial, queueLabel: "Lights Out" };
  const merged = mergeMatchHistoryEntries([initial], [corrected]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, buildMatchHistoryEntryId(initial));
  assert.equal(merged[0].queueLabel, "Lights Out");
  assert.equal(mergeMatchHistoryEntries(merged, [initial])[0].queueLabel, "Lights Out");
});

test("met à jour une perk survivant dans les données locales", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dbd-build-tool-"));
  const previousWorkingDirectory = process.cwd();

  try {
    await seedWorkspace(workspace);
    process.chdir(workspace);

    const updated = await updateNativePerk("survivor-adrenaline", {
      descriptionHtml: "<p>Description test</p>",
      categories: ["speed"]
    });

    assert.equal(updated.id, "survivor-adrenaline");
    assert.equal(updated.nativeDescriptionHtml, "<p>Description test</p>");
    assert.deepEqual(updated.categories, ["speed"]);
    assert.equal(updated.characterId, "meg");
    assert.equal(updated.characterResolution, "resolved");
    assert.equal(updated.cooldown, null);
    assert.equal(updated.analysisReadiness, "unavailable");
    assert.equal(updated.description.en, null);
    assert.equal(updated.description.fr?.version, 1);

    const survivorPerks = JSON.parse(await readFile(join(workspace, "src/data/generated/survivor-perks.json"), "utf8"));
    assert.deepEqual(survivorPerks, [{
      id: "survivor-adrenaline",
      side: "survivor",
      name: { fr: "Adrénaline", en: "Adrenaline" },
      description: { fr: "", en: "" },
      icon: "adrenaline.png",
      categories: ["speed"],
      effects: [],
      effectImportStatus: "unparsed",
      nativeDescriptionHtml: "<p>Description test</p>"
    }]);

    const overrides = JSON.parse(await readFile(join(workspace, "src/data/perk-native-overrides.json"), "utf8"));
    assert.deepEqual(overrides, {
      "survivor-adrenaline": {
        nativeDescriptionHtml: "<p>Description test</p>",
        categories: ["speed"]
      }
    });
  } finally {
    process.chdir(previousWorkingDirectory);
    await rm(workspace, { recursive: true, force: true });
  }
});

test("une modification native conserve les effets, le cooldown et la précision de l’analyse survivant", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dbd-build-tool-"));
  const previousWorkingDirectory = process.cwd();
  try {
    await seedWorkspace(workspace);
    const path = join(workspace, "src/data/generated/survivor-perks.json");
    const [perk] = JSON.parse(await readFile(path, "utf8"));
    const effects = [{ stat: "survivor.run_speed", operation: "multiply", value: 1.5, unit: "multiplier", interpretation: "inferred" }];
    await writeFile(path, JSON.stringify([{ ...perk, effects, cooldown: 30, effectImportStatus: "parsed", analysisReadiness: "partial" }]));
    process.chdir(workspace);
    const updated = await updateNativePerk(perk.id, { categories: ["speed"] });
    assert.deepEqual(updated.effects, effects);
    assert.equal(updated.cooldown, 30);
    assert.equal(updated.analysisReadiness, "partial");
    const [stored] = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(stored.effects, effects);
    assert.equal(stored.cooldown, 30);
    assert.equal(stored.effectImportStatus, "parsed");
  } finally {
    process.chdir(previousWorkingDirectory);
    await rm(workspace, { recursive: true, force: true });
  }
});

test("fusionne l'historique local des parties sans doublons", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dbd-build-tool-"));
  const previousWorkingDirectory = process.cwd();

  try {
    await seedWorkspace(workspace);
    process.chdir(workspace);

    const first = await syncStatisticsSnapshot({
      statistics: {
        hoursPlayed: "120",
        matchesPlayed: "16",
        bloodpointsEarned: "765,432",
        sourceUrl: "https://stats.deadbydaylight.com/statistics/"
      },
      matchHistory: [matchHistoryEntry("match-1", { playedAt: "2026-09-17T20:11:00.000Z", playedAtLabel: "Sep 17, 8:11 PM" })]
    });

    assert.equal(first.importedCount, 1);
    assert.equal(first.matchHistory.length, 1);

    const second = await syncStatisticsSnapshot({
      statistics: {
        hoursPlayed: "121",
        matchesPlayed: "17",
        bloodpointsEarned: "800,000",
        sourceUrl: "https://stats.deadbydaylight.com/statistics/"
      },
      matchHistory: [
        matchHistoryEntry("match-1", { playedAt: "2026-09-17T20:11:00.000Z", playedAtLabel: "Sep 17, 8:11 PM" }),
        matchHistoryEntry("match-2", { playedAt: "2026-09-17T01:00:00.000Z", playedAtLabel: "Sep 17, 1:00 AM", characterName: "Jake Park" })
      ]
    });

    assert.equal(second.importedCount, 1);
    assert.equal(second.fetchedCount, 2);
    assert.equal(second.statistics?.matchesPlayed, "17");
    assert.deepEqual(second.matchHistory.map((entry) => entry.characterName), ["The Dredge", "Jake Park"]);
    assert.equal(second.matchHistory[0].id, buildMatchHistoryEntryId(matchHistoryEntry("match-1")));

    const stored = await readStatisticsSnapshot();
    assert.equal(stored.importedCount, 0);
    assert.equal(stored.matchHistory.length, 2);

    const enriched = matchHistoryEntry("old-id", { survivalTimeLabel: "7:30", emblemIconUrls: ["emblem"], emblemIconLabels: ["Chaser - Gold"], participants: [{ imageUrl: "portrait", score: 12, survivalTimeLabel: "9:01", perkIconUrls: ["perk"], equipmentIconUrls: ["item", "addon"], emblemIconUrls: ["participant-emblem"] }] });
    const shallow = matchHistoryEntry("different-id", { participants: [{ imageUrl: "portrait", score: 12 }] });
    await writeFile(join(workspace, ".data/dbd-statistics.json"), JSON.stringify({ matchHistory: [enriched, shallow] }));
    const cleaned = await readStatisticsSnapshot();
    assert.equal(cleaned.matchHistory.length, 1);
    assert.equal(cleaned.matchHistory[0].participants[0].survivalTimeLabel, "9:01");
    const persisted = JSON.parse(await readFile(join(workspace, ".data/dbd-statistics.json"), "utf8"));
    assert.equal(persisted.matchHistory.length, 1);
    assert.equal(persisted.matchHistory[0].id, buildMatchHistoryEntryId(enriched));
    const repeated = await syncStatisticsSnapshot({ matchHistory: [shallow, shallow] });
    assert.equal(repeated.importedCount, 0);
    assert.equal(repeated.matchHistory.length, 1);
    assert.equal(repeated.matchHistory[0].participants[0].survivalTimeLabel, "9:01");
    assert.deepEqual(repeated.matchHistory[0].participants[0].perkIconUrls, ["perk"]);
    assert.deepEqual(repeated.matchHistory[0].participants[0].equipmentIconUrls, ["item", "addon"]);
    assert.equal(repeated.matchHistory[0].survivalTimeLabel, "7:30");
    assert.deepEqual(repeated.matchHistory[0].emblemIconUrls, ["emblem"]);
    assert.deepEqual(repeated.matchHistory[0].emblemIconLabels, ["Chaser - Gold"]);
    assert.deepEqual(repeated.matchHistory[0].participants[0].emblemIconUrls, ["participant-emblem"]);
  } finally {
    process.chdir(previousWorkingDirectory);
    await rm(workspace, { recursive: true, force: true });
  }
});

test("conserve les corrections et suppressions après synchronisation et complète les autres détails", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "dbd-build-tool-"));
  const previousWorkingDirectory = process.cwd();
  try {
    await seedWorkspace(workspace);
    process.chdir(workspace);
    const base = matchHistoryEntry("old", { participants: [{ imageUrl: "portrait", score: 12 }] });
    const first = await syncStatisticsSnapshot({ matchHistory: [base] });
    const id = first.matchHistory[0].id;
    await updateMatchHistoryEntry(id, { ...first.matchHistory[0], resultLabel: "Corrigé" });
    const enriched = matchHistoryEntry("new", { participants: [{ imageUrl: "portrait", score: 12, perkIconUrls: ["perk"], equipmentIconUrls: ["item"] }] });
    const second = await syncStatisticsSnapshot({ matchHistory: [enriched] });
    assert.equal(second.matchHistory[0].resultLabel, "Corrigé");
    assert.deepEqual(second.matchHistory[0].participants[0].perkIconUrls, ["perk"]);
    const deleted = await deleteMatchHistoryEntry(id);
    assert.equal(deleted.matchHistory.length, 0);
    const repeated = await syncStatisticsSnapshot({ matchHistory: [enriched] });
    assert.equal(repeated.matchHistory.length, 0);
    assert.equal((await readStatisticsSnapshot()).matchHistory.length, 0);
  } finally {
    process.chdir(previousWorkingDirectory);
    await rm(workspace, { recursive: true, force: true });
  }
});

async function seedWorkspace(workspace) {
  await mkdir(join(workspace, "src/data/generated"), { recursive: true });
  await mkdir(join(workspace, "src/data"), { recursive: true });

  await writeFile(join(workspace, "src/data/generated/perks.json"), "[]\n", "utf8");
  await writeFile(join(workspace, "src/data/generated/categories.json"), JSON.stringify(["speed", "aura"], null, 2) + "\n", "utf8");
  await writeFile(join(workspace, "src/data/generated/survivor-perks.json"), JSON.stringify([{
    id: "survivor-adrenaline",
    side: "survivor",
    name: { fr: "Adrénaline", en: "Adrenaline" },
    description: { fr: "", en: "" },
    icon: "adrenaline.png",
    categories: [],
    effects: [],
    effectImportStatus: "unparsed"
  }], null, 2) + "\n", "utf8");
  await writeFile(join(workspace, "src/data/generated/survivor-perk-descriptions.json"), JSON.stringify({
    "survivor-adrenaline": {
      version: 1,
      blocks: [{ type: "paragraph", children: [{ type: "text", value: "Description riche" }] }]
    }
  }, null, 2) + "\n", "utf8");
  await writeFile(join(workspace, "src/data/generated/survivor-perk-owners.json"), JSON.stringify({ "survivor-adrenaline": "meg" }, null, 2) + "\n", "utf8");
  await writeFile(join(workspace, "src/data/perk-native-overrides.json"), "{}\n", "utf8");
}

function matchHistoryEntry(id, overrides = {}) {
  return {
    id,
    role: "killer",
    characterName: "The Dredge",
    resultLabel: "Merciless Killer",
    score: 32411,
    characterImageUrl: "https://images.example/dredge.png",
    perkIconUrls: ["perk-1", "perk-2", "perk-3", "perk-4"],
    equipmentIconUrls: ["power", "addon"],
    participants: [],
    mapName: "Midwich Elementary School",
    mapImageUrl: "https://images.example/midwich.jpg",
    playedAt: "2026-09-17T20:11:00.000Z",
    playedAtLabel: "Sep 17, 8:11 PM",
    durationLabel: "9:01",
    queueLabel: null,
    sourceUrl: "https://stats.deadbydaylight.com/match-history/",
    importedAt: "2026-09-17T20:30:00.000Z",
    ...overrides
  };
}
