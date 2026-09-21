import type { MatchHistoryEntry } from "./statistics.js";

export const INITIAL_MMR = 600;

export type MmrMode = "1v4-survivor" | "2v8-survivor" | "1v4-killer" | "2v8-killer";

export interface MmrEvent {
  matchId: string;
  mode: MmrMode;
  killerName: string | null;
  at: string;
  delta: number;
  before: number;
  after: number;
  reason: string;
}

export function calculateMmrHistory(matches: readonly MatchHistoryEntry[]): MmrEvent[] {
  const ratings = new Map<string, number>();
  return matches
    .map((match, index) => ({ match, index, at: match.playedAt ?? match.importedAt }))
    .filter(({ match }) => match.role !== "unknown")
    .sort((left, right) => left.at.localeCompare(right.at) || left.index - right.index)
    .map(({ match, at }) => {
      const mode = mmrModeForMatch(match);
      const killerName = match.role === "killer" ? match.characterName : null;
      const key = killerName ? `${mode}:${killerName.toLocaleLowerCase("fr")}` : mode;
      const before = ratings.get(key) ?? INITIAL_MMR;
      const { delta, reason } = mmrChange(match);
      const after = before + delta;
      ratings.set(key, after);
      return { matchId: match.id, mode, killerName, at, delta, before, after, reason };
    });
}

export function mmrModeForMatch(match: MatchHistoryEntry): MmrMode {
  const queue = match.queueLabel === "2v8" ? "2v8" : "1v4";
  return `${queue}-${match.role === "killer" ? "killer" : "survivor"}`;
}

function mmrChange(match: MatchHistoryEntry): { delta: number; reason: string } {
  if (match.role === "killer") {
    const deaths = match.participants.filter((participant) => participant.role === "survivor" && isDead(participant.resultLabel)).length;
    const delta = deaths >= 3 ? 9 : deaths === 2 ? 0 : -9;
    return { delta, reason: `${deaths} mort${deaths > 1 ? "s" : ""}` };
  }

  const peers = match.participants.filter((participant) => participant.role === "survivor" && participant.score !== null);
  if (match.score === null || peers.length === 0) return { delta: 0, reason: "Comparaison impossible" };
  const lower = peers.filter((participant) => (participant.score ?? 0) < match.score!).length;
  const higher = peers.filter((participant) => (participant.score ?? 0) > match.score!).length;
  if (lower > peers.length / 2) return { delta: 9, reason: `Score supérieur à ${lower}/${peers.length} survivants` };
  if (higher > peers.length / 2) return { delta: -9, reason: `Score inférieur à ${higher}/${peers.length} survivants` };
  return { delta: 0, reason: "Score dans la médiane" };
}

export function isMvpMatch(match: MatchHistoryEntry): boolean {
  if (match.role === "killer") {
    const survivors = match.participants.filter((participant) => participant.role === "survivor");
    return survivors.length >= 4 && survivors.every((participant) => isDead(participant.resultLabel));
  }
  if (match.role !== "survivor" || match.score === null) return false;
  const otherScores = match.participants
    .filter((participant) => participant.role === "survivor" && participant.score !== null)
    .map((participant) => participant.score!);
  return otherScores.length > 0 && otherScores.every((score) => match.score! >= score);
}

function isDead(label: string | null): boolean {
  return Boolean(label && /dead|killed|sacrificed|mori|disconnected/i.test(label));
}
