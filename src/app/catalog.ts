import killersJson from "../data/generated/killers.json";
import perksJson from "../data/generated/perks.json";
import survivorsJson from "../data/generated/survivors.json";
import survivorPerksJson from "../data/generated/survivor-perks.json";
import survivorPerkDescriptions from "../data/generated/survivor-perk-descriptions.json";
import survivorPerkOwners from "../data/generated/survivor-perk-owners.json";
import { SURVIVOR_PERK_CATEGORIES_BY_ID } from "../data/survivor-perk-categories.js";
import { SURVIVOR_PERK_EFFECTS } from "../data/survivor-perk-effects.js";
import type { Killer } from "../domain/killer.js";
import type { Perk } from "../domain/perk.js";
import type { RichDescription } from "../domain/rich-description.js";
import { perkCooldown } from "../services/perk-cooldown.js";

const additionalKillers: Killer[] = [
  { id: "myers", name: { fr: "la forme", en: "The Shape" }, portrait: "DBDImages-main/DBDImages-main/images/characters/killer/myers.png", speed: 4.2, terrorRadius: 32, size: "big", tier: "C+", difficulty: "easy" },
  { id: "cenobite", name: { fr: "le cénobite", en: "The Cenobite" }, portrait: "DBDImages-main/DBDImages-main/images/characters/killer/cenobite.png", speed: 4.6, terrorRadius: 32, size: "big", tier: "C+", difficulty: "nightmare" }
];
const survivorOwners: Record<string, string> = survivorPerkOwners;
const survivorDescriptions = survivorPerkDescriptions as unknown as Record<string, RichDescription>;

export const killers = [...killersJson as Killer[], ...additionalKillers.filter((killer) => !(killersJson as Killer[]).some((candidate) => candidate.id === killer.id))];
export const survivors: Killer[] = (survivorsJson as Array<Pick<Killer, "id" | "name" | "portrait">>).map((survivor) => ({
  ...survivor,
  speed: 4,
  terrorRadius: 0,
  size: "normal",
  tier: "D",
  difficulty: "easy"
}));
export const perks: Perk[] = [
  ...(perksJson as Perk[]),
  ...((survivorPerksJson as unknown as Array<Partial<Perk>>).map((perk) => ({
    ...perk,
    categories: [...(SURVIVOR_PERK_CATEGORIES_BY_ID[perk.id ?? ""] ?? [])],
    characterId: survivorOwners[perk.id ?? ""] ?? null,
    characterResolution: survivorOwners[perk.id ?? ""] ? "resolved" : "general",
    description: { fr: survivorDescriptions[perk.id ?? ""] ?? null, en: null },
    effects: [...(SURVIVOR_PERK_EFFECTS[perk.id ?? ""] ?? [])],
    effectImportStatus: SURVIVOR_PERK_EFFECTS[perk.id ?? ""] ? "parsed" : "unparsed",
    analysisReadiness: !SURVIVOR_PERK_EFFECTS[perk.id ?? ""] ? "unavailable" : SURVIVOR_PERK_EFFECTS[perk.id ?? ""]!.some((effect) => effect.interpretation === "inferred") ? "partial" : "ready"
  } as Perk)))
].map((perk) => ({ ...perk, cooldown: perkCooldown(perk) }));
export const killerById = new Map(killers.map((killer) => [killer.id, killer]));
export const survivorById = new Map(survivors.map((survivor) => [survivor.id, survivor]));
export const characterById = new Map([...killers, ...survivors].map((character) => [character.id, character]));
export const perkById = new Map(perks.map((perk) => [perk.id, perk]));

export function perkOwner(perk: Perk): string {
  if (perk.characterResolution === "general") return "Perk générale";
  if (perk.characterResolution === "unresolved") return "Personnage non résolu";
  const character = perk.characterId ? characterById.get(perk.characterId) : undefined;
  return character?.name.fr ?? character?.name.en ?? "Personnage inconnu";
}
