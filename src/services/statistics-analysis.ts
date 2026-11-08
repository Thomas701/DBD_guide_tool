import type { MatchHistoryEntry, MatchHistoryParticipant } from "./statistics.js";
import type { Perk } from "../domain/perk.js";

const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const hourFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" });
const weekdayFormatter = new Intl.DateTimeFormat("fr", { weekday: "long", timeZone: "Europe/Paris" });

export type Outcome = "escaped" | "dead" | "disconnected" | "unknown";
export type AnalysisDimension = "character" | "map" | "opponent" | "matchup" | "build" | "perk" | "pair" | "trio" | "item" | "addon" | "addonPair" | "offering" | "class" | "enemyPerk" | "teamPerk" | "composition" | "duplicates" | "equipment" | "disconnect" | "weekday" | "hour" | "session" | "result";
export interface AnalysisAsset { key: string; label: string; image: string | null; assets?: readonly AnalysisAsset[] }
export interface AnalyzedMatch {
  entry: MatchHistoryEntry;
  at: number | null;
  duration: number | null;
  outcome: Outcome;
  survivors: MatchHistoryParticipant[];
  complete: boolean;
  deaths: number;
  escapes: number;
  knownOutcomes: number;
  killRate: number | null;
  survival: number | null;
  scoreRank: number | null;
  scoreGap: number | null;
  lastScore: boolean | null;
  deathRank: number | null;
  lastAlive: boolean | null;
  firstDeath: number | null;
  deathInterval: number | null;
  perks: AnalysisAsset[];
  equipment: AnalysisAsset[];
  build: AnalysisAsset | null;
  opponents: AnalysisAsset[];
  sessionIndex: number | null;
}
export interface AnalysisSummary {
  count: number; killerCount: number; survivorCount: number;
  escapeRate: number | null; escapeCount: number; escapeSamples: number;
  killRate: number | null; deaths: number; killSamples: number; averageKills: number | null;
  perfectRate: number | null; perfectSamples: number; winRate: number | null; winSamples: number;
  duration: number | null; durationMedian: number | null; totalTime: number; durationSamples: number; shortest: number | null; longest: number | null;
  score: number | null; scoreMedian: number | null; scoreMax: number | null; scoreStd: number | null; scoreSamples: number; scorePerMinute: number | null; scoreTotal: number;
  survival: number | null; survivalMedian: number | null; survivalMax: number | null; survivalSamples: number;
  escapedSurvival: number | null; deadSurvival: number | null; earlyDeathRate: number | null;
  topScoreRate: number | null; topTwoRate: number | null; lastScoreRate: number | null; topScoreDead: number; rankSamples: number; scoreGap: number | null;
  firstDeadRate: number | null; lastAliveRate: number | null; firstDeath: number | null; deathInterval: number | null;
  teamEscapes: number | null; teamEscapesWhenAlive: number | null; teamEscapesWhenDead: number | null; soleEscapeRate: number | null;
  disconnectedMatches: number; disconnectedPlayers: number;
  streaks: { escape: Streak; death: Streak; groupEscape: Streak; killerWin: Streak; killerLoss: Streak; killerDraw: Streak; three: Streak; perfect: Streak; leak: Streak };
  killDistribution: number[]; escapeDistribution: number[]; survivalDistribution: number[]; deathOrder: number[];
  outcomes: Record<Outcome, number>; roles: Record<MatchHistoryEntry["role"], number>; queues: Record<string, number>;
  characters: number; activeDays: number; firstAt: number | null; lastAt: number | null;
}
interface Streak { current: number; best: number }
export interface AnalysisRow extends AnalysisAsset { matches: AnalyzedMatch[]; summary: AnalysisSummary }

export function durationSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some(part => !/^\d+$/.test(part))) return null;
  if (parts.slice(1).some(part => Number(part) >= 60)) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

export function matchOutcome(value: string | null): Outcome {
  if (!value) return "unknown";
  if (/disconnect/i.test(value)) return "disconnected";
  if (/escaped|évasion|échapp/i.test(value)) return "escaped";
  if (/dead|killed|sacrificed|mori|mort|sacrifi/i.test(value)) return "dead";
  return "unknown";
}

