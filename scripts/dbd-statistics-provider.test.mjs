import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

import { buildMatchHistoryEntryId, DbdStatisticsProvider, extractParticipantLoadoutFromHtml, extractMatchHistoryEntriesFromHtml, isMatchHistoryUrl, isStatisticsUrl, listeningProcessIds, normalizeMatchHistoryCard, parseMatchDateLabel, takeMatchesUntilKnown } from "./dbd-statistics-provider.mjs";

test("reconnaît uniquement une page de statistiques DBD", () => {
  assert.equal(isStatisticsUrl("https://stats.deadbydaylight.com/statistics/"), true);
  assert.equal(isStatisticsUrl("https://stats.deadbydaylight.com/fr/statistics"), true);
  assert.equal(isStatisticsUrl("https://account.bhvr.com/"), false);
});

test("reconnaît uniquement une page d'historique des parties DBD", () => {
  assert.equal(isMatchHistoryUrl("https://stats.deadbydaylight.com/match-history/"), true);
  assert.equal(isMatchHistoryUrl("https://stats.deadbydaylight.com/fr/match-history"), true);
  assert.equal(isMatchHistoryUrl("https://stats.deadbydaylight.com/statistics/"), false);
});

test("refuse d'ouvrir une page extérieure dans le Chrome contrôlé", async () => {
  await assert.rejects(new DbdStatisticsProvider().showPage("https://example.com/"), { code: "INVALID_URL" });
});

test("identifie uniquement le processus Windows qui écoute sur le port CDP", () => {
  const output = [
    "TCP    127.0.0.1:9333    0.0.0.0:0    LISTENING    4242",
    "TCP    127.0.0.1:5173    0.0.0.0:0    LISTENING    5151",
    "TCP    127.0.0.1:9333    127.0.0.1:51000    ESTABLISHED    4242"
  ].join("\r\n");
  assert.deepEqual(listeningProcessIds(output, 9333), ["4242"]);
});

test("arrête l'historique au premier match déjà présent", () => {
  const entries = [{ id: "new-2" }, { id: "new-1" }, { id: "known" }, { id: "older" }];
  assert.deepEqual(takeMatchesUntilKnown(entries, new Set(["known", "older"])), {
    entries: entries.slice(0, 2),
    reachedKnownMatch: true
  });
  assert.deepEqual(takeMatchesUntilKnown(entries, new Set()), {
    entries,
    reachedKnownMatch: false
  });
});

test("normalise une carte killer d'historique en entrée structurée", () => {
  const entry = normalizeMatchHistoryCard({
    textLines: [
      "The Dredge",
      "Score",
      "32,411",
      "Merciless Killer",
      "18,724",
      "17,890",
      "5,587",
      "12,773",
      "Sep 17, 8:11 PM",
      "Midwich Elementary School",
      "9:01"
    ],
    characterImageUrl: "https://images.example/dredge.png",
    loadoutIconUrls: ["perk-1", "perk-2", "perk-3", "perk-4", "power", "addon"],
    participantImageUrls: ["survivor-1", "survivor-2", "survivor-3", "survivor-4"],
    mapImageUrl: "https://images.example/midwich.jpg"
  }, "https://stats.deadbydaylight.com/match-history/", new Date("2026-09-17T20:30:00.000Z"));

  assert.equal(entry?.role, "killer");
  assert.equal(entry?.characterName, "The Dredge");
  assert.equal(entry?.resultLabel, "Merciless Killer");
  assert.equal(entry?.score, 32411);
  assert.equal(entry?.playedAtLabel, "Sep 17, 8:11 PM");
  assert.equal(entry?.durationLabel, "9:01");
  assert.equal(entry?.mapName, "Midwich Elementary School");
  assert.deepEqual(entry?.perkIconUrls, ["perk-1", "perk-2", "perk-3", "perk-4"]);
  assert.deepEqual(entry?.equipmentIconUrls, ["power", "addon"]);
  assert.deepEqual(entry?.participants.map((participant) => participant.score), [18724, 17890, 5587, 12773]);
  assert.deepEqual(entry?.participants.map((participant) => participant.valueLabel), ["18,724", "17,890", "5,587", "12,773"]);
  assert.match(entry?.id ?? "", /^[a-f0-9]{40}$/);
});

test("normalise une carte survivant 2v8 et extrait la file", () => {
  const entry = normalizeMatchHistoryCard({
    textLines: [
      "Jake Park",
      "Score",
      "32,249",
      "Escaped",
      "20,895",
      "23,395",
      "21,072",
      "11,296",
      "20,713",
      "20,824",
      "30,244",
      "34,714",
      "35,133",
      "2v8",
      "Sep 17, 1:00 AM",
      "Mount Ormond Resort",
      "10:20"
    ],
    characterImageUrl: "https://images.example/jake.png",
    loadoutIconUrls: ["perk-1", "perk-2", "perk-3", "perk-4", "item", "addon-1", "addon-2"],
    participantImageUrls: ["p-1", "p-2", "p-3", "p-4", "p-5", "p-6", "p-7", "p-8", "p-9"],
    mapImageUrl: "https://images.example/ormond.jpg"
  }, "https://stats.deadbydaylight.com/match-history/", new Date("2026-09-17T09:00:00.000Z"));

  assert.equal(entry?.role, "survivor");
  assert.equal(entry?.queueLabel, "2v8");
  assert.equal(entry?.mapName, "Mount Ormond Resort");
  assert.equal(entry?.participants.length, 9);
  assert.deepEqual(entry?.participants.slice(0, 3).map((participant) => participant.score), [20895, 23395, 21072]);
  assert.deepEqual(entry?.participants.slice(0, 3).map((participant) => participant.valueLabel), ["20,895", "23,395", "21,072"]);
});

