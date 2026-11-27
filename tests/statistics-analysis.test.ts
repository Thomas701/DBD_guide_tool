import assert from "node:assert/strict";
import test from "node:test";

import { analyzeMatches, assetKey, durationSeconds, encounterCounts, groupMatches, matchesForBuild, observedKillRate, summarizeMatches, summarizeObservedSurvival } from "../src/services/statistics-analysis.js";
import type { Perk } from "../src/domain/perk.js";
import type { MatchHistoryEntry, MatchHistoryParticipant } from "../src/services/statistics.js";

test("retrouve uniquement le build exact, son camp et son personnage dans l’historique", () => {
  const perks = [
    { id: "survivor-bond", side: "survivor", name: { fr: "Lien", en: "Bond" }, icon: "images/perks/bond.png" },
    { id: "survivor-deja-vu", side: "survivor", name: { fr: "Déjà-vu", en: "Deja Vu" }, icon: "images/perks/dejavu.png" },
  ] as Perk[];
  const base = survivorMatch("exact", "2026-11-04T18:00:00Z", "Escaped", "9:00", [], ["Bond", "Deja_Vu"]);
  const entries = [base, { ...base, id: "reordered", perkIconUrls: [...base.perkIconUrls].reverse(), perkIconLabels: ["Déjà vu", "Lien"] },
    { ...base, id: "extra", perkIconUrls: [...base.perkIconUrls, "https://assets.test/perks/Hope.png"] },
    { ...base, id: "wrong-perk", perkIconLabels: ["Bond", "Hope"], perkIconUrls: [base.perkIconUrls[0]!, "https://assets.test/perks/Hope.png"] },
    { ...base, id: "wrong-character", characterName: "Jake Park" }, { ...base, id: "wrong-side", role: "killer" as const },
    { ...base, id: "class-not-build", queueLabel: "2v8" }, { ...base, id: "modifier", queueLabel: "Lights Out" }];
  const matches = analyzeMatches(entries);
  assert.deepEqual(matchesForBuild(matches, "survivor", [base.characterName], perks).map(match => match.entry.id).sort(), ["exact", "modifier", "reordered"]);
  assert.deepEqual(matchesForBuild(matches, "survivor", [base.characterName], []), []);
  assert.deepEqual(matchesForBuild(matches, "survivor", [base.characterName], [perks[0]!, perks[0]!]), []);
  const partial = analyzeMatches([{ ...base, id: "partial", perkIconUrls: [base.perkIconUrls[0]!], perkIconLabels: ["Bond"] }]);
  assert.equal(matchesForBuild(partial, "survivor", [base.characterName], [perks[0]!]).length, 1, "un build incomplet doit aussi correspondre exactement");
});

test("analyse des résultats complets sans confondre temps de match et temps de survie", () => {
  const matches = analyzeMatches([
    killerMatch("killer-four", "2026-11-02T18:00:00.000Z", [dead("5:00"), dead("6:00"), dead("7:00"), dead("8:00")]),
    killerMatch("killer-three", "2026-11-03T18:00:00.000Z", [dead("5:00"), dead("6:00"), dead("7:00"), escaped("8:00")]),
    survivorMatch("survivor-escape", "2026-11-04T18:00:00.000Z", "Escaped", "11:00", [dead("5:00", 10_000), escaped("10:00", 20_000), dead("8:00", 30_000)]),
    survivorMatch("survivor-no-duration", "2026-11-05T18:00:00.000Z", "Sacrificed", null, [dead("5:00", 10_000), escaped("10:00", 20_000), dead("8:00", 30_000)]),
  ]);
  const summary = summarizeMatches(matches);

  assert.equal(summary.killRate, 7 / 8);
  assert.equal(summary.averageKills, 3.5);
  assert.equal(summary.perfectRate, .5);
  assert.equal(summary.escapeRate, .5);
  assert.equal(summary.survivalSamples, 1, "la durée du match ne devient pas une durée de survie");
  assert.equal(summary.survival, 660);
  assert.equal(summary.topScoreRate, 1);
  assert.equal(summary.firstDeath, 300);
  assert.equal(summary.deathInterval, 60);
});

test("regroupe un build identique et lit des durées strictes", () => {
  assert.equal(durationSeconds("10:05"), 605);
  assert.equal(durationSeconds("10:75"), null);
  assert.equal(assetKey("https://assets.live.bhvraccount.com/perks/Bond.png"), assetKey("https://stats.deadbydaylight.com/_next/image/?url=https%3A%2F%2Fassets.live.bhvraccount.com%2Fperks%2FBond.png&w=96"));
  const matches = analyzeMatches([
    survivorMatch("one", "2026-11-04T18:00:00.000Z", "Escaped", "9:00", [], ["Sprint Burst", "Kindred", "Bond", "Hope"]),
    survivorMatch("two", "2026-11-05T18:00:00.000Z", "Sacrificed", "8:00", [], ["Hope", "Bond", "Kindred", "Sprint Burst"]),
  ]);
  const builds = groupMatches(matches, "build");
  assert.equal(builds.length, 1);
  assert.equal(builds[0]?.summary.count, 2);
});