export function assetKey(value: string): string {
  try {
    const url = new URL(value, "https://local.invalid");
    const nested = url.searchParams.get("url");
    return (nested ? new URL(nested, url).pathname : url.pathname).toLowerCase();
  } catch { return value.toLowerCase(); }
}

export function loadoutAssets(urls: readonly string[], labels: readonly (string | null)[] = []): AnalysisAsset[] {
  const unique = new Map<string, AnalysisAsset>();
  urls.forEach((url, index) => {
    const key = assetKey(url);
    const filename = key.split("/").at(-1)?.replace(/\.[^.]*$/, "") ?? "Inconnu";
    unique.set(key, { key, image: url, label: labels[index] ?? filename.replace(/[_-]+/g, " ") });
  });
  return [...unique.values()];
}

export function matchesForBuild(matches: readonly AnalyzedMatch[], side: Perk["side"], characterNames: readonly string[], perks: readonly Perk[]): AnalyzedMatch[] {
  if (!perks.length || perks.length > 4 || new Set(perks.map(perk => perk.id)).size !== perks.length) return [];
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const filename = (value: string) => assetKey(value).split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? "";
  const characters = new Set(characterNames.map(normalize).filter(Boolean));
  const aliases = perks.map(perk => new Set([perk.name.fr, perk.name.en, perk.id, perk.icon ? filename(perk.icon) : null].filter((value): value is string => Boolean(value)).map(normalize)));
  return matches.filter(match => {
    if (match.entry.role !== side || match.entry.queueLabel === "2v8" || !characters.has(normalize(match.entry.characterName)) || match.perks.length !== perks.length) return false;
    const used = new Set<number>();
    for (const asset of match.perks) {
      const index = aliases.findIndex((names, i) => !used.has(i) && (names.has(normalize(asset.label)) || names.has(normalize(filename(asset.key)))));
      if (index < 0) return false;
      used.add(index);
    }
    return true;
  });
}

