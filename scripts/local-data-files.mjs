import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { buildMatchHistoryEntryId } from "./match-history-id.mjs";

export async function writeCurrentBuild(currentBuild) {
  if (!isRecord(currentBuild)) throw new TypeError("Build courant invalide.");
  await writeJson(currentBuildFile(), currentBuild);
}

export async function readStatisticsSnapshot() {
  const stored = await readJson(statisticsSnapshotFile()).catch(() => null);
  const rawSnapshot = normalizeStatisticsSnapshot(stored);
  const snapshot = {
    ...rawSnapshot,
    matchHistory: mergeMatchHistoryEntries([], rawSnapshot.matchHistory)
  };
  if (JSON.stringify(stored?.matchHistory) !== JSON.stringify(snapshot.matchHistory)) {
    await writeJson(statisticsSnapshotFile(), snapshot);
  }
  return { ...snapshot, matchHistory: visibleMatchHistory(snapshot), importedCount: 0, fetchedCount: 0 };
}

export async function syncStatisticsSnapshot(snapshot) {
  const current = normalizeStatisticsSnapshot(await readJson(statisticsSnapshotFile()).catch(() => null));
  const incoming = normalizeStatisticsSnapshot(snapshot);
  const currentIds = new Set(current.matchHistory.map((entry) => entry.id));
  const importedCount = mergeMatchHistoryEntries([], incoming.matchHistory).reduce((count, entry) => count + (currentIds.has(entry.id) ? 0 : 1), 0);
  const next = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    statistics: incoming.statistics ?? current.statistics,
    matchHistory: mergeMatchHistoryEntries(current.matchHistory, incoming.matchHistory),
    deletedMatchIds: current.deletedMatchIds,
    matchEdits: current.matchEdits
  };
  await writeJson(statisticsSnapshotFile(), next);
  return { ...next, matchHistory: visibleMatchHistory(next), importedCount, fetchedCount: incoming.matchHistory.length };
}

export async function updateMatchHistoryEntry(id, changes) {
  const current = normalizeStatisticsSnapshot(await readJson(statisticsSnapshotFile()).catch(() => null));
  const entry = current.matchHistory.find((match) => match.id === id);
  if (!entry || !isRecord(changes)) throw new TypeError("Partie introuvable ou modification invalide.");
  const edited = readMatchHistoryEntry({ ...entry, ...changes, id });
  if (!edited) throw new TypeError("Modification de partie invalide.");
  const patch = Object.fromEntries(Object.entries(edited).filter(([key, value]) => key !== "id" && key !== "participants" && JSON.stringify(value) !== JSON.stringify(entry[key])));
  patch.participants = edited.participants.map((participant, index) => Object.fromEntries(
    Object.entries(participant).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(entry.participants[index]?.[key]))
  ));
  current.matchEdits[id] = patch;
  await writeJson(statisticsSnapshotFile(), current);
  return { ...current, matchHistory: visibleMatchHistory(current), importedCount: 0, fetchedCount: 0 };
}

export async function deleteMatchHistoryEntry(id) {
  const current = normalizeStatisticsSnapshot(await readJson(statisticsSnapshotFile()).catch(() => null));
  if (!current.matchHistory.some((match) => match.id === id)) throw new TypeError("Partie introuvable.");
  current.deletedMatchIds = [...new Set([...current.deletedMatchIds, id])];
  delete current.matchEdits[id];
  await writeJson(statisticsSnapshotFile(), current);
  return { ...current, matchHistory: visibleMatchHistory(current), importedCount: 0, fetchedCount: 0 };
}

function visibleMatchHistory(snapshot) {
  const deleted = new Set(snapshot.deletedMatchIds);
  return snapshot.matchHistory.filter((entry) => !deleted.has(entry.id)).map((entry) => {
    const patch = snapshot.matchEdits[entry.id];
    if (!patch) return entry;
    return {
      ...entry, ...patch, id: entry.id,
      participants: entry.participants.map((participant, index) => ({ ...participant, ...patch.participants?.[index] }))
    };
  }).sort(compareMatchHistoryEntries);
}

