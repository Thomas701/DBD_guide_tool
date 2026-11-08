export const KILLER_PERK_CATEGORIES = [
  "speed",
  "terror_rayon",
  "destruction",
  "hability_test",
  "blood_trace",
  "chase",
  "aura",
  "recharge",
  "generator",
  "hook",
  "blind",
  "indetectable",
  "care",
  "action",
  "sound",
  "totem",
  "be_one_shot",
  "exhausted",
  "bloodlust",
  "cave",
  "exit_door",
  "obsession",
  "locker"
] as const;

export const SURVIVOR_PERK_CATEGORIES = [
  "survivor_information",
  "survivor_repair",
  "survivor_healing",
  "survivor_rescue",
  "survivor_altruism",
  "survivor_stealth",
  "survivor_chase",
  "survivor_exhaustion",
  "survivor_items",
  "survivor_totem",
  "survivor_endgame",
  "survivor_sabotage",
  "survivor_diversion",
  "survivor_survival",
  "survivor_luck",
  "survivor_obsession"
] as const;

export const PERK_CATEGORIES = [...KILLER_PERK_CATEGORIES, ...SURVIVOR_PERK_CATEGORIES] as const;
export type PerkCategory = (typeof PERK_CATEGORIES)[number];
export type SurvivorPerkCategory = (typeof SURVIVOR_PERK_CATEGORIES)[number];

export const KILLER_PERK_CATEGORY_SET: ReadonlySet<string> = new Set(KILLER_PERK_CATEGORIES);
export const PERK_CATEGORY_SET: ReadonlySet<string> = new Set(PERK_CATEGORIES);

export function perkCategoriesFor(side: "killer" | "survivor"): readonly PerkCategory[] {
  return side === "survivor" ? SURVIVOR_PERK_CATEGORIES : KILLER_PERK_CATEGORIES;
}
