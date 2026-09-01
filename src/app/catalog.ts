import killersJson from "../data/generated/killers.json";
import perksJson from "../data/generated/perks.json";
import type { Killer } from "../domain/killer.js";
import type { Perk } from "../domain/perk.js";

export const killers = killersJson as Killer[];
export const perks = perksJson as Perk[];
export const killerById = new Map(killers.map((killer) => [killer.id, killer]));
export const perkById = new Map(perks.map((perk) => [perk.id, perk]));

export function perkOwner(perk: Perk): string {
  if (perk.characterResolution === "general") return "Perk générale";
  if (perk.characterResolution === "unresolved") return "Personnage non résolu";
  const killer = perk.characterId ? killerById.get(perk.characterId) : undefined;
  return killer?.name.fr ?? killer?.name.en ?? "Personnage inconnu";
}