export async function updateNativePerk(perkId, changes) {
  if (typeof perkId !== "string" || !perkId.trim() || !isRecord(changes)) {
    throw new TypeError("Modification native de perk invalide.");
  }
  const files = nativePerkFiles();
  const [killerPerks, survivorPerks, survivorDescriptions, survivorOwners, allowedCategories, overrides] = await Promise.all([
    readJson(files.killerPerks),
    readJson(files.survivorPerks),
    readJson(files.survivorDescriptions),
    readJson(files.survivorOwners),
    readJson(files.categories),
    readJson(files.nativeOverrides)
  ]);
  if (
    !Array.isArray(killerPerks)
    || !Array.isArray(survivorPerks)
    || !Array.isArray(allowedCategories)
    || !isRecord(overrides)
    || !isRecord(survivorDescriptions)
    || !isRecord(survivorOwners)
  ) {
    throw new TypeError("Catalogue de perks invalide.");
  }

  const target = findNativePerkTarget(perkId, killerPerks, survivorPerks, files);
  if (!target) throw new TypeError("Perk native introuvable.");

  const next = { ...target.perks[target.index] };
  if ("descriptionHtml" in changes) {
    if (typeof changes.descriptionHtml !== "string" || !changes.descriptionHtml.trim() || changes.descriptionHtml.length > 200_000) {
      throw new TypeError("Description native invalide.");
    }
    next.nativeDescriptionHtml = changes.descriptionHtml.trim();
  }
  if ("categories" in changes) {
    const allowed = new Set(allowedCategories);
    if (!Array.isArray(changes.categories) || changes.categories.some((category) => typeof category !== "string" || !allowed.has(category))) {
      throw new TypeError("Catégories natives invalides.");
    }
    next.categories = [...new Set(changes.categories)];
  }
  if (!("descriptionHtml" in changes) && !("categories" in changes)) throw new TypeError("Aucune modification native fournie.");

  target.perks[target.index] = next;
  const previousOverride = isRecord(overrides[perkId]) ? overrides[perkId] : {};
  overrides[perkId] = {
    ...previousOverride,
    ...(changes.descriptionHtml === undefined ? {} : { nativeDescriptionHtml: next.nativeDescriptionHtml }),
    ...(changes.categories === undefined ? {} : { categories: next.categories })
  };
  await Promise.all([writeJson(target.filePath, target.perks), writeJson(files.nativeOverrides, overrides)]);
  return target.kind === "survivor"
    ? hydrateSurvivorPerk(next, survivorOwners, survivorDescriptions)
    : next;
}

function currentBuildFile() {
  return resolve(process.cwd(), ".data/current-build.json");
}

function statisticsSnapshotFile() {
  return resolve(process.cwd(), ".data/dbd-statistics.json");
}

function nativePerkFiles() {
  return {
    killerPerks: resolve(process.cwd(), "src/data/generated/perks.json"),
    survivorPerks: resolve(process.cwd(), "src/data/generated/survivor-perks.json"),
    survivorDescriptions: resolve(process.cwd(), "src/data/generated/survivor-perk-descriptions.json"),
    survivorOwners: resolve(process.cwd(), "src/data/generated/survivor-perk-owners.json"),
    categories: resolve(process.cwd(), "src/data/generated/categories.json"),
    nativeOverrides: resolve(process.cwd(), "src/data/perk-native-overrides.json")
  };
}

function findNativePerkTarget(perkId, killerPerks, survivorPerks, files) {
  const killerIndex = killerPerks.findIndex((perk) => isRecord(perk) && perk.id === perkId);
  if (killerIndex >= 0) {
    return { kind: "killer", perks: killerPerks, index: killerIndex, filePath: files.killerPerks };
  }

  const survivorIndex = survivorPerks.findIndex((perk) => isRecord(perk) && perk.id === perkId);
  if (survivorIndex >= 0) {
    return { kind: "survivor", perks: survivorPerks, index: survivorIndex, filePath: files.survivorPerks };
  }

  return null;
}