test("convertit une date d'historique sans année en ISO cohérent", () => {
  assert.equal(parseMatchDateLabel("Sep 17, 8:11 PM", new Date("2026-09-17T20:30:00.000Z")), "2026-09-17T20:11:00.000Z");
});

test("extrait correctement les cartes depuis le HTML complet de match-history", async () => {
  const html = await readFile(resolveFixture("../html_history_match_example.txt"), "utf8");
  const entries = extractMatchHistoryEntriesFromHtml(html, "https://stats.deadbydaylight.com/match-history/", new Date("2026-09-17T21:00:00.000Z"));

  assert.equal(entries.length, 30);
  assert.equal(entries[0]?.characterName, "The Dredge");
  assert.equal(entries[0]?.resultLabel, "Merciless Killer");
  assert.equal(entries[0]?.mapName, "Midwich Elementary School");
  assert.equal(entries[0]?.participants.length, 4);
  assert.equal(entries.some((entry) => entry.role === "survivor" && entry.queueLabel === "2v8"), true);
  assert.equal(entries.some((entry) => entry.characterName === "Jake Park"), true);

  const jakePark = entries.find((entry) => entry.characterName === "Jake Park");
  assert.equal(jakePark?.participants.length, 9);
  assert.deepEqual(jakePark?.equipmentIconLabels, ["Guide"]);
  assert.equal(jakePark?.participants.filter((participant) => participant.imageUrl?.includes("characters/survivors/S43.png")).length, 3);
  assert.equal(jakePark?.participants.some((participant) => participant.resultLabel === "Escaped"), true);
  assert.equal(jakePark?.participants.some((participant) => participant.resultLabel === "Sacrificed"), true);
  assert.equal(jakePark?.participants.some((participant) => participant.name === "Thalita Lyra"), true);
});

function resolveFixture(relativePath) {
  return new URL(relativePath, import.meta.url);
}

test("n'importe pas une carte encore incomplète pendant le chargement", () => {
  const partial = `<button data-cy="survivor-match-card-btn"><span class="font-sans text-left text-md font-bold text-neutral-text-xlight">Jake Park</span><span>Score</span><span>17,088</span><span data-cy="match-date">Sep 18, 2:07 AM</span><span data-cy="match-duration">7:57</span></button>`;
  const url = "https://stats.deadbydaylight.com/match-history/";
  assert.deepEqual(extractMatchHistoryEntriesFromHtml(partial, url), []);
  const complete = partial.replace("</button>", '<span data-cy="match-map">Gas Heaven</span></button>');
  assert.equal(extractMatchHistoryEntriesFromHtml(complete, url).length, 1);
});

test("extrait l'équipement du participant sans inclure portraits et résultats", () => {
  const base = "https://assets.live.bhvraccount.com/";
  const assets = ["characters/survivors/Dwight.png", "perks/Bond.png", "perks/ProveThyself.png", "items/Medkit.png", "add-ons/Bandages.png", "offerings/Cake.png", "characterClasses/Medic.png", "stats/VE_Escaped.png"];
  const labels = ["Dwight", "Bond", "Prove Thyself", "Med-Kit", "Bandages", "Cake", "Guide", "Escaped"];
  const html = assets.map((path, index) => `<img src="${base}${path}" alt="${labels[index]}" title="${labels[index]}">`).join("");
  assert.deepEqual(extractParticipantLoadoutFromHtml(html), {
    perkIconUrls: assets.slice(1, 3).map(path => base + path),
    perkIconLabels: labels.slice(1, 3),
    equipmentIconUrls: assets.slice(3, 7).map(path => base + path),
    equipmentIconLabels: labels.slice(3, 7),
  });
});

test("l'identité reste stable après enrichissement et distingue les années", async () => {
  const html = await readFile(resolveFixture("../html_history_match_example.txt"), "utf8");
  const [entry] = extractMatchHistoryEntriesFromHtml(html, "https://stats.deadbydaylight.com/match-history/", new Date("2026-09-17T21:00:00Z"));
  assert.equal(buildMatchHistoryEntryId({ ...entry, participants: entry.participants.map(p => ({ ...p, survivalTimeLabel: "9:01", name: "Dwight" })) }), entry.id);
  assert.notEqual(buildMatchHistoryEntryId({ ...entry, playedAt: "2025-09-17T20:11:00.000Z" }), entry.id);
});