export function analyzeMatches(entries: readonly MatchHistoryEntry[]): AnalyzedMatch[] {
  const knownLabels = new Map<string, string>();
  for (const entry of entries) {
    for (const player of [entry, ...entry.participants]) {
      for (const [urls, labels] of [[player.perkIconUrls, player.perkIconLabels], [player.equipmentIconUrls, player.equipmentIconLabels]] as const) {
        urls?.forEach((url, index) => { const label = labels?.[index]; if (label) knownLabels.set(assetKey(url), label); });
      }
    }
  }
  const labelsFor = (urls: readonly string[], labels: readonly (string | null)[] | undefined) => urls.map((url, index) => labels?.[index] ?? knownLabels.get(assetKey(url)) ?? null);
  const sorted = [...entries].sort((a, b) => (a.playedAt ?? "").localeCompare(b.playedAt ?? ""));
  let previousEnd: number | null = null;
  let sessionIndex = 0;
  return sorted.map(rawEntry => {
    const entry: MatchHistoryEntry = { ...rawEntry,
      perkIconLabels: labelsFor(rawEntry.perkIconUrls, rawEntry.perkIconLabels),
      equipmentIconLabels: labelsFor(rawEntry.equipmentIconUrls, rawEntry.equipmentIconLabels),
      participants: rawEntry.participants.map(player => ({ ...player,
        perkIconLabels: player.perkIconUrls ? labelsFor(player.perkIconUrls, player.perkIconLabels) : player.perkIconLabels,
        equipmentIconLabels: player.equipmentIconUrls ? labelsFor(player.equipmentIconUrls, player.equipmentIconLabels) : player.equipmentIconLabels,
      })),
    };
    const parsed = entry.playedAt ? Date.parse(entry.playedAt) : NaN;
    const at = Number.isFinite(parsed) ? parsed : null;
    const duration = durationSeconds(entry.durationLabel);
    const self: MatchHistoryParticipant = { name: entry.characterName, role: entry.role, imageUrl: entry.characterImageUrl, score: entry.score, resultLabel: entry.resultLabel, valueLabel: null, survivalTimeLabel: entry.survivalTimeLabel ?? null, equipmentIconUrls: entry.equipmentIconUrls, equipmentIconLabels: entry.equipmentIconLabels };
    const peers = entry.participants.filter(p => p.role === "survivor");
    const survivors = entry.role === "survivor" ? [self, ...peers] : peers;
    const expected = entry.queueLabel === "2v8" ? 8 : 4;
    const outcomes = survivors.map(p => matchOutcome(p.resultLabel));
    const deaths = outcomes.filter(o => o === "dead").length;
    const escapes = outcomes.filter(o => o === "escaped").length;
    const knownOutcomes = deaths + escapes;
    const complete = survivors.length === expected && knownOutcomes === expected;
    const outcome = matchOutcome(entry.resultLabel);
    const timedDeaths = survivors.filter(p => matchOutcome(p.resultLabel) === "dead").map(p => durationSeconds(p.survivalTimeLabel)).filter(validNumber).sort((a, b) => a - b);
    // Only an explicit personal duration measures survival; the match duration cannot replace it.
    const survival = durationSeconds(entry.survivalTimeLabel);
    const timedPeers = peers.map(p => durationSeconds(p.survivalTimeLabel));
    const timesComplete = complete && timedPeers.length === expected - 1 && timedPeers.every(validNumber);
    const scorePeers = peers.map(p => p.score).filter(validNumber);
    const scoresComplete = scorePeers.length === expected - 1 && validNumber(entry.score);
    const perks = loadoutAssets(entry.perkIconUrls, entry.perkIconLabels).sort((a, b) => a.key.localeCompare(b.key));
    const equipment = loadoutAssets(entry.equipmentIconUrls, entry.equipmentIconLabels);
    const build = entry.queueLabel !== "2v8" && perks.length === 4 ? { key: perks.map(p => p.key).join("|"), label: perks.map(p => p.label).join(" · "), image: null, assets: perks } : null;
    if (at !== null) {
      const start = at - (duration ?? 0) * 1000;
      sessionIndex = previousEnd !== null && start - previousEnd <= 45 * 60_000 ? sessionIndex + 1 : 1;
      previousEnd = at;
    }
    return {
      entry, at, duration, survivors, complete, deaths, escapes, knownOutcomes, outcome, perks, equipment, build,
      killRate: entry.role === "killer" && complete ? deaths / expected : null,
      survival,
      scoreRank: entry.role === "survivor" && scoresComplete ? 1 + scorePeers.filter(score => score > entry.score!).length : null,
      scoreGap: entry.role === "survivor" && scoresComplete ? entry.score! - mean(scorePeers)! : null,
      lastScore: entry.role === "survivor" && scoresComplete ? scorePeers.every(score => score >= entry.score!) : null,
      deathRank: entry.role === "survivor" && outcome === "dead" && survival !== null && timesComplete && !peers.some(p => matchOutcome(p.resultLabel) === "dead" && durationSeconds(p.survivalTimeLabel) === survival) ? 1 + peers.filter(p => matchOutcome(p.resultLabel) === "dead" && durationSeconds(p.survivalTimeLabel)! < survival).length : null,
      lastAlive: entry.role === "survivor" && survival !== null && timesComplete ? peers.every(p => matchOutcome(p.resultLabel) === "dead" && durationSeconds(p.survivalTimeLabel)! < survival) : null,
      firstDeath: entry.role === "killer" && complete && deaths > 0 && timedDeaths.length === deaths ? timedDeaths[0]! : null,
      deathInterval: entry.role === "killer" && complete && deaths > 1 && timedDeaths.length === deaths ? (timedDeaths.at(-1)! - timedDeaths[0]!) / (deaths - 1) : null,
      opponents: entry.participants.filter(p => p.role !== entry.role && p.role !== "unknown").map(p => ({ key: p.name ?? p.imageUrl ?? "Inconnu", label: p.name ?? "Personnage inconnu", image: p.imageUrl })),
      sessionIndex: at === null ? null : sessionIndex,
    };
  });
}