function hydrateSurvivorPerk(perk, survivorOwners, survivorDescriptions) {
  const ownerId = normalizeString(survivorOwners[perk.id]);
  return {
    ...perk,
    characterId: ownerId,
    characterResolution: ownerId ? "resolved" : "general",
    description: {
      fr: isRecord(survivorDescriptions[perk.id]) ? survivorDescriptions[perk.id] : null,
      en: null
    },
    cooldown: perk.cooldown ?? null,
    analysisReadiness: Array.isArray(perk.effects) && perk.effects.length ? perk.analysisReadiness ?? "ready" : "unavailable"
  };
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function mergeMatchHistoryEntries(existingEntries, incomingEntries) {
  const merged = new Map();
  for (const entry of [...normalizeMatchHistoryEntryArray(existingEntries), ...normalizeMatchHistoryEntryArray(incomingEntries)]) {
    const previous = merged.get(entry.id);
    merged.set(entry.id, previous ? {
      ...entry,
      queueLabel: entry.queueLabel ?? previous.queueLabel,
      survivalTimeLabel: entry.survivalTimeLabel ?? previous.survivalTimeLabel,
      emblemIconUrls: entry.emblemIconUrls ?? previous.emblemIconUrls,
      emblemIconLabels: entry.emblemIconLabels ?? previous.emblemIconLabels,
      importedAt: previous.importedAt < entry.importedAt ? previous.importedAt : entry.importedAt,
      participants: entry.participants.map((participant, index) => {
        const old = previous.participants[index];
        return old?.imageUrl === participant.imageUrl ? Object.fromEntries(Object.entries(participant).map(([key, value]) => [key, value ?? old[key]])) : participant;
      }),
    } : entry);
  }
  return [...merged.values()].sort(compareMatchHistoryEntries);
}

function normalizeStatisticsSnapshot(value) {
  if (!isRecord(value)) {
    return { schemaVersion: 1, updatedAt: null, statistics: null, matchHistory: [], deletedMatchIds: [], matchEdits: {} };
  }
  const matchEdits = isRecord(value.matchEdits) ? value.matchEdits : {};
  return {
    schemaVersion: 1,
    updatedAt: normalizeIsoString(value.updatedAt),
    statistics: readStatisticsOverview(value.statistics),
    matchHistory: normalizeMatchHistoryEntryArray(value.matchHistory),
    deletedMatchIds: normalizeStringArray(value.deletedMatchIds),
    matchEdits
  };
}

function readStatisticsOverview(value) {
  if (!isRecord(value)) return null;
  const hoursPlayed = normalizeString(value.hoursPlayed);
  const matchesPlayed = normalizeString(value.matchesPlayed);
  const bloodpointsEarned = normalizeString(value.bloodpointsEarned);
  const sourceUrl = normalizeString(value.sourceUrl);
  return hoursPlayed && matchesPlayed && bloodpointsEarned && sourceUrl
    ? { hoursPlayed, matchesPlayed, bloodpointsEarned, sourceUrl }
    : null;
}

function normalizeMatchHistoryEntryArray(value) {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
      const normalized = readMatchHistoryEntry(entry);
      return normalized ? [{ ...normalized, id: buildMatchHistoryEntryId(normalized) }] : [];
    })
    : [];
}

