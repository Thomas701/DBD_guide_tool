import { createHash } from "node:crypto";

// Only immutable card fields: participant details must not change a match's identity.
export function buildMatchHistoryEntryId(entry) {
  return createHash("sha1").update(JSON.stringify({
    role: entry.role,
    characterName: entry.characterName,
    score: entry.score,
    playedAt: entry.playedAt ?? entry.playedAtLabel,
    durationLabel: entry.durationLabel,
    queueLabel: entry.queueLabel ?? "1v4",
    mapName: entry.mapName,
  })).digest("hex");
}
