import type { LocalizedText } from "./localized.js";

export const KILLER_SIZES = ["small", "normal", "big"] as const;
export const KILLER_TIERS = ["S+", "S-", "A+", "A-", "B+", "B-", "C+", "C-", "D"] as const;
export const KILLER_DIFFICULTIES = ["easy", "normal", "difficult", "nightmare"] as const;

export type KillerSize = (typeof KILLER_SIZES)[number];
export type KillerTier = (typeof KILLER_TIERS)[number];
export type KillerDifficulty = (typeof KILLER_DIFFICULTIES)[number];

export interface Killer {
  id: string;
  name: LocalizedText;
  speed: number;
  terrorRadius: number;
  size: KillerSize;
  tier: KillerTier;
  difficulty: KillerDifficulty;
  portrait: string | null;
  provenance?: {
    file: string;
    line: number;
  };
}
