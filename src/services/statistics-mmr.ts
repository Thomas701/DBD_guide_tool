import type { MatchHistoryEntry } from "./statistics.js";

export const INITIAL_MMR = 600;

export type MmrMode = "1v4-survivor" | "2v8-survivor" | "1v4-killer" | "2v8-killer" | "lights-out-survivor" | "lights-out-killer";

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

export type MmrAdjustments = Record<string, { matchId: string; at: string; rating: number }>;

function mmrSeriesKey(mode: MmrMode, killerName: string | null): string {
  return killerName ? `${mode}:${killerName.toLowerCase()}` : mode;
}

export function calculateMmrHistory(matches: readonly MatchHistoryEntry[], adjustments: MmrAdjustments = {}): MmrEvent[] {
  const ratings = new Map<string, number>();
  const offsets = new Map<string, number>();
  const hasAdjustments = Object.keys(adjustments).length > 0;
  const events = matches
    .map(match => ({ match, at: match.playedAt ?? match.importedAt }))
    .filter(({ match }) => match.role !== "unknown" && mmrModeForMatch(match) !== null)
    .sort((left, right) => left.at.localeCompare(right.at) || (hasAdjustments ? compareMatchIds(left.match.id, right.match.id) : 0))
    .map(({ match, at }) => {
      const mode = mmrModeForMatch(match)!;
      const killerName = match.role === "killer" ? match.characterName : null;
      const key = mmrSeriesKey(mode, killerName);
      const before = ratings.get(key) ?? INITIAL_MMR;
      const { delta, reason } = mmrChange(match);
      const after = before + delta;
      ratings.set(key, after);
      const anchor = adjustments[key];
      if (anchor) {
        if (!offsets.has(key)) offsets.set(key, anchor.rating - INITIAL_MMR);
        if (at < anchor.at || (at === anchor.at && match.id <= anchor.matchId)) offsets.set(key, anchor.rating - after);
      }
      return { matchId: match.id, mode, killerName, at, delta, before, after, reason };
    });
  if (!offsets.size) return events;
  return events.map(event => {
    const offset = offsets.get(mmrSeriesKey(event.mode, event.killerName)) ?? 0;
    return { ...event, before: event.before + offset, after: event.after + offset };
  });
}

function compareMatchIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function mmrModeForMatch(match: MatchHistoryEntry): MmrMode | null {
  const lightsOut = /^lights?\s*out$/i.test(match.queueLabel ?? "") || /\bLights Out\b/i.test(match.resultLabel ?? "");
  if (match.queueLabel && !["1v4", "2v8"].includes(match.queueLabel) && !lightsOut) return null;
  const queue = lightsOut ? "lights-out" : match.queueLabel === "2v8" ? "2v8" : "1v4";
  return `${queue}-${match.role === "killer" ? "killer" : "survivor"}`;
}

function mmrChange(match: MatchHistoryEntry): { delta: number; reason: string } {
  if (match.role === "killer") {
    const deaths = match.participants.filter((participant) => participant.role === "survivor" && isDead(participant.resultLabel)).length;
    const delta = deaths >= 3 ? 9 : deaths === 2 ? 0 : -9;
    return { delta, reason: `${deaths} kill${deaths > 1 ? "s" : ""}` };
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
