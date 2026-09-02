import type { PerkCategory } from "./category.js";
import type { PerkEffect } from "./effect.js";
import type { LocalizedText } from "./localized.js";
import type { RichDescription } from "./rich-description.js";

export type PerkSide = "killer" | "survivor";
export type CharacterResolution = "resolved" | "general" | "unresolved";
export type EffectImportStatus = "parsed" | "partial" | "unparsed";
export type AnalysisReadiness = "ready" | "partial" | "unavailable";

export interface Perk {
  id: string;
  name: LocalizedText;
  side: PerkSide;
  categories: PerkCategory[];
  characterId: string | null;
  characterResolution: CharacterResolution;
  icon: string | null;
  description: {
    fr: RichDescription | null;
    en: RichDescription | null;
  };
  nativeDescriptionHtml?: string;
  effects: PerkEffect[];
  cooldown: number | null;
  effectImportStatus: EffectImportStatus;
  analysisReadiness: AnalysisReadiness;
  provenance?: {
    file: string;
    line: number;
  };
}