export function summarizeMatches(matches: readonly AnalyzedMatch[]): AnalysisSummary {
  const killers = matches.filter(m => m.entry.role === "killer");
  const survivors = matches.filter(m => m.entry.role === "survivor");
  const escaped = survivors.filter(m => m.outcome === "escaped");
  const dead = survivors.filter(m => m.outcome === "dead");
  const complete = killers.filter(m => m.complete);
  const standard = complete.filter(m => !m.entry.queueLabel || m.entry.queueLabel === "1v4" || m.entry.queueLabel === "Lights Out");
  const fourSurvivorGames = killers.filter(m => !m.entry.queueLabel || m.entry.queueLabel === "1v4" || m.entry.queueLabel === "Lights Out");
  const durations = matches.map(m => m.duration).filter(validNumber);
  const scores = matches.map(m => m.entry.score).filter(validNumber);
  const personalSurvival = survivors.map(m => m.survival).filter(validNumber);
  const ranks = survivors.filter(m => m.scoreRank !== null);
  const completeTeams = survivors.filter(m => m.complete);
  const timedDead = dead.filter(m => m.survival !== null);
  const order = dead.filter(m => m.deathRank !== null);
  const lastAlive = survivors.filter(m => m.lastAlive !== null);
  const dates = matches.map(m => m.at).filter(validNumber);
  const scoreMean = mean(scores);
  const scoreDuration = matches.filter(m => m.entry.score !== null && m.duration !== null && m.duration > 0);
  const outcomes: Record<Outcome, number> = { escaped: 0, dead: 0, disconnected: 0, unknown: 0 };
  survivors.forEach(m => { outcomes[m.outcome]++; });
  const roles = { killer: killers.length, survivor: survivors.length, unknown: matches.length - killers.length - survivors.length };
  const queues: Record<string, number> = {};
  matches.forEach(m => { const key = m.entry.queueLabel ?? "1v4"; queues[key] = (queues[key] ?? 0) + 1; });
  const killSamples = sum(complete.map(m => m.knownOutcomes));
  return {
    count: matches.length, killerCount: killers.length, survivorCount: survivors.length,
    escapeRate: ratio(escaped.length, escaped.length + dead.length), escapeCount: escaped.length, escapeSamples: escaped.length + dead.length,
    killRate: ratio(sum(complete.map(m => m.deaths)), killSamples), deaths: sum(complete.map(m => m.deaths)), killSamples, averageKills: mean(complete.map(m => m.deaths)),
    perfectRate: ratio(complete.filter(m => m.deaths === m.survivors.length).length, complete.length), perfectSamples: complete.length,
    winRate: ratio(standard.filter(m => m.deaths >= 3).length, standard.length), winSamples: standard.length,
    duration: mean(durations), durationMedian: median(durations), totalTime: sum(durations), durationSamples: durations.length, shortest: min(durations), longest: max(durations),
    score: scoreMean, scoreMedian: median(scores), scoreMax: max(scores), scoreStd: scoreMean === null ? null : Math.sqrt(mean(scores.map(s => (s - scoreMean) ** 2))!), scoreSamples: scores.length,
    scoreTotal: sum(scores),
    scorePerMinute: scoreDuration.length ? sum(scoreDuration.map(m => m.entry.score!)) / (sum(scoreDuration.map(m => m.duration!)) / 60) : null,
    survival: mean(personalSurvival), survivalMedian: median(personalSurvival), survivalMax: max(personalSurvival), survivalSamples: personalSurvival.length,
    escapedSurvival: mean(escaped.map(m => m.survival).filter(validNumber)), deadSurvival: mean(dead.map(m => m.survival).filter(validNumber)),
    earlyDeathRate: ratio(timedDead.filter(m => m.survival! < 300).length, timedDead.length),
    topScoreRate: ratio(ranks.filter(m => m.scoreRank === 1).length, ranks.length), topTwoRate: ratio(ranks.filter(m => m.scoreRank! <= 2).length, ranks.length),
    lastScoreRate: ratio(ranks.filter(m => m.lastScore).length, ranks.length), topScoreDead: ranks.filter(m => m.scoreRank === 1 && m.outcome === "dead").length, rankSamples: ranks.length,
    scoreGap: mean(ranks.map(m => m.scoreGap).filter(validNumber)),
    firstDeadRate: ratio(order.filter(m => m.deathRank === 1).length, order.length), lastAliveRate: ratio(lastAlive.filter(m => m.lastAlive).length, lastAlive.length),
    firstDeath: mean(killers.map(m => m.firstDeath).filter(validNumber)), deathInterval: mean(killers.map(m => m.deathInterval).filter(validNumber)),
    teamEscapes: mean(completeTeams.map(m => m.escapes)), teamEscapesWhenAlive: mean(completeTeams.filter(m => m.outcome === "escaped").map(m => m.escapes)), teamEscapesWhenDead: mean(completeTeams.filter(m => m.outcome === "dead").map(m => m.escapes)),
    soleEscapeRate: ratio(completeTeams.filter(m => m.escapes === 1 && m.outcome === "escaped").length, completeTeams.length),
    disconnectedMatches: matches.filter(m => m.survivors.some(p => matchOutcome(p.resultLabel) === "disconnected")).length,
    disconnectedPlayers: sum(matches.map(m => m.survivors.filter(p => matchOutcome(p.resultLabel) === "disconnected").length)),
    streaks: {
      escape: streak(survivors, m => m.outcome === "escaped"),
      death: streak(survivors, m => m.outcome === "dead" || m.outcome === "disconnected"),
      groupEscape: streak(survivors, m => m.complete && m.escapes === m.survivors.length),
      killerWin: streak(fourSurvivorGames, m => m.complete && m.deaths >= 3),
      killerLoss: streak(fourSurvivorGames, m => m.complete && m.deaths <= 1),
      killerDraw: streak(fourSurvivorGames, m => m.complete && m.deaths === 2),
      three: streak(killers.filter(m => !m.entry.queueLabel || m.entry.queueLabel === "1v4"), m => m.complete && m.deaths >= 3),
      perfect: streak(killers, m => m.complete && m.deaths === m.survivors.length),
      leak: streak(killers, m => m.complete && m.escapes > 0),
    },
    killDistribution: Array.from({ length: 9 }, (_, i) => complete.filter(m => m.deaths === i).length),
    escapeDistribution: Array.from({ length: 9 }, (_, i) => completeTeams.filter(m => m.escapes === i).length),
    survivalDistribution: [0, 300, 600, 900].map((start, i) => personalSurvival.filter(s => s >= start && (i === 3 || s < start + 300)).length),
    deathOrder: Array.from({ length: 8 }, (_, i) => order.filter(m => m.deathRank === i + 1).length),
    outcomes, roles, queues, characters: new Set(matches.map(m => `${m.entry.role}:${m.entry.characterName}`)).size,
    activeDays: new Set(dates.map(localDay)).size, firstAt: min(dates), lastAt: max(dates),
  };
}