function readMatchHistoryEntry(value) {
  if (!isRecord(value)) return null;
  const id = normalizeString(value.id);
  const characterName = normalizeString(value.characterName);
  const sourceUrl = normalizeString(value.sourceUrl);
  const importedAt = normalizeIsoString(value.importedAt);
  if (!id || !characterName || !sourceUrl || !importedAt) return null;
  return {
    id,
    role: value.role === "killer" || value.role === "survivor" ? value.role : "unknown",
    characterName,
    survivalTimeLabel: normalizeString(value.survivalTimeLabel),
    emblemIconUrls: Array.isArray(value.emblemIconUrls) ? normalizeStringArray(value.emblemIconUrls).slice(0, 4) : undefined,
    emblemIconLabels: Array.isArray(value.emblemIconLabels) ? normalizeNullableStringArray(value.emblemIconLabels).slice(0, 4) : undefined,
    resultLabel: normalizeString(value.resultLabel),
    score: finiteNumberOrNull(value.score),
    characterImageUrl: normalizeString(value.characterImageUrl),
    perkIconUrls: normalizeStringArray(value.perkIconUrls).slice(0, 4),
    perkIconLabels: normalizeNullableStringArray(value.perkIconLabels).slice(0, 4),
    equipmentIconUrls: normalizeStringArray(value.equipmentIconUrls),
    equipmentIconLabels: normalizeNullableStringArray(value.equipmentIconLabels),
    participants: Array.isArray(value.participants)
      ? value.participants.flatMap((participant) => {
        const normalized = readMatchHistoryParticipant(participant);
        return normalized ? [normalized] : [];
      })
      : [],
    mapName: normalizeString(value.mapName),
    mapImageUrl: normalizeString(value.mapImageUrl),
    playedAt: normalizeIsoString(value.playedAt),
    playedAtLabel: normalizeString(value.playedAtLabel),
    durationLabel: normalizeString(value.durationLabel),
    queueLabel: normalizeString(value.queueLabel) ?? (/\bLights Out\b/i.test(value.resultLabel ?? "") ? "Lights Out" : null),
    sourceUrl,
    importedAt
  };
}

function readMatchHistoryParticipant(value) {
  if (!isRecord(value)) return null;
  return {
    emblemIconUrls: Array.isArray(value.emblemIconUrls) ? normalizeStringArray(value.emblemIconUrls).slice(0, 4) : undefined,
    emblemIconLabels: Array.isArray(value.emblemIconLabels) ? normalizeNullableStringArray(value.emblemIconLabels).slice(0, 4) : undefined,
    name: normalizeString(value.name),
    role: value.role === "killer" || value.role === "survivor" ? value.role : "unknown",
    imageUrl: normalizeString(value.imageUrl),
    score: finiteNumberOrNull(value.score),
    valueLabel: normalizeString(value.valueLabel),
    survivalTimeLabel: normalizeString(value.survivalTimeLabel),
    perkIconUrls: Array.isArray(value.perkIconUrls) ? normalizeStringArray(value.perkIconUrls).slice(0, 4) : undefined,
    perkIconLabels: Array.isArray(value.perkIconLabels) ? normalizeNullableStringArray(value.perkIconLabels).slice(0, 4) : undefined,
    equipmentIconUrls: Array.isArray(value.equipmentIconUrls) ? normalizeStringArray(value.equipmentIconUrls) : undefined,
    equipmentIconLabels: Array.isArray(value.equipmentIconLabels) ? normalizeNullableStringArray(value.equipmentIconLabels) : undefined,
    resultLabel: normalizeString(value.resultLabel)
  };
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.flatMap((entry) => normalizeString(entry) ? [entry.trim()] : [])
    : [];
}

function normalizeNullableStringArray(value) {
  return Array.isArray(value) ? value.map(normalizeString) : [];
}

function normalizeIsoString(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value ? null : value;
}

function finiteNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compareMatchHistoryEntries(left, right) {
  return sortKey(right).localeCompare(sortKey(left));
}

function sortKey(entry) {
  return entry.playedAt ?? entry.importedAt;
}

async function readJson(path) {
  return JSON.parse(await readText(path));
}

function readText(path) {
  return readFile(path, "utf8");
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temporary, path);
      break;
    } catch (error) {
      // Windows can briefly lock the destination while the app reads it.
      if (attempt >= 4 || !["EPERM", "EBUSY"].includes(error.code)) throw error;
      await delay(50 * (attempt + 1));
    }
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