test("exclut les déconnexions et les équipes incomplètes des taux tueur", () => {
  const disconnected = { ...dead("5:00"), resultLabel: "Disconnected" };
  const [incomplete, disconnect, twoVsEight] = analyzeMatches([
    killerMatch("incomplete", "2026-11-02T18:00:00.000Z", [dead("5:00")]),
    killerMatch("disconnect", "2026-11-03T18:00:00.000Z", [dead("5:00"), dead("6:00"), escaped("7:00"), disconnected]),
    { ...killerMatch("2v8", "2026-11-04T18:00:00.000Z", [...Array.from({ length: 6 }, () => dead("5:00")), escaped("8:00"), escaped("9:00")]), queueLabel: "2v8" },
  ]);
  assert.equal(incomplete?.killRate, null);
  assert.equal(disconnect?.killRate, null);
  assert.equal(twoVsEight?.killRate, .75);
  const summary = summarizeMatches([incomplete!, disconnect!, twoVsEight!]);
  assert.equal(summary.killSamples, 8);
  assert.equal(summary.winSamples, 0, "3K+ est réservé au 1v4");
  assert.equal(summary.disconnectedPlayers, 1);
  assert.equal(summary.killDistribution[6], 1);
});

test("ne confond pas équipement inconnu et aucun objet ; compte chaque match une fois par compétence", () => {
  const base = killerMatch("missing-item", "2026-11-02T18:00:00.000Z", [dead("5:00"), dead("6:00"), dead("7:00"), dead("8:00")]);
  const missing = analyzeMatches([base]);
  assert.equal(groupMatches(missing, "composition").length, 0);
  const populated = analyzeMatches([{ ...base, participants: base.participants.map(p => ({ ...p, equipmentIconUrls: [], perkIconUrls: ["https://assets.live.bhvraccount.com/perks/Bond.png"], perkIconLabels: ["Bond"] })) }]);
  assert.equal(groupMatches(populated, "composition")[0]?.label, "Aucun objet");
  assert.equal(groupMatches(populated, "enemyPerk")[0]?.summary.count, 1);
});

test("les survies observées restent disponibles sans inventer une durée personnelle", () => {
  const entries = analyzeMatches([survivorMatch("observations", "2026-11-02T18:00:00.000Z", "Escaped", null, [dead("4:00"), escaped("9:00"), { ...dead("5:00"), survivalTimeLabel: null }])]);
  assert.equal(summarizeMatches(entries).survivalSamples, 0);
  const observed = summarizeObservedSurvival(entries);
  assert.equal(observed.count, 2);
  assert.equal(observed.average, 390);
  assert.deepEqual(observed.distribution, [1, 1, 0, 0]);
});

test("les séries dépassent vingt matchs et les 3K normaux excluent les modes spéciaux", () => {
  const entries = Array.from({ length: 30 }, (_, index) => survivorMatch(`escape-${index}`, `2026-11-${String(1 + Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00.000Z`, "Escaped", null, []));
  assert.equal(summarizeMatches(analyzeMatches(entries)).streaks.escape.best, 30);
  const special = { ...killerMatch("special", "2026-11-07T18:00:00.000Z", [dead("5:00"), dead("6:00"), dead("7:00"), dead("8:00")]), queueLabel: "Lights Out" };
  const result = summarizeMatches(analyzeMatches([special]));
  assert.equal(result.winSamples, 1);
  assert.equal(result.streaks.three.best, 0);
});

test("distingue victoires, matchs nuls, défaites et victoires groupées", () => {
  const killers = [0, 1, 2, 2, 3, 4].map((kills, index) => killerMatch(`killer-${index}`, `2026-11-0${index + 1}T18:00:00.000Z`, Array.from({ length: 4 }, (_, survivorIndex) => survivorIndex < kills ? dead("8:00") : escaped("9:00"))));
  const survivors = [true, true, false].map((escapedAll, index) => survivorMatch(`team-${index}`, `2026-11-0${index + 1}T19:00:00.000Z`, escapedAll ? "Escaped" : "Sacrificed", "9:00", [escaped("9:00"), escaped("9:00"), escaped("9:00")]));
  const result = summarizeMatches(analyzeMatches([...killers, ...survivors]));
  assert.deepEqual(result.streaks.killerLoss, { current: 0, best: 2 });
  assert.deepEqual(result.streaks.killerDraw, { current: 0, best: 2 });
  assert.deepEqual(result.streaks.killerWin, { current: 2, best: 2 });
  assert.deepEqual(result.streaks.groupEscape, { current: 0, best: 2 });
});