export function groupMatches(matches: readonly AnalyzedMatch[], dimension: AnalysisDimension): AnalysisRow[] {
  const groups = new Map<string, { asset: AnalysisAsset; matches: AnalyzedMatch[] }>();
  for (const match of matches) {
    const unique = new Map(dimensionAssets(match, dimension).map(asset => [asset.key, asset]));
    for (const asset of unique.values()) {
      const group = groups.get(asset.key) ?? { asset, matches: [] };
      group.matches.push(match);
      groups.set(asset.key, group);
    }
  }
  return [...groups.values()].map(({ asset, matches }) => ({ ...asset, matches, summary: summarizeMatches(matches) })).sort((a, b) => b.summary.count - a.summary.count || a.label.localeCompare(b.label, "fr"));
}

export function summarizeObservedSurvival(matches: readonly AnalyzedMatch[]) {
  const observations = matches.flatMap(match => match.survivors.map(participant => ({
    duration: durationSeconds(participant.survivalTimeLabel),
    outcome: matchOutcome(participant.resultLabel),
  }))).filter((sample): sample is { duration: number; outcome: Outcome } => sample.duration !== null);
  const durations = observations.map(sample => sample.duration);
  const deaths = observations.filter(sample => sample.outcome === "dead");
  return {
    count: observations.length,
    average: mean(durations), median: median(durations), maximum: max(durations),
    escaped: mean(observations.filter(sample => sample.outcome === "escaped").map(sample => sample.duration)),
    dead: mean(deaths.map(sample => sample.duration)),
    earlyDeathRate: ratio(deaths.filter(sample => sample.duration < 300).length, deaths.length),
    distribution: [0, 300, 600, 900].map((start, i) => durations.filter(duration => duration >= start && (i === 3 || duration < start + 300)).length),
  };
}

