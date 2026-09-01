export const PERK_CATEGORIES = [
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

export type PerkCategory = (typeof PERK_CATEGORIES)[number];

export const PERK_CATEGORY_SET: ReadonlySet<string> = new Set(PERK_CATEGORIES);
