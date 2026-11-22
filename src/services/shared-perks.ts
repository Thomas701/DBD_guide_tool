import { getCloudClient } from "./cloud-client.js";
import { communityRpc } from "./community.js";

export type SharedDescriptions = Record<string, string | null>;
export async function readSharedDescriptions(): Promise<SharedDescriptions> {
  const client = getCloudClient();
  if (!client) return {};
  const result = await client.from("shared_perk_descriptions").select("perk_id,description_html");
  if (result.error) throw new Error(result.error.message);
  return Object.fromEntries(result.data.map(row => [row.perk_id, row.description_html]));
}
export function mergeDescriptions(local: Record<string, string>, shared: SharedDescriptions): Record<string, string> {
  return Object.fromEntries([...Object.entries(local).filter(([id]) => !Object.hasOwn(shared, id)),
    ...Object.entries(shared).filter((entry): entry is [string, string] => typeof entry[1] === "string")]);
}
export async function saveSharedDescription(perkId: string, html: string | null): Promise<void> {
  await communityRpc("save_shared_perk_description", { target_perk: perkId, html });
}
