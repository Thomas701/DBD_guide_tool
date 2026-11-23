import { appStorage } from "./account-storage.js";
import { communityRpc, type LeaderboardPlayer } from "./community.js";

export const LEADERBOARD_MODES = [["1v4-survivor", "1 contre 4 · Survivant"], ["1v4-killer", "1 contre 4 · Tueur"], ["2v8-survivor", "2 contre 8 · Survivant"], ["2v8-killer", "2 contre 8 · Tueur"], ["lights-out-survivor", "Lights Out · Survivant"], ["lights-out-killer", "Lights Out · Tueur"]];
export interface LeaderboardFilters { mode: string; killer: string; page: number }
export interface LeaderboardResult { total: number; players: LeaderboardPlayer[]; killers: string[] }
const FILTERS_KEY = "dbd-build-tool.leaderboard-filters", CACHE_KEY = "dbd-build-tool.leaderboard-cache";
type CacheEntry = { at: number; data: LeaderboardResult };

export function readLeaderboardFilters(): LeaderboardFilters {
  try {
    const value = JSON.parse(appStorage.getItem(FILTERS_KEY) ?? "null");
    if (LEADERBOARD_MODES.some(([mode]) => mode === value?.mode) && typeof value.killer === "string" && value.killer.length <= 160 && Number.isInteger(value.page) && value.page >= 0 && value.page <= 100000) return value;
  } catch { /* Use the default selection if browser storage is unavailable. */ }
  return { mode: "1v4-survivor", killer: "", page: 0 };
}
export function saveLeaderboardFilters(filters: LeaderboardFilters): void {
  try { appStorage.setItem(FILTERS_KEY, JSON.stringify(filters)); } catch { /* Filters still work when storage is full. */ }
}
const cacheKey = ({ mode, killer, page }: LeaderboardFilters) => JSON.stringify([mode, mode.endsWith("-killer") ? killer : "", page]);
function readCache(): Record<string, CacheEntry> {
  try {
    const cache = JSON.parse(appStorage.getItem(CACHE_KEY) ?? "{}");
    return cache && typeof cache === "object" && !Array.isArray(cache) ? cache : {};
  } catch { return {}; }
}
export function cachedLeaderboard(filters: LeaderboardFilters): CacheEntry | null {
  const item = readCache()[cacheKey(filters)];
  return item && Number.isFinite(item.at) && Date.now() - item.at < 86400_000 && Array.isArray(item.data?.players) && Array.isArray(item.data.killers) ? item : null;
}
export async function loadLeaderboard(filters: LeaderboardFilters): Promise<LeaderboardResult> {
  const saved = cachedLeaderboard(filters);
  if (saved && Date.now() - saved.at < 60_000) return saved.data;
  const data = await communityRpc<LeaderboardResult>("player_leaderboard", { selected_mode: filters.mode, selected_killer: filters.mode.endsWith("-killer") ? filters.killer : "", page_index: filters.page });
  const cache = readCache(); cache[cacheKey(filters)] = { at: Date.now(), data };
  try { appStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, 20)))); } catch { /* The fetched result remains usable without a persistent cache. */ }
  return data;
}