export function encounterCounts(matches: readonly AnalyzedMatch[], kind: "survivor" | "killer" | "map" | "perk"): { asset: AnalysisAsset; count: number }[] {
  const counts = new Map<string, { asset: AnalysisAsset; count: number }>();
  for (const match of matches) {
    const assets = kind === "map" ? dimensionAssets(match, "map") : kind === "perk"
      ? match.entry.participants.filter(p => p.role !== match.entry.role && p.role !== "unknown").flatMap(p => loadoutAssets(p.perkIconUrls ?? [], p.perkIconLabels))
      : match.entry.participants.filter(p => p.role === kind).map(p => ({ key: p.name ?? p.imageUrl ?? "Inconnu", label: p.name ?? "Personnage inconnu", image: p.imageUrl }));
    for (const asset of assets) {
      const current = counts.get(asset.key) ?? { asset, count: 0 };
      current.count++;
      counts.set(asset.key, current);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.asset.label.localeCompare(b.asset.label, "fr"));
}

export function observedKillRate(matches: readonly AnalyzedMatch[]): number | null {
  const complete = matches.filter(match => match.complete);
  return ratio(sum(complete.map(match => match.deaths)), sum(complete.map(match => match.knownOutcomes)));
}

export function dimensionAssets(m: AnalyzedMatch, dimension: AnalysisDimension): AnalysisAsset[] {
  const text = (label: string): AnalysisAsset[] => [{ key: label, label, image: null }];
  const equipment = (kind: string) => m.equipment.filter(a => a.key.includes(`/${kind}/`));
  const participants = (team: boolean) => m.entry.participants.filter(p => p.role !== "unknown" && (team ? p.role === m.entry.role : p.role !== m.entry.role));
  switch (dimension) {
    case "character": return [{ key: `${m.entry.role}:${m.entry.characterName}`, label: m.entry.characterName, image: m.entry.characterImageUrl }];
    case "map": return m.entry.mapName ? [{ key: m.entry.mapName, label: m.entry.mapName, image: m.entry.mapImageUrl }] : [];
    case "opponent": return m.opponents;
    case "matchup": return m.entry.mapName ? m.opponents.map(a => ({ ...a, key: `${a.key}|${m.entry.mapName}`, label: `${a.label} · ${m.entry.mapName}` })) : [];
    case "build": return m.build ? [m.build] : [];
    case "perk": return m.perks;
    case "pair": return combinations(m.perks, 2);
    case "trio": return combinations(m.perks, 3);
    case "item": return equipment("items");
    case "addon": return equipment("add-ons");
    case "addonPair": return combinations(equipment("add-ons"), 2);
    case "offering": return equipment("offerings");
    case "class": return equipment("characterclasses");
    case "enemyPerk": return participants(false).flatMap(p => loadoutAssets(p.perkIconUrls ?? [], p.perkIconLabels));
    case "teamPerk": return participants(true).flatMap(p => loadoutAssets(p.perkIconUrls ?? [], p.perkIconLabels));
    case "composition": {
      if (m.survivors.length !== (m.entry.queueLabel === "2v8" ? 8 : 4) || m.survivors.some(p => p.equipmentIconUrls === undefined)) return [];
      const items = m.survivors.flatMap((p, i) => loadoutAssets(i === 0 && m.entry.role === "survivor" ? m.entry.equipmentIconUrls : p.equipmentIconUrls ?? [], i === 0 && m.entry.role === "survivor" ? m.entry.equipmentIconLabels : p.equipmentIconLabels).filter(a => a.key.includes("/items/")));
      const types = new Map<string, number>();
      items.forEach(a => { const type = /flashlight/i.test(a.key) ? "lampe" : /medkit/i.test(a.key) ? "trousse" : /toolbox/i.test(a.key) ? "boîte à outils" : /map/i.test(a.key) ? "carte" : /key/i.test(a.key) ? "clé" : a.label; types.set(type, (types.get(type) ?? 0) + 1); });
      return text([...types].sort().map(([label, count]) => `${count} ${label}`).join(" · ") || "Aucun objet");
    }
    case "duplicates": {
      if (m.entry.role !== "survivor" || m.entry.queueLabel === "2v8" || m.survivors.length !== 4 || m.entry.participants.filter(p => p.role === "survivor").some(p => p.perkIconUrls === undefined)) return [];
      const all = [...m.perks, ...participants(true).flatMap(p => loadoutAssets(p.perkIconUrls ?? [], p.perkIconLabels))];
      return text(`${all.length - new Set(all.map(p => p.key)).size} doublon(s) de compétence`);
    }
    case "equipment": return text(m.equipment.some(a => a.key.includes("/items/")) ? "Avec objet / pouvoir" : "Sans objet / pouvoir détecté");
    case "disconnect": return text(m.survivors.some(p => matchOutcome(p.resultLabel) === "disconnected") ? "Avec déconnexion" : "Sans déconnexion signalée");
    case "result": return text(m.entry.role === "killer" ? `${m.entry.resultLabel ?? "Issue inconnue"}${m.complete ? ` · ${m.deaths}K` : ""}` : m.entry.resultLabel ?? "Issue inconnue");
    case "weekday": return m.at === null ? [] : text(weekdayFormatter.format(m.at));
    case "hour": return m.at === null ? [] : text(`${parisHour(m.at).toString().padStart(2, "0")} h`);
    case "session": return m.sessionIndex === null ? [] : text(m.sessionIndex >= 6 ? "6e match et suivants" : `Match ${m.sessionIndex}`);
  }
}

export function combinations(assets: readonly AnalysisAsset[], size: number): AnalysisAsset[] {
  const sorted = [...assets].sort((a, b) => a.key.localeCompare(b.key));
  const result: AnalysisAsset[] = [];
  function visit(start: number, chosen: AnalysisAsset[]): void {
    if (chosen.length === size) { result.push({ key: chosen.map(a => a.key).join("|"), label: chosen.map(a => a.label).join(" · "), image: chosen[0]?.image ?? null, assets: chosen }); return; }
    for (let i = start; i < sorted.length; i++) visit(i + 1, [...chosen, sorted[i]!]);
  }
  visit(0, []);
  return result;
}

export function localDay(at: number): string { return dayFormatter.format(at); }
export function parisHour(at: number): number { return Number(hourFormatter.format(at)); }
export function validNumber(value: number | null): value is number { return value !== null && Number.isFinite(value); }
export function mean(values: readonly number[]): number | null { return values.length ? sum(values) / values.length : null; }
export function ratio(value: number, total: number): number | null { return total ? value / total : null; }
function sum(values: readonly number[]): number { return values.reduce((a, b) => a + b, 0); }
function min(values: readonly number[]): number | null { return values.length ? values.reduce((a, b) => Math.min(a, b)) : null; }
function max(values: readonly number[]): number | null { return values.length ? values.reduce((a, b) => Math.max(a, b)) : null; }
function median(values: readonly number[]): number | null { const sorted = [...values].sort((a, b) => a - b); const i = Math.floor(sorted.length / 2); return sorted.length ? sorted.length % 2 ? sorted[i]! : (sorted[i - 1]! + sorted[i]!) / 2 : null; }
function streak(matches: readonly AnalyzedMatch[], predicate: (m: AnalyzedMatch) => boolean): Streak { let current = 0; let best = 0; for (const m of matches) { current = predicate(m) ? current + 1 : 0; best = Math.max(best, current); } return { current, best }; }
