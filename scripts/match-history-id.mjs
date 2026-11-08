import { createHash } from "node:crypto";

// Only immutable card fields: participant details must not change a match's identity.
export function buildMatchHistoryEntryId(entry) {
  return createHash("sha1").update(JSON.stringify({
    role: entry.role,
    characterName: entry.characterName,
    score: entry.score,
    playedAt: entry.playedAt ?? entry.playedAtLabel,
    durationLabel: entry.durationLabel,
    // A newly detected modifier must keep the identity of its previously imported 1v4 card.
    queueLabel: entry.queueLabel === "2v8" ? "2v8" : "1v4",
    mapName: entry.mapName,
  })).digest("hex");
}
