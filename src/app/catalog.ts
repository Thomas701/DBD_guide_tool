import killersJson from "../data/generated/killers.json";
import perksJson from "../data/generated/perks.json";
import type { Killer } from "../domain/killer.js";
import type { Perk } from "../domain/perk.js";

const additionalKillers: Killer[] = [
  { id: "myers", name: { fr: "la forme", en: "The Shape" }, portrait: "DBDImages-main/DBDImages-main/images/characters/killer/myers.png", speed: 4.2, terrorRadius: 32, size: "big", tier: "C+", difficulty: "easy" },
  { id: "cenobite", name: { fr: "le cénobite", en: "The Cenobite" }, portrait: "DBDImages-main/DBDImages-main/images/characters/killer/cenobite.png", speed: 4.6, terrorRadius: 32, size: "big", tier: "C+", difficulty: "nightmare" }
];

export const killers = [...killersJson as Killer[], ...additionalKillers.filter((killer) => !(killersJson as Killer[]).some((candidate) => candidate.id === killer.id))];
export const perks = perksJson as Perk[];
export const killerById = new Map(killers.map((killer) => [killer.id, killer]));
export const perkById = new Map(perks.map((perk) => [perk.id, perk]));

export function perkOwner(perk: Perk): string {
  if (perk.characterResolution === "general") return "Perk générale";
  if (perk.characterResolution === "unresolved") return "Personnage non résolu";
  const killer = perk.characterId ? killerById.get(perk.characterId) : undefined;
  return killer?.name.fr ?? killer?.name.en ?? "Personnage inconnu";
}
