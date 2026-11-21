export function matchHistoryIdentity(entry) {
  return JSON.stringify({
    role: entry.role,
    characterName: entry.characterName,
    score: entry.score,
    playedAt: entry.playedAt ?? entry.playedAtLabel,
    durationLabel: entry.durationLabel,
    queueLabel: entry.queueLabel === "2v8" ? "2v8" : "1v4",
    mapName: entry.mapName,
  });
}
