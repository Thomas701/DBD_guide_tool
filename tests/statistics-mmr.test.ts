import assert from "node:assert/strict";
import test from "node:test";

import { calculateMmrHistory, isMvpMatch } from "../src/services/statistics-mmr.js";
import type { MatchHistoryEntry, MatchHistoryParticipant } from "../src/services/statistics.js";

test("calcule le MMR chronologiquement et sépare chaque tueur", () => {
  const events = calculateMmrHistory([
    match("nurse-2", "2026-01-04T00:00:00.000Z", "killer", "The Nurse", [dead(), dead()]),
    match("survivor-win", "2026-01-01T00:00:00.000Z", "survivor", "Jake Park", [survivor(10), survivor(20), survivor(40)], 30),
    match("dredge", "2026-01-03T00:00:00.000Z", "killer", "The Dredge", [dead(), dead(), dead(), dead()]),
    match("nurse-1", "2026-01-02T00:00:00.000Z", "killer", "The Nurse", [dead()]),
  ]);

  assert.deepEqual(events.map(({ matchId, before, delta, after }) => ({ matchId, before, delta, after })), [
    { matchId: "survivor-win", before: 600, delta: 9, after: 609 },
    { matchId: "nurse-1", before: 600, delta: -9, after: 591 },
    { matchId: "dredge", before: 600, delta: 9, after: 609 },
    { matchId: "nurse-2", before: 591, delta: 0, after: 591 },
  ]);
});

test("identifie les MVP survivant et tueur", () => {
  assert.equal(isMvpMatch(match("survivor-mvp", "2026-01-01T00:00:00.000Z", "survivor", "Jake Park", [survivor(10), survivor(20), survivor(30)], 40)), true);
  assert.equal(isMvpMatch(match("survivor-not-mvp", "2026-01-01T00:00:00.000Z", "survivor", "Jake Park", [survivor(50)], 40)), false);
  assert.equal(isMvpMatch(match("killer-mvp", "2026-01-01T00:00:00.000Z", "killer", "The Nurse", [dead(), dead(), dead(), dead()])), true);
  assert.equal(isMvpMatch(match("killer-not-mvp", "2026-01-01T00:00:00.000Z", "killer", "The Nurse", [dead(), dead(), dead(), survivor(20)])), false);
});

test("le MMR tueur attend les résultats manquants quand ils peuvent changer le verdict", () => {
  const unknown = { ...survivor(9000), resultLabel: null };
  const nurse = match("nurse", "2026-11-26T15:30:00.000Z", "killer", "The Nurse", [dead(), dead(), unknown, unknown]);
  const corrected = { ...nurse, participants: [
    dead(), dead(), { ...unknown, resultLabel: "Surrendered" }, { ...unknown, resultLabel: "Disconnected" },
  ] };
  assert.equal(calculateMmrHistory([nurse])[0]?.reason, "Résultats survivants incomplets");
  assert.equal(calculateMmrHistory([{ ...nurse, participants: [dead(), unknown, unknown, survivor(100)] }])[0]?.delta, 0);
  assert.equal(calculateMmrHistory([corrected])[0]?.delta, 9);
});

test("le MMR réglé après un match recale le passé et les nouvelles parties prolongent la série", () => {
  const win = match("a", "2026-01-01T00:00:00.000Z", "killer", "The Nurse", [dead(), dead(), dead()]);
  const anchor = { ...win, id: "b" };
  const next = { ...win, id: "c", participants: [dead()] };
  const otherKiller = { ...win, id: "d", characterName: "The Trapper" };
  const adjustments = { "1v4-killer:the nurse": { matchId: anchor.id, at: anchor.importedAt, rating: 800 } };
  assert.deepEqual(calculateMmrHistory([next, otherKiller, anchor, win], adjustments)
    .map(({ matchId, before, delta, after }) => [matchId, before, delta, after]), [
    ["a", 782, 9, 791], ["b", 791, 9, 800], ["c", 800, -9, 791], ["d", 600, 9, 609],
  ]);
  assert.equal(calculateMmrHistory([next, win], adjustments)[0]?.before, 791);
});

test("sépare les modes survivant et applique une majorité stricte", () => {
  const oneVsFour = match("one", "2026-01-01T00:00:00.000Z", "survivor", "Meg Thomas", [survivor(20), survivor(30), survivor(40)], 10);
  const twoVsEight = { ...match("two", "2026-01-02T00:00:00.000Z", "survivor", "Jake Park", [survivor(10), survivor(20), survivor(30)], 20), queueLabel: "2v8" };
  const events = calculateMmrHistory([oneVsFour, twoVsEight]);

  assert.deepEqual(events.map(({ mode, delta, after }) => ({ mode, delta, after })), [
    { mode: "1v4-survivor", delta: -9, after: 591 },
    { mode: "2v8-survivor", delta: 0, after: 600 },
  ]);
});

test("un mode spécial ne modifie jamais les séries MMR normales", () => {
  const normal = match("normal", "2026-11-07T00:00:00.000Z", "killer", "The Dredge", [dead(), dead(), dead(), dead()]);
  const special = { ...normal, id: "lights-out", playedAt: "2026-11-07T01:00:00.000Z", queueLabel: "Lights Out" };
  const unknownMode = { ...normal, id: "future-mode", queueLabel: "Autre mode" };
  const legacy = { ...normal, id: "legacy", resultLabel: "Lights Out Merciless Killer" };
  const next = { ...normal, id: "next", playedAt: "2026-11-07T02:00:00.000Z" };
  assert.deepEqual(calculateMmrHistory([normal, special, unknownMode, legacy, next]).map(event => [event.matchId, event.before, event.after]), [
    ["normal", 600, 609], ["legacy", 600, 609], ["lights-out", 609, 618], ["next", 609, 618],
  ]);
});

test("Lights Out utilise les mêmes gains survivant dans un classement séparé", () => {
  const normal = match("normal-survivor", "2026-11-07T00:00:00.000Z", "survivor", "Jake Park", [survivor(10), survivor(20), survivor(30)], 40);
  const lights = { ...normal, id: "lights-win", queueLabel: "Lights Out", playedAt: "2026-11-07T01:00:00.000Z" };
  const loss = { ...lights, id: "lights-loss", score: 0, playedAt: "2026-11-07T02:00:00.000Z" };
  const events = calculateMmrHistory([normal, lights, loss]);
  assert.deepEqual(events.map(event => [event.mode, event.delta, event.before, event.after]), [
    ["1v4-survivor", 9, 600, 609], ["lights-out-survivor", 9, 600, 609], ["lights-out-survivor", -9, 609, 600],
  ]);
});

function match(id: string, playedAt: string, role: "killer" | "survivor", characterName: string, participants: MatchHistoryParticipant[], score: number | null = 20_000): MatchHistoryEntry {
  return {
    id,
    role,
    characterName,
    resultLabel: null,
    score,
    characterImageUrl: null,
    perkIconUrls: [],
    perkIconLabels: [],
    equipmentIconUrls: [],
    equipmentIconLabels: [],
    participants,
    mapName: null,
    mapImageUrl: null,
    playedAt,
    playedAtLabel: null,
    durationLabel: null,
    queueLabel: null,
    sourceUrl: "https://stats.deadbydaylight.com/match-history/",
    importedAt: playedAt,
  };
}

function survivor(score: number): MatchHistoryParticipant {
  return { name: null, role: "survivor", imageUrl: null, score, valueLabel: null, survivalTimeLabel: null, resultLabel: "Escaped" };
}

function dead(): MatchHistoryParticipant {
  return { ...survivor(10_000), resultLabel: "Sacrificed" };
}
