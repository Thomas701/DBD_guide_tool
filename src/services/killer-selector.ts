import {
  KILLER_DIFFICULTIES,
  KILLER_TIERS,
  type Killer
} from "../domain/killer.js";
import type { Locale } from "../domain/localized.js";
import { normalizeWords } from "../import/normalize.js";

export type KillerSortKey = "name" | "tier" | "difficulty" | "speed" | "terrorRadius";
export type SortDirection = "asc" | "desc";

export interface KillerListOptions {
  query: string;
  sortBy: KillerSortKey;
  direction: SortDirection;
  locale: Locale;
}

export const DEFAULT_KILLER_OPTIONS: Readonly<KillerListOptions> = {
  query: "",
  sortBy: "tier",
  direction: "asc",
  locale: "fr"
};

export function selectKillers(
  killers: readonly Killer[],
  options: Readonly<KillerListOptions>
): Killer[] {
  const terms = normalizeWords(options.query).split(" ").filter(Boolean);
  const collator = new Intl.Collator(options.locale, { sensitivity: "base", numeric: true });
  const direction = options.direction === "asc" ? 1 : -1;
  const result = killers.filter((killer) => {
    const names = normalizeWords([killer.name.fr, killer.name.en].filter(Boolean).join(" "));
    return terms.every((term) => names.includes(term));
  });

  return result.sort((left, right) => {
    let comparison = 0;
    switch (options.sortBy) {
      case "tier":
        comparison = KILLER_TIERS.indexOf(left.tier) - KILLER_TIERS.indexOf(right.tier);
        break;
      case "difficulty":
        comparison = KILLER_DIFFICULTIES.indexOf(left.difficulty)
          - KILLER_DIFFICULTIES.indexOf(right.difficulty);
        break;
      case "speed":
        comparison = left.speed - right.speed;
        break;
      case "terrorRadius":
        comparison = left.terrorRadius - right.terrorRadius;
        break;
      case "name":
        comparison = collator.compare(displayName(left, options.locale), displayName(right, options.locale));
        break;
    }
    if (comparison !== 0) return comparison * direction;

    const byName = collator.compare(displayName(left, options.locale), displayName(right, options.locale));
    return byName || left.id.localeCompare(right.id);
  });
}

function displayName(killer: Killer, locale: Locale): string {
  return killer.name[locale] ?? killer.name.fr ?? killer.name.en ?? killer.id;
}
