// Shared by the local collector and the browser extension.
export function prioritizeMatchRetries(candidates, attemptedMatches) {
  const order = new Map(attemptedMatches.map((id, index) => [id, index]));
  return candidates.sort((left, right) => (order.get(left.entry.id) ?? -1) - (order.get(right.entry.id) ?? -1));
}

export function hasCompleteMatchDetails(entry) {
  return Array.isArray(entry.emblemIconUrls) && (entry.role !== "survivor" || Boolean(entry.survivalTimeLabel))
    && entry.participants.every(participant => Array.isArray(participant.perkIconUrls) && Array.isArray(participant.equipmentIconUrls));
}

export function createStatisticsParser(buildMatchHistoryEntryId) {
const MATCH_HISTORY_URL = "https://stats.deadbydaylight.com/match-history/";
function isStatisticsUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "stats.deadbydaylight.com" && /\/statistics\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function isMatchHistoryUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "stats.deadbydaylight.com" && /\/match-history\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function isStatisticsSiteUrl(value) {
  try {
    return new URL(value).hostname === "stats.deadbydaylight.com";
  } catch {
    return false;
  }
}

function takeMatchesUntilKnown(entries, knownMatchIds) {
  const firstKnownIndex = entries.findIndex((entry) => knownMatchIds.has(entry.id));
  return {
    entries: firstKnownIndex < 0 ? entries : entries.slice(0, firstKnownIndex),
    reachedKnownMatch: firstKnownIndex >= 0
  };
}

function selectMatchesForEnrichment(entries, knownMatchIds, incompleteMatchIds) {
  const newHistory = takeMatchesUntilKnown(entries, knownMatchIds);
  const selected = entries.flatMap((entry, index) => index < newHistory.entries.length || incompleteMatchIds.has(entry.id) ? [{ entry, index }] : []);
  const foundIds = new Set(entries.map((entry) => entry.id));
  return { selected, newHistory, pendingFound: [...incompleteMatchIds].every((id) => foundIds.has(id)) };
}

function normalizeMatchHistoryCard(rawCard, sourceUrl, referenceDate = new Date()) {
  if (!isRecord(rawCard)) return null;
  const textLines = uniqueStrings(Array.isArray(rawCard.textLines) ? rawCard.textLines : []);
  const characterName = findCharacterName(textLines);
  const playedAtLabel = textLines.find(isDateLabel) ?? null;
  const durationLabel = textLines.find(isDurationLabel) ?? null;
  const queueLabel = textLines.find((line) => /^(?:\d+v\d+|Lights Out)$/i.test(line)) ?? null;
  const resultLabel = textLines.find(isResultLabel) ?? null;
  const primaryScoreLine = findPrimaryScoreLine(textLines);
  const scoreLines = textLines.filter(isScoreLine);
  const participantScoreLines = scoreLines.filter((line, index) => line !== primaryScoreLine || index !== scoreLines.indexOf(primaryScoreLine));
  const participants = zipParticipants(stringArray(rawCard.participantImageUrls), participantScoreLines);
  const mapName = findMapName(textLines, { characterName, playedAtLabel, durationLabel, queueLabel, resultLabel, primaryScoreLine, participantScoreLines });
  const perkIconUrls = stringArray(rawCard.loadoutIconUrls).slice(0, 4);
  const equipmentIconUrls = stringArray(rawCard.loadoutIconUrls).slice(4);
  const perkIconLabels = stringArray(rawCard.loadoutIconLabels).slice(0, perkIconUrls.length);
  const equipmentIconLabels = stringArray(rawCard.loadoutIconLabels).slice(4, 4 + equipmentIconUrls.length);
  const importedAt = referenceDate.toISOString();

  if (!characterName && !mapName && !playedAtLabel && perkIconUrls.length === 0 && participants.length === 0) return null;

  const entry = {
    id: "",
    role: inferRole(resultLabel),
    characterName: characterName ?? "Match inconnu",
    resultLabel,
    score: primaryScoreLine ? parseScore(primaryScoreLine) : null,
    characterImageUrl: normalizeUrl(rawCard.characterImageUrl),
    perkIconUrls,
    perkIconLabels,
    equipmentIconUrls,
    equipmentIconLabels,
    participants,
    mapName,
    mapImageUrl: normalizeUrl(rawCard.mapImageUrl),
    playedAt: playedAtLabel ? parseMatchDateLabel(playedAtLabel, referenceDate) : null,
    playedAtLabel,
    durationLabel,
    queueLabel,
    sourceUrl: normalizeUrl(sourceUrl) ?? MATCH_HISTORY_URL,
    importedAt
  };
  entry.id = buildMatchHistoryEntryId(entry);
  return entry;
}

function parseMatchDateLabel(value, referenceDate = new Date()) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = /^(?<month>[A-Za-zÀ-ÿ.]+)\s+(?<day>\d{1,2}),\s+(?<hour>\d{1,2}):(?<minute>\d{2})\s+(?<period>[AP]M)$/i.exec(value.trim());
  const monthIndex = monthIndexFromLabel(parsed?.groups?.month ?? "");
  const day = Number.parseInt(parsed?.groups?.day ?? "", 10);
  const hour12 = Number.parseInt(parsed?.groups?.hour ?? "", 10);
  const minute = Number.parseInt(parsed?.groups?.minute ?? "", 10);
  const period = parsed?.groups?.period?.toUpperCase();
  if (monthIndex < 0 || !Number.isInteger(day) || !Number.isInteger(hour12) || !Number.isInteger(minute) || !period) return null;
  const hour = (hour12 % 12) + (period === "PM" ? 12 : 0);
  const candidate = new Date(Date.UTC(referenceDate.getUTCFullYear(), monthIndex, day, hour, minute));
  if (candidate.getTime() - referenceDate.getTime() > 36 * 60 * 60 * 1000) {
    candidate.setUTCFullYear(candidate.getUTCFullYear() - 1);
  }
  return candidate.toISOString();
}

