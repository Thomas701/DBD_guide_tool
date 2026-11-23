import { getCloudClient } from "./cloud-client.js";
import type { MatchHistoryEntry } from "./statistics.js";

export interface AdministrationUser {
  id: string; email: string | null; created_at: string; last_sign_in_at: string | null;
  administrator: boolean; consultant?: boolean; behaviour_synced: boolean;
}
export interface CommunityPlayer { user_id: string; nickname: string }
export interface LeaderboardPlayer { rank: number; user_id: string; nickname: string; mmr: number; wins: number; losses: number }

export async function attachMatchAccounts(matches: MatchHistoryEntry[], userId: string): Promise<void> {
  for (let offset = 0; offset < matches.length; offset += 500) {
    const batch = matches.slice(offset, offset + 500);
    const links = await communityRpc<{ matchId: string; player: CommunityPlayer; participants: { index: number; player: CommunityPlayer }[] }[]>("player_match_accounts", { target_user: userId, match_ids: batch.map(match => match.id) });
    const byId = new Map(batch.map(match => [match.id, match]));
    for (const link of links) {
      const match = byId.get(link.matchId);
      if (!match) continue;
      match.communityPlayer = link.player;
      for (const participant of link.participants) if (match.participants[participant.index]) match.participants[participant.index]!.communityPlayer = participant.player;
    }
  }
}

export async function communityRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const client = getCloudClient();
  if (!client) throw new Error("Cette rubrique est disponible sur le site hébergé, après connexion.");
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}
