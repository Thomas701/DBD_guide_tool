import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildMatchHistoryEntryId } from "./match-history-id.mjs";

import { readStatisticsSnapshot, syncStatisticsSnapshot, updateNativePerk } from "./local-data-files.mjs";

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

    const enriched = matchHistoryEntry("old-id", { participants: [{ imageUrl: "portrait", score: 12, survivalTimeLabel: "9:01", perkIconUrls: ["perk"], equipmentIconUrls: ["item", "addon"] }] });
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