function extractMatchHistoryEntriesFromHtml(html, sourceUrl, referenceDate = new Date()) {
  if (typeof html !== "string" || !html.trim()) return [];
  const entries = [];
  for (const buttonHtml of matchHistoryButtonsFromHtml(html)) {
    const entry = parseMatchHistoryButtonHtml(buttonHtml, sourceUrl, referenceDate);
    if (entry) entries.push(entry);
  }
  return dedupeMatchHistoryEntries(entries);
}

function countMatchHistoryButtonsFromHtml(html) {
  return matchHistoryButtonsFromHtml(html).length;
}

function findCharacterName(lines) {
  return lines.find((line) => !isResultLabel(line) && !isDateLabel(line) && !isDurationLabel(line) && !isScoreLine(line) && !isGenericLabel(line) && !/^\d+v\d+$/i.test(line)) ?? null;
}

function findMapName(lines, excluded) {
  const ignored = new Set([
    excluded.characterName,
    excluded.playedAtLabel,
    excluded.durationLabel,
    excluded.queueLabel,
    excluded.resultLabel,
    excluded.primaryScoreLine,
    ...excluded.participantScoreLines,
    "Score"
  ].filter(Boolean));
  const candidates = lines.filter((line) => !ignored.has(line) && !isScoreLine(line) && !isGenericLabel(line));
  return candidates.length > 1 ? candidates.at(-1) ?? null : candidates.find((line) => line !== excluded.characterName) ?? null;
}

function findPrimaryScoreLine(lines) {
  const scoreLabelIndex = lines.findIndex((line) => /^score$/i.test(line));
  if (scoreLabelIndex >= 0) return lines.slice(scoreLabelIndex + 1).find(isScoreLine) ?? null;
  return lines.find(isScoreLine) ?? null;
}

function zipParticipants(imageUrls, values) {
  return Array.from({ length: Math.max(imageUrls.length, values.length) }, (_, index) => ({
    name: null,
    role: roleFromCharacterUrl(imageUrls[index]),
    imageUrl: normalizeUrl(imageUrls[index]) ?? null,
    score: parseDisplayNumber(values[index]),
    valueLabel: normalizeStringValue(values[index]),
    survivalTimeLabel: extractDurationLabel(values[index]),
    resultLabel: null
  }));
}

function inferRole(resultLabel) {
  if (!resultLabel) return "unknown";
  return /killer$/i.test(resultLabel) ? "killer" : /escaped|dead|sacrificed|killed|mori|disconnected/i.test(resultLabel) ? "survivor" : "unknown";
}

