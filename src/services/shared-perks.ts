import { getCloudClient } from "./cloud-client.js";
import { communityRpc } from "./community.js";

export type SharedDescriptions = Record<string, string | null>;
export interface SharedPerks {
  descriptions: SharedDescriptions;
  names: Record<string, string>;
}

export async function readSharedPerks(): Promise<SharedPerks> {
  const client = getCloudClient();
  if (!client) return { descriptions: {}, names: {} };
  const [descriptions, names] = await Promise.all([
    client.from("shared_perk_descriptions").select("perk_id,description_html"),
    client.from("shared_perk_names").select("perk_id,name_fr")
  ]);
  if (descriptions.error) throw new Error(descriptions.error.message);
  if (names.error) throw new Error(names.error.message);
  return {
    descriptions: Object.fromEntries(descriptions.data.map(row => [row.perk_id, row.description_html])),
    names: Object.fromEntries(names.data.map(row => [row.perk_id, row.name_fr]))
  };
}
export function mergeDescriptions(local: Record<string, string>, shared: SharedDescriptions): Record<string, string> {
  return Object.fromEntries([...Object.entries(local).filter(([id]) => !Object.hasOwn(shared, id)),
    ...Object.entries(shared).filter((entry): entry is [string, string] => typeof entry[1] === "string")]);
}
export async function saveSharedDescription(perkId: string, html: string | null): Promise<void> {
  await communityRpc("save_shared_perk_description", { target_perk: perkId, html });
}

export async function saveSharedPerkName(perkId: string, name: string | null): Promise<void> {
  await communityRpc("save_shared_perk_name", { target_perk: perkId, new_name: name });
}
