import { getCloudClient } from "./cloud-client.js";

export interface AdministrationUser {
  id: string; email: string | null; created_at: string; last_sign_in_at: string | null;
  administrator: boolean; behaviour_synced: boolean;
}
export interface LeaderboardPlayer { rank: number; user_id: string; nickname: string; mmr: number; wins: number; losses: number }

export async function communityRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const client = getCloudClient();
  if (!client) throw new Error("Cette rubrique est disponible sur le site hébergé, après connexion.");
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}
