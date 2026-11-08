import { normalizeServerUrl } from "./assistant-provider.js";

export interface StatisticsOverview {
  hoursPlayed: string;
  matchesPlayed: string;
  bloodpointsEarned: string;
  sourceUrl: string;
}

export interface MatchHistoryParticipant {
  emblemIconUrls?: string[] | undefined;
  emblemIconLabels?: (string | null)[] | undefined;
  perkIconUrls?: string[] | undefined;
  perkIconLabels?: (string | null)[] | undefined;
  equipmentIconUrls?: string[] | undefined;
  equipmentIconLabels?: (string | null)[] | undefined;
  name: string | null;
  role: "killer" | "survivor" | "unknown";
  imageUrl: string | null;
  score: number | null;
  valueLabel: string | null;
  survivalTimeLabel: string | null;
  resultLabel: string | null;
}

export interface MatchHistoryEntry {
  survivalTimeLabel?: string | null | undefined;
  emblemIconUrls?: string[] | undefined;
  emblemIconLabels?: (string | null)[] | undefined;
  id: string;
  role: "killer" | "survivor" | "unknown";
  characterName: string;
  resultLabel: string | null;
  score: number | null;
  characterImageUrl: string | null;
  perkIconUrls: string[];
  perkIconLabels: (string | null)[];
  equipmentIconUrls: string[];
  equipmentIconLabels: (string | null)[];
  participants: MatchHistoryParticipant[];
  mapName: string | null;
  mapImageUrl: string | null;
  playedAt: string | null;
  playedAtLabel: string | null;
  durationLabel: string | null;
  queueLabel: string | null;
  sourceUrl: string;
  importedAt: string;
}

export interface StatisticsSnapshot {
  updatedAt: string | null;
  statistics: StatisticsOverview | null;
  matchHistory: MatchHistoryEntry[];
  importedCount: number;
  fetchedCount: number;
}

export interface StatisticsStatusLog {
  at: string;
  message: string;
}

export interface StatisticsStatus {
  busy: boolean;
  phase: string;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
  logs: StatisticsStatusLog[];
}

export async function readStatisticsSnapshot(serverUrl: string): Promise<StatisticsSnapshot> {
  return requestSnapshot(serverUrl, "/api/statistics/cache");
}

export async function readStatisticsStatus(serverUrl: string): Promise<StatisticsStatus> {
  return requestStatus(serverUrl, "/api/statistics/status");
}

export async function syncStatisticsSnapshot(serverUrl: string): Promise<StatisticsSnapshot> {
  return requestSnapshot(serverUrl, "/api/statistics/connect", { method: "POST" });
}

export async function updateMatchHistoryEntry(serverUrl: string, id: string, changes: MatchHistoryEntry): Promise<StatisticsSnapshot> {
  return requestSnapshot(serverUrl, "/api/statistics/match", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, changes })
  });
}

export async function deleteMatchHistoryEntry(serverUrl: string, id: string): Promise<StatisticsSnapshot> {
  return requestSnapshot(serverUrl, "/api/statistics/match", {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id })
  });
}

