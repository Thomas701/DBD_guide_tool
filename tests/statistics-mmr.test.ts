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

test("sépare les modes survivant et applique une majorité stricte", () => {
  const oneVsFour = match("one", "2026-01-01T00:00:00.000Z", "survivor", "Meg Thomas", [survivor(20), survivor(30), survivor(40)], 10);
  const twoVsEight = { ...match("two", "2026-01-02T00:00:00.000Z", "survivor", "Jake Park", [survivor(10), survivor(20), survivor(30)], 20), queueLabel: "2v8" };
  const events = calculateMmrHistory([oneVsFour, twoVsEight]);

  assert.deepEqual(events.map(({ mode, delta, after }) => ({ mode, delta, after })), [
    { mode: "1v4-survivor", delta: -9, after: 591 },
    { mode: "2v8-survivor", delta: 0, after: 600 },
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