test("compte les personnages rencontrés par participant et conserve les icônes de build", () => {
  const sameCharacter = { ...dead("5:00"), name: "Jake Park", perkIconUrls: ["https://assets.live.bhvraccount.com/perks/Bond.png"], perkIconLabels: ["Bond"] };
  const entries = analyzeMatches([killerMatch("meeting", "2026-11-07T18:00:00.000Z", [sameCharacter, sameCharacter, escaped("8:00"), escaped("9:00")])]);
  assert.equal(encounterCounts(entries, "survivor").find(row => row.asset.label === "Jake Park")?.count, 2);
  assert.equal(encounterCounts(entries, "perk")[0]?.count, 2);
  assert.equal(observedKillRate(entries), .5);
  const builds = groupMatches(analyzeMatches([survivorMatch("build", "2026-11-07T19:00:00.000Z", "Escaped", null, [])]), "build");
  assert.equal(builds[0]?.assets?.length, 4);
  assert.ok(builds[0]?.assets?.every(asset => asset.image));
});

test("classe les coéquipiers par compte et compte chaque partie partagée une seule fois", () => {
  const alice = { ...escaped("8:00"), communityPlayer: { user_id: "alice", nickname: "Même pseudo" } };
  const bob = { ...dead("5:00"), communityPlayer: { user_id: "bob", nickname: "Même pseudo" } };
  const opponent = { ...alice, role: "killer" as const, communityPlayer: { user_id: "opponent", nickname: "Adversaire" } };
  const self = { ...alice, communityPlayer: { user_id: "self", nickname: "Moi" } };
  const win = survivorMatch("win", "2026-11-01T19:00:00.000Z", "Escaped", null, [alice, alice, opponent, self]);
  win.communityPlayer = self.communityPlayer;
  const loss = survivorMatch("loss", "2026-11-02T19:00:00.000Z", "Sacrificed", null, [alice, bob, escaped("9:00")]);
  const unknown = survivorMatch("unknown", "2026-11-03T19:00:00.000Z", "Unknown", null, [alice]);
  const killer = killerMatch("killer", "2026-11-04T19:00:00.000Z", [alice]);

  const rows = groupMatches(analyzeMatches([win, loss, unknown, killer]), "teammate");
  assert.deepEqual(rows.map(({ key, summary }) => [key, summary.count, summary.escapeRate]), [
    ["alice", 3, .5],
    ["bob", 1, 0],
  ]);
});

test("complète les anciens noms de compétences à partir des libellés déjà archivés", () => {
  const old = survivorMatch("old-label", "2026-11-01T19:00:00.000Z", "Escaped", null, [], ["S40P01"]);
  old.perkIconLabels = [null];
  const labeled = { ...dead("5:00"), perkIconUrls: old.perkIconUrls, perkIconLabels: ["Champion of Light"] };
  const recent = killerMatch("recent-label", "2026-11-07T19:00:00.000Z", [labeled]);
  const result = analyzeMatches([old, recent]);
  assert.equal(result[0]?.perks[0]?.label, "Champion of Light");
  assert.deepEqual(old.perkIconLabels, [null], "l’archive d’entrée n’est pas modifiée");
});

function killerMatch(id: string, playedAt: string, participants: MatchHistoryParticipant[]): MatchHistoryEntry {
  return match({ id, playedAt, role: "killer", characterName: "The Nurse", participants, resultLabel: "Merciless Killer", score: 25_000 });
}

function survivorMatch(id: string, playedAt: string, resultLabel: string, survivalTimeLabel: string | null, participants: MatchHistoryParticipant[], perks = ["Sprint Burst", "Kindred", "Bond", "Hope"]): MatchHistoryEntry {
  return match({ id, playedAt, role: "survivor", characterName: "Meg Thomas", participants, resultLabel, survivalTimeLabel, score: 40_000, perks });
}

function match({ id, playedAt, role, characterName, participants, resultLabel, score, survivalTimeLabel = null, perks = [] }: { id: string; playedAt: string; role: "killer" | "survivor"; characterName: string; participants: MatchHistoryParticipant[]; resultLabel: string; score: number; survivalTimeLabel?: string | null; perks?: string[] }): MatchHistoryEntry {
  return {
    id, role, characterName, resultLabel, score, survivalTimeLabel,
    characterImageUrl: null,
    perkIconUrls: perks.map(label => `https://assets.live.bhvraccount.com/perks/${label.replace(/ /g, "")}.png`),
    perkIconLabels: perks,
    equipmentIconUrls: [], equipmentIconLabels: [], participants,
    mapName: "The Game", mapImageUrl: null, playedAt, playedAtLabel: null,
    durationLabel: "12:00", queueLabel: null, sourceUrl: "https://stats.deadbydaylight.com/match-history/", importedAt: playedAt,
  };
}

function escaped(time: string, score = 20_000): MatchHistoryParticipant { return participant("Escaped", time, score); }
function dead(time: string, score = 20_000): MatchHistoryParticipant { return participant("Sacrificed", time, score); }
function participant(resultLabel: string, survivalTimeLabel: string, score: number): MatchHistoryParticipant { return { name: null, role: "survivor", imageUrl: null, score, valueLabel: null, survivalTimeLabel, resultLabel }; }
