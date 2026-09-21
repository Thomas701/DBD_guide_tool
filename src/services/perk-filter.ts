import type { PerkCategory } from "../domain/category.js";
import type { Killer } from "../domain/killer.js";
import type { Perk, PerkSide } from "../domain/perk.js";
import { normalizeWords } from "../import/normalize.js";

export type CategoryMatchMode = "any" | "all";
export type CooldownFilter = "any" | "with" | "without";

export interface PerkFilters {
  side: PerkSide;
  query: string;
  categories: readonly PerkCategory[];
  categoryMode: CategoryMatchMode;
  characterIds: readonly (string | null)[];
  cooldown: CooldownFilter;
}

export const DEFAULT_PERK_FILTERS: Readonly<PerkFilters> = {
  side: "killer",
  query: "",
  categories: [],
  categoryMode: "any",
  characterIds: [],
  cooldown: "any"
};

export function filterPerks(
  perks: readonly Perk[],
  filters: Readonly<PerkFilters>,
  killers: readonly Killer[] = []
): Perk[] {
  const terms = normalizeWords(filters.query).split(" ").filter(Boolean);
  const ownerNames = new Map(killers.map((killer) => [killer.id, [killer.name.fr, killer.name.en].filter(Boolean).join(" ")]));
  const ownerLabels = new Map(killers.map((killer) => [killer.id, killer.name.fr ?? killer.name.en ?? killer.id]));
  const filtered = perks.filter((perk) => {
    if (perk.side !== filters.side) return false;

    const names = normalizeWords([
      perk.name.fr,
      perk.name.en,
      perk.characterId ? ownerNames.get(perk.characterId) : null
    ].filter(Boolean).join(" "));
    if (!terms.every((term) => names.includes(term))) return false;

    if (filters.characterIds.length > 0) {
      const matchesGeneral = perk.characterResolution === "general" && filters.characterIds.includes(null);
      const matchesKiller = perk.characterId !== null && filters.characterIds.includes(perk.characterId);
      if (!matchesGeneral && !matchesKiller) return false;
    }

    if (filters.categories.length > 0) {
      const matchesCategory = filters.categoryMode === "all"
        ? filters.categories.every((category) => perk.categories.includes(category))
        : filters.categories.some((category) => perk.categories.includes(category));
      if (!matchesCategory) return false;
    }

    if (filters.cooldown === "with" && perk.cooldown === null) return false;
    if (filters.cooldown === "without" && perk.cooldown !== null) return false;
    return true;
  });

  if (filters.side !== "survivor") return filtered;

  return [...filtered].sort((left, right) => {
    const leftHasOwner = left.characterId ? 0 : 1;
    const rightHasOwner = right.characterId ? 0 : 1;
    if (leftHasOwner !== rightHasOwner) return leftHasOwner - rightHasOwner;

    const ownerOrder = (ownerLabels.get(left.characterId ?? "") ?? "").localeCompare(ownerLabels.get(right.characterId ?? "") ?? "", "fr");
    if (ownerOrder !== 0) return ownerOrder;

    const nameOrder = perkLabel(left).localeCompare(perkLabel(right), "fr");
    if (nameOrder !== 0) return nameOrder;

    return left.id.localeCompare(right.id, "fr");
  });
}

function perkLabel(perk: Perk): string {
  return perk.name.fr ?? perk.name.en ?? perk.id;
}