export async function showStatisticsPage(serverUrl: string, url: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${normalizeServerUrl(serverUrl)}/api/statistics/show-page`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
  } catch {
    throw new Error("Le service local de statistiques est inaccessible.");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : `Erreur HTTP ${response.status}`);
}

async function requestSnapshot(serverUrl: string, path: string, init?: RequestInit): Promise<StatisticsSnapshot> {
  let response: Response;
  try {
    response = await fetch(`${normalizeServerUrl(serverUrl)}${path}`, init);
  } catch {
    throw new Error("Le service local de statistiques est inaccessible. Lancez l’application avec « Lancer Build Analyzer.bat »." );
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : `Erreur HTTP ${response.status}`);
  return parseSnapshot(payload);
}

async function requestStatus(serverUrl: string, path: string): Promise<StatisticsStatus> {
  let response: Response;
  try {
    response = await fetch(`${normalizeServerUrl(serverUrl)}${path}`);
  } catch {
    throw new Error("Le service local de statistiques est inaccessible. Lancez l’application avec « Lancer Build Analyzer.bat »." );
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : `Erreur HTTP ${response.status}`);
  return parseStatus(payload);
}

function parseSnapshot(value: unknown): StatisticsSnapshot {
  if (!isRecord(value)) throw new Error("Le service de statistiques a renvoyé une réponse invalide.");
  return {
    updatedAt: isoOrNull(value.updatedAt),
    statistics: readStatisticsOverview(value.statistics),
    matchHistory: Array.isArray(value.matchHistory)
      ? value.matchHistory.flatMap((entry) => {
        const normalized = readMatchHistoryEntry(entry);
        return normalized ? [normalized] : [];
      })
      : [],
    importedCount: finiteNumber(value.importedCount, 0),
    fetchedCount: finiteNumber(value.fetchedCount, 0)
  };
}

function parseStatus(value: unknown): StatisticsStatus {
  if (!isRecord(value)) throw new Error("Le service de statistiques a renvoyé un statut invalide.");
  return {
    busy: value.busy === true,
    phase: textOrNull(value.phase) ?? "idle",
    message: textOrNull(value.message) ?? "Statut indisponible.",
    startedAt: isoOrNull(value.startedAt),
    finishedAt: isoOrNull(value.finishedAt),
    lastSuccessAt: isoOrNull(value.lastSuccessAt),
    error: textOrNull(value.error),
    logs: Array.isArray(value.logs)
      ? value.logs.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const at = isoOrNull(entry.at);
        const message = textOrNull(entry.message);
        return at && message ? [{ at, message }] : [];
      })
      : []
  };
}

function readStatisticsOverview(value: unknown): StatisticsOverview | null {
  if (!isRecord(value)) return null;
  const hoursPlayed = textOrNull(value.hoursPlayed);
  const matchesPlayed = textOrNull(value.matchesPlayed);
  const bloodpointsEarned = textOrNull(value.bloodpointsEarned);
  const sourceUrl = textOrNull(value.sourceUrl);
  return hoursPlayed && matchesPlayed && bloodpointsEarned && sourceUrl
    ? { hoursPlayed, matchesPlayed, bloodpointsEarned, sourceUrl }
    : null;
}

function readMatchHistoryEntry(value: unknown): MatchHistoryEntry | null {
  if (!isRecord(value)) return null;
  const id = textOrNull(value.id);
  const characterName = textOrNull(value.characterName);
  const sourceUrl = textOrNull(value.sourceUrl);
  const importedAt = isoOrNull(value.importedAt);
  if (!id || !characterName || !sourceUrl || !importedAt) return null;
  return {
    id,
    role: value.role === "killer" || value.role === "survivor" ? value.role : "unknown",
    characterName,
    survivalTimeLabel: textOrNull(value.survivalTimeLabel),
    emblemIconUrls: textArray(value.emblemIconUrls),
    emblemIconLabels: nullableTextArray(value.emblemIconLabels),
    resultLabel: textOrNull(value.resultLabel),
    score: numericOrNull(value.score),
    characterImageUrl: textOrNull(value.characterImageUrl),
    perkIconUrls: textArray(value.perkIconUrls).slice(0, 4),
    perkIconLabels: nullableTextArray(value.perkIconLabels).slice(0, 4),
    equipmentIconUrls: textArray(value.equipmentIconUrls),
    equipmentIconLabels: nullableTextArray(value.equipmentIconLabels),
    participants: Array.isArray(value.participants)
      ? value.participants.flatMap((participant) => {
        const normalized = readParticipant(participant);
        return normalized ? [normalized] : [];
      })
      : [],
    mapName: textOrNull(value.mapName),
    mapImageUrl: textOrNull(value.mapImageUrl),
    playedAt: isoOrNull(value.playedAt),
    playedAtLabel: textOrNull(value.playedAtLabel),
    durationLabel: textOrNull(value.durationLabel),
    queueLabel: textOrNull(value.queueLabel) ?? (/\bLights Out\b/i.test(String(value.resultLabel ?? "")) ? "Lights Out" : null),
    sourceUrl,
    importedAt
  };
}

function readParticipant(value: unknown): MatchHistoryParticipant | null {
  if (!isRecord(value)) return null;
  return {
    emblemIconUrls: textArray(value.emblemIconUrls),
    emblemIconLabels: nullableTextArray(value.emblemIconLabels),
    name: textOrNull(value.name),
    role: value.role === "killer" || value.role === "survivor" ? value.role : "unknown",
    imageUrl: textOrNull(value.imageUrl),
    score: numericOrNull(value.score),
    valueLabel: textOrNull(value.valueLabel),
    survivalTimeLabel: textOrNull(value.survivalTimeLabel),
    perkIconUrls: Array.isArray(value.perkIconUrls) ? textArray(value.perkIconUrls).slice(0, 4) : undefined,
    perkIconLabels: Array.isArray(value.perkIconLabels) ? nullableTextArray(value.perkIconLabels).slice(0, 4) : undefined,
    equipmentIconUrls: Array.isArray(value.equipmentIconUrls) ? textArray(value.equipmentIconUrls) : undefined,
    equipmentIconLabels: Array.isArray(value.equipmentIconLabels) ? nullableTextArray(value.equipmentIconLabels) : undefined,
    resultLabel: textOrNull(value.resultLabel)
  };
}

function textArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
      const normalized = textOrNull(entry);
      return normalized ? [normalized] : [];
    })
    : [];
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numericOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value ? null : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableTextArray(value: unknown): (string | null)[] {
  return Array.isArray(value) ? value.map(textOrNull) : [];
}
