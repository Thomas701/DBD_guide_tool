import { getCloudClient } from "./cloud-client.js";
import type { MatchHistoryEntry, StatisticsStatus } from "./statistics.js";

const historyCache = new Map<string, { watermark: string | null; entries: Map<string, unknown> }>();

async function account() {
  const client = getCloudClient();
  if (!client) throw new Error("Supabase n’est pas configuré.");
  const result = await client.auth.getSession();
  if (result.error || !result.data.session) throw new Error("Reconnectez-vous à votre compte.");
  return { client, userId: result.data.session.user.id };
}

export async function readCloudStatisticsSnapshot(): Promise<unknown> {
  const { client, userId } = await account();
  const overview = await client.from("player_statistics").select("overview,updated_at,imported_count,fetched_count").eq("user_id", userId).maybeSingle();
  if (overview.error) throw new Error(overview.error.message);
  const saved = historyCache.get(userId);
  const watermark: string | null = overview.data?.updated_at ?? null;
  const entries = new Map(saved?.entries);
  if (watermark && watermark !== saved?.watermark) {
    let lastId: string | null = null;
    while (true) {
      let query = client.from("player_matches").select("match_id,entry,deleted").eq("user_id", userId).lte("updated_at", watermark).order("match_id").limit(500);
      if (saved?.watermark) query = query.gt("updated_at", saved.watermark);
      if (lastId) query = query.gt("match_id", lastId);
      const result = await query;
      if (result.error) throw new Error(result.error.message);
      for (const row of result.data) {
        if (row.deleted) entries.delete(row.match_id);
        else entries.set(row.match_id, row.entry);
      }
      if (result.data.length < 500) break;
      lastId = result.data.at(-1)!.match_id;
    }
  }
  historyCache.set(userId, { watermark, entries });
  return {
    statistics: overview.data?.overview ?? null,
    updatedAt: watermark ? new Date(watermark).toISOString() : null,
    matchHistory: [...entries.values()],
    importedCount: overview.data?.imported_count ?? 0,
    fetchedCount: overview.data?.fetched_count ?? 0,
  };
}

export async function readCloudStatisticsStatus(): Promise<StatisticsStatus> {
  const { client, userId } = await account();
  const [collector, overview] = await Promise.all([
    client.rpc("statistics_collector_status"),
    client.from("player_statistics").select("updated_at").eq("user_id", userId).maybeSingle(),
  ]);
  if (collector.error || overview.error) throw new Error(collector.error?.message ?? overview.error!.message);
  const state = collector.data;
  return {
    busy: false,
    phase: state?.state ?? "waiting_for_login",
    message: state?.message ?? "Connectez l’extension à votre compte.",
    startedAt: null, finishedAt: state?.lastSeenAt ?? null,
    lastSuccessAt: overview.data?.updated_at ? new Date(overview.data.updated_at).toISOString() : null,
    error: state?.state === "error" ? state.message : null,
    logs: [],
  };
}

export async function requestCloudStatisticsSync(): Promise<void> {
  const { client } = await account();
  const { data, error } = await client.functions.invoke("sync-statistics", { body: { action: "sync" } });
  if (error || !data?.ok) throw new Error("Synchronisation distante indisponible. Réessayez dans quelques instants.");
}

export async function editCloudMatch(id: string, changes: MatchHistoryEntry | null): Promise<void> {
  const { client } = await account();
  const { error } = await client.rpc("edit_player_match", { match_id: id, changes, remove_match: changes === null });
  if (error) throw new Error(error.message);
}
