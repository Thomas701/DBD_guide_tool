import { attachMatchAccounts, communityRpc } from "./community.js";
import { parseSnapshot, type StatisticsSnapshot } from "./statistics.js";

interface PublicPage { nickname: string; updatedAt: string | null; matchHistory: unknown[]; nextCursor: string | null; importedCount: number; fetchedCount: number }
const profiles = new Map<string, { snapshot: StatisticsSnapshot; nickname: string; at: number }>();
export const cachedPublicStatistics = (userId: string) => profiles.get(userId);
export async function readPublicStatistics(userId: string) {
  const cached = profiles.get(userId);
  if (cached && Date.now() - cached.at < 60_000) return cached;
  let cursor = "", page: PublicPage;
  const matches: unknown[] = [];
  do {
    page = await communityRpc<PublicPage>("player_statistics_page", { target_user: userId, after_match: cursor });
    matches.push(...page.matchHistory);
    if (page.nextCursor && page.nextCursor <= cursor) throw new Error("Pagination des statistiques invalide.");
    cursor = page.nextCursor ?? "";
  } while (cursor);
  const snapshot = parseSnapshot({ ...page, statistics: null, updatedAt: page.updatedAt ? new Date(page.updatedAt).toISOString() : null, matchHistory: matches });
  await attachMatchAccounts(snapshot.matchHistory, userId).catch(() => undefined);
  snapshot.matchHistory.sort((a, b) => (b.playedAt ?? b.importedAt).localeCompare(a.playedAt ?? a.importedAt));
  const value = { snapshot, nickname: page.nickname, at: Date.now() };
  profiles.delete(userId); profiles.set(userId, value);
  if (profiles.size > 20) profiles.delete(profiles.keys().next().value!);
  return value;
}