function isResultLabel(line) {
  return /killer$/i.test(line) || /^(escaped|dead|sacrificed|killed|mori(?:ed)?|disconnected)$/i.test(line);
}

function isDateLabel(line) {
  return /^(?:[A-Z][a-z]{2}|[A-Za-z]{3,9})\s+\d{1,2},\s+\d{1,2}:\d{2}\s+[AP]M$/.test(line);
}

function isDurationLabel(line) {
  return /^\d{1,2}:\d{2}$/.test(line);
}

function isScoreLine(line) {
  return /^\d{1,3}(?:,\d{3})*$/.test(line);
}

function isGenericLabel(line) {
  return /^score$/i.test(line);
}

function parseScore(value) {
  const numeric = Number.parseInt(value.replaceAll(",", ""), 10);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseDisplayNumber(value) {
  return typeof value === "string" && /^\d{1,3}(?:,\d{3})*$/.test(value.trim())
    ? parseScore(value.trim())
    : null;
}

function extractDurationLabel(value) {
  if (typeof value !== "string") return null;
  const matches = value.match(STANDALONE_DURATION_PATTERN);
  return matches?.at(-1) ?? null;
}

function normalizeStringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeUrl(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function roleFromCharacterUrl(url) {
  if (typeof url !== "string") return "unknown";
  if (/\/characters\/survivors\//i.test(url)) return "survivor";
  if (/\/characters\/killers\//i.test(url)) return "killer";
  return "unknown";
}

function matchHistoryButtonsFromHtml(html) {
  return [...html.matchAll(MATCH_HISTORY_BUTTON_PATTERN)].map((match) => match[0]);
}

function dedupeMatchHistoryEntries(entries) {
  const seen = new Map();
  for (const entry of entries) seen.set(entry.id, entry);
  return [...seen.values()];
}

function parseMatchHistoryButtonHtml(buttonHtml, sourceUrl, referenceDate) {
  const role = /data-cy\s*=\s*(["'])killer-match-card-btn\1/i.test(buttonHtml) ? "killer" : /data-cy\s*=\s*(["'])survivor-match-card-btn\1/i.test(buttonHtml) ? "survivor" : "unknown";
  const textContent = collapseText(stripHtml(buttonHtml));
  const characterName = extractTextByClassFragment(buttonHtml, MATCH_CHARACTER_NAME_CLASS_FRAGMENTS) ?? extractCharacterNameFromText(textContent);
  const playedAtLabel = extractDataCyText(buttonHtml, "match-date") ?? firstMatch(textContent, MATCH_DATE_PATTERN);
  const durationLabel = extractDataCyText(buttonHtml, "match-duration") ?? lastMatch(textContent, MATCH_DURATION_PATTERN);
  const mapName = extractDataCyText(buttonHtml, "match-map") ?? null;
  const scoreLabel = extractScoreLabel(buttonHtml, textContent);
  const queueLabel = extractDataCyText(buttonHtml, "match-mode")
    ?? extractTextByClassFragment(buttonHtml, ["font-sans inline-block overflow-hidden text-ellipsis whitespace-nowrap"])
    ?? firstMatch(textContent, /\b(?:\d+v\d+|Lights Out)\b/g);
  const resultLabel = extractResultLabel(queueLabel ? textContent.replaceAll(queueLabel, " ") : textContent, characterName, scoreLabel);
  const imageAssets = extractImageAssets(buttonHtml);
  const imageUrls = imageAssets.map((asset) => asset.url);
  const characterImageUrls = imageUrls.filter(isCharacterAssetUrl);
  const loadoutAssets = imageAssets.filter((asset) => isPerkAssetUrl(asset.url) || isEquipmentAssetUrl(asset.url));
  const perkAssets = loadoutAssets.filter((asset) => isPerkAssetUrl(asset.url));
  const equipmentAssets = loadoutAssets.filter((asset) => !isPerkAssetUrl(asset.url));
  const perkIconUrls = perkAssets.map((asset) => asset.url);
  const perkIconLabels = perkAssets.map((asset) => asset.label);
  const equipmentIconUrls = equipmentAssets.map((asset) => asset.url);
  const equipmentIconLabels = equipmentAssets.map((asset) => asset.label);
  const parsedParticipants = extractParticipantsFromButtonHtml(buttonHtml);
  const participantMetricLabels = extractParticipantMetricLabels(textContent, {
    characterName,
    scoreLabel,
    playedAtLabel,
    durationLabel,
    queueLabel,
    mapName,
    resultLabel,
  });
  const participants = parsedParticipants.length > 0 ? parsedParticipants : zipParticipants(characterImageUrls.slice(1), participantMetricLabels);
  // Hydration can expose a card before its map/date/duration have loaded.
  if (!characterName || !mapName || !playedAtLabel || !durationLabel) return null;
  const entry = {
    id: "",
    role,
    characterName: characterName ?? "Match inconnu",
    resultLabel,
    score: parseDisplayNumber(scoreLabel),
    characterImageUrl: characterImageUrls[0] ?? null,
    perkIconUrls,
    perkIconLabels,
    equipmentIconUrls,
    equipmentIconLabels,
    participants,
    mapName,
    mapImageUrl: imageUrls.find(isMapAssetUrl) ?? null,
    playedAt: playedAtLabel ? parseMatchDateLabel(playedAtLabel, referenceDate) : null,
    playedAtLabel,
    durationLabel,
    queueLabel,
    sourceUrl: normalizeUrl(sourceUrl) ?? MATCH_HISTORY_URL,
    importedAt: referenceDate.toISOString()
  };
  entry.id = buildMatchHistoryEntryId(entry);
  return entry;
}

function extractTextByClassFragment(html, classFragments) {
  for (const fragment of classFragments) {
    const pattern = new RegExp(`<[^>]+class=("|')[^"']*${escapeRegExp(fragment)}[^"']*\\1[^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
    const match = pattern.exec(html);
    const text = collapseText(stripHtml(match?.[2] ?? ""));
    if (text) return text;
  }
  return null;
}

function extractScoreLabel(html, textContent) {
  const explicit = firstMatch(collapseText(stripHtml(firstMatch(html, /Score<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i, 1) ?? "")), /.+/g);
  if (explicit) return explicit;
  const match = /\bScore\b\s*([\d,]+)/i.exec(textContent);
  return match?.[1] ?? null;
}

function extractResultLabel(textContent, characterName, scoreLabel) {
  const beforeScore = scoreLabel ? textContent.split(`Score ${scoreLabel}`)[0] : textContent.split(/\bScore\b/i)[0];
  if (!beforeScore) return null;
  if (characterName && beforeScore.includes(characterName)) {
    const value = beforeScore.replace(characterName, "").trim();
    return value || null;
  }
  return null;
}

function extractParticipantMetricLabels(textContent, context) {
  let segment = textContent;
  if (context.playedAtLabel && segment.includes(context.playedAtLabel)) segment = segment.split(context.playedAtLabel)[0] ?? segment;
  if (context.queueLabel) segment = segment.replace(context.queueLabel, " ");
  if (context.mapName) segment = segment.replace(context.mapName, " ");
  if (context.durationLabel) segment = segment.replace(context.durationLabel, " ");
  if (context.characterName) segment = segment.replace(context.characterName, " ");
  if (context.resultLabel) segment = segment.replace(context.resultLabel, " ");
  if (context.scoreLabel) {
    const marker = `Score ${context.scoreLabel}`;
    segment = segment.includes(marker)
      ? segment.split(marker).slice(1).join(marker)
      : segment.replace(/^.*?\bScore\b/i, " ");
  }
  segment = segment.replace(/\+/g, " ");
  return (segment.match(PARTICIPANT_VALUE_PATTERN) ?? []).map((value) => value.trim());
}

function extractCharacterNameFromText(textContent) {
  const beforeScore = textContent.split(/\bScore\b/i)[0]?.trim() ?? "";
  if (!beforeScore) return null;
  return beforeScore.split(/\s{2,}/).at(-1) ?? null;
}

function extractDataCyText(html, dataCy) {
  const pattern = new RegExp(`<[^>]+data-cy=("|')${escapeRegExp(dataCy)}\\1[^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
  const match = pattern.exec(html);
  const text = collapseText(stripHtml(match?.[2] ?? ""));
  return text || null;
}

function extractImageUrls(html) {
  return extractImageAssets(html).map((asset) => asset.url);
}

function extractImageAssets(html) {
  return [...html.matchAll(/<img\b[^>]*>/gi)].flatMap((match) => {
    const url = extractHtmlAttribute(match[0], "src");
    if (!url) return [];
    const label = extractHtmlAttribute(match[0], "title") ?? extractHtmlAttribute(match[0], "alt");
    return [{ url: normalizeCapturedImageUrl(url), label: normalizeStringValue(decodeHtmlEntities(label ?? "")) }];
  });
}

function extractHtmlAttribute(html, name) {
  return new RegExp(`\\b${name}=("|')([^"']*)\\1`, "i").exec(html)?.[2] ?? null;
}

function extractParticipantsFromButtonHtml(buttonHtml) {
  return [...buttonHtml.matchAll(PARTICIPANT_BLOCK_PATTERN)].map((match) => {
    const imageUrl = normalizeCapturedImageUrl(match.groups?.imageUrl ?? "");
    const role = roleFromCharacterUrl(imageUrl);
    const valueLabel = normalizeStringValue(collapseText(stripHtml(match.groups?.valueLabel ?? "")));
    const statusLabel = normalizeStringValue(collapseText(stripHtml(match.groups?.statusLabel ?? "")));
    const participantBody = collapseText(stripHtml(match.groups?.participantBody ?? ""));
    const survivalTimeLabel = extractDurationLabel(participantBody);
    return {
      name: normalizeStringValue(collapseText(stripHtml(match.groups?.name ?? ""))),
      role,
      imageUrl: normalizeUrl(imageUrl),
      score: parseDisplayNumber(valueLabel),
      valueLabel,
      survivalTimeLabel: survivalTimeLabel && survivalTimeLabel !== valueLabel ? survivalTimeLabel : null,
      resultLabel: statusLabel
    };
  });
}

function normalizeCapturedImageUrl(value) {
  const decoded = decodeHtmlEntities(value);
  try {
    const absolute = new URL(decoded, MATCH_HISTORY_URL);
    const wrapped = absolute.searchParams.get("url");
    return wrapped ? new URL(wrapped, absolute.origin).toString() : absolute.toString();
  } catch {
    return decoded;
  }
}

function isCharacterAssetUrl(url) {
  return /assets\.live\.bhvraccount\.com\/characters\/(killers|survivors)\//i.test(url);
}

function isPerkAssetUrl(url) {
  return /assets\.live\.bhvraccount\.com\/perks\//i.test(url);
}

function isEquipmentAssetUrl(url) {
  return /assets\.live\.bhvraccount\.com\/(offerings|items|add-ons|characterClasses)\//i.test(url);
}

function isMapAssetUrl(url) {
  return /assets\.live\.bhvraccount\.com\/maps\//i.test(url);
}

function stripHtml(value) {
  return decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function collapseText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function firstMatch(value, pattern, group = 0) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const match = new RegExp(pattern.source, flags).exec(value);
  return match?.[group] ?? null;
}

function lastMatch(value, pattern) {
  const matches = [...value.matchAll(pattern.flags.includes("g") ? pattern : new RegExp(pattern.source, `${pattern.flags}g`))];
  return matches.at(-1)?.[0] ?? null;
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;|&#160;/gi, " ");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function extractEmblemsFromHtml(html) {
  const emblems = extractImageAssets(html).filter(asset => /assets\.live\.bhvraccount\.com\/emblems\//i.test(asset.url)).slice(0, 4);
  return { emblemIconUrls: emblems.map(asset => asset.url), emblemIconLabels: emblems.map(asset => asset.label) };
}

function extractParticipantLoadoutFromHtml(html) {
  const assets = extractImageAssets(html);
  const perks = assets.filter((asset) => isPerkAssetUrl(asset.url)).slice(0, 4);
  const equipment = assets.filter((asset) => isEquipmentAssetUrl(asset.url));
  return {
    perkIconUrls: perks.map((asset) => asset.url),
    perkIconLabels: perks.map((asset) => asset.label),
    equipmentIconUrls: equipment.map((asset) => asset.url),
    equipmentIconLabels: equipment.map((asset) => asset.label),
  };
}


function monthIndexFromLabel(value) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return MONTH_LOOKUP[normalized] ?? -1;
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.flatMap((entry) => typeof entry === "string" && entry.trim() ? [entry.trim()] : [])
    : [];
}

function uniqueStrings(values) {
  const seen = new Set();
  return values.flatMap((value) => {
    if (typeof value !== "string") return [];
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return [];
    seen.add(trimmed);
    return [trimmed];
  });
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


const MONTH_LOOKUP = {
  jan: 0,
  january: 0,
  janv: 0,
  janvier: 0,
  feb: 1,
  february: 1,
  fevr: 1,
  fevrier: 1,
  mar: 2,
  march: 2,
  mars: 2,
  apr: 3,
  april: 3,
  avr: 3,
  avril: 3,
  may: 4,
  mai: 4,
  jun: 5,
  june: 5,
  juin: 5,
  jul: 6,
  july: 6,
  juil: 6,
  juillet: 6,
  aug: 7,
  august: 7,
  aout: 7,
  septembre: 8,
  sep: 8,
  sept: 8,
  oct: 9,
  october: 9,
  octobre: 9,
  nov: 10,
  november: 10,
  novembre: 10,
  dec: 11,
  december: 11,
  decembre: 11
};

const MATCH_HISTORY_BUTTON_PATTERN = /<button\b(?=[^>]*\bdata-cy\s*=\s*("|')(killer-match-card-btn|survivor-match-card-btn)\1)[^>]*>[\s\S]*?<\/button>/giu;
const MATCH_DATE_PATTERN = /(?:[A-Z][a-z]{2}|[A-Za-z]{3,9})\s+\d{1,2},\s+\d{1,2}:\d{2}\s+[AP]M/g;
const MATCH_DURATION_PATTERN = /\b\d{1,2}:\d{2}\b/g;
const PARTICIPANT_VALUE_PATTERN = /\d{1,3}(?:,\d{3})*|\d{1,2}:\d{2}/g;
const STANDALONE_DURATION_PATTERN = /\b\d{1,2}:\d{2}\b/g;
const PARTICIPANT_BLOCK_PATTERN = /<img\b[^>]*alt="(?<name>[^"]+)"[^>]*title="[^"]*"[^>]*class="[^"]*absolute w-\[120%\] max-w-none[^"]*"[^>]*src="(?<imageUrl>[^"]+)"[^>]*>[\s\S]{0,300}?<span\b[^>]*class="[^"]*text-md text-neutral-text-light font-sans text-nowrap[^"]*"[^>]*>(?<valueLabel>[\s\S]*?)<\/span>(?<participantBody>[\s\S]{0,220}?)(?:<img\b[^>]*alt="(?<statusLabel>[^"]+)"[^>]*class="[^"]*size-8[^"]*"[^>]*>)?/giu;
const MATCH_CARD_SELECTOR = '[data-cy="killer-match-card-btn"], [data-cy="survivor-match-card-btn"]';
const MATCH_DETAIL_ROOT_SELECTOR = '[data-cy="modal"]';
const PLAYER_BUTTON_SELECTOR = '[data-cy="Players-card"] [data-cy="survivor-opponent-btn"], [data-cy="Players-card"] [data-cy="killer-opponent-btn"]';
const DURATION_VALUE_SELECTOR = '[data-cy="Duration-card"] .text-neutral-text-xlight.grow.text-start.text-lg.font-bold';
const MATCH_CHARACTER_NAME_CLASS_FRAGMENTS = [
  "font-display text-display-xs text-neutral-text-xlight text-start font-bold",
  "font-sans text-left text-md font-bold text-neutral-text-xlight"
];

return {
  isStatisticsUrl, isMatchHistoryUrl, takeMatchesUntilKnown, selectMatchesForEnrichment, normalizeMatchHistoryCard, parseMatchDateLabel, extractMatchHistoryEntriesFromHtml, countMatchHistoryButtonsFromHtml, extractImageAssets, extractEmblemsFromHtml, extractParticipantLoadoutFromHtml, isStatisticsSiteUrl, parseDisplayNumber, extractDurationLabel, extractImageUrls, isCharacterAssetUrl, MATCH_CARD_SELECTOR, MATCH_DETAIL_ROOT_SELECTOR, PLAYER_BUTTON_SELECTOR, DURATION_VALUE_SELECTOR, MATCH_HISTORY_BUTTON_PATTERN
};
}
