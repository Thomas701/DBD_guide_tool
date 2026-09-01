import type { Killer } from "../domain/killer.js";
import type { Perk } from "../domain/perk.js";
import type { RichDescription } from "../domain/rich-description.js";

export type ImportSeverity = "warning" | "error";

export interface ImportIssue {
  code: string;
  severity: ImportSeverity;
  file: string;
  line: number | null;
  entity: string | null;
  field: string | null;
  raw: string | null;
  message: string;
}

export interface UnresolvedPerkReference {
  perkId: string;
  name: string;
  line: number;
  raw: string | null;
  reason: string;
}

export interface UnparsedEffect extends UnresolvedPerkReference {
  token: string;
}

export interface UnresolvedKillerReference {
  killerId: string;
  name: string;
  line: number;
  raw: string | null;
  reason: string;
}

export interface ImportedDescriptionRecord {
  id: string;
  nameRaw: string;
  alternateNameRaw: string;
  characterRaw: string | null;
  portraitRaw: string | null;
  description: RichDescription;
  provenance: {
    file: string;
    line: number;
  };
}

export interface ImportReport {
  formatVersion: 1;
  imported: {
    perks: number;
    killers: number;
    descriptions: number;
  };
  skipped: {
    perks: number;
    killers: number;
  };
  sourceRows: {
    perkCandidates: number;
    killerCandidates: number;
  };
  warnings: ImportIssue[];
  errors: ImportIssue[];
  unresolvedIcons: UnresolvedPerkReference[];
  unresolvedKillerPortraits: UnresolvedKillerReference[];
  unusedIcons: string[];
  unusedKillerPortraits: string[];
  unresolvedCharacters: UnresolvedPerkReference[];
  unresolvedDescriptions: {
    perks: UnresolvedPerkReference[];
    records: Array<{
      descriptionId: string;
      name: string;
      line: number;
      reason: string;
    }>;
  };
  unparsedEffects: UnparsedEffect[];
  incompleteTranslations: {
    perkNamesEn: number;
    killerNamesEn: number;
    perkDescriptionsEn: number;
  };
}

export interface ImportBundle {
  perks: Perk[];
  killers: Killer[];
  descriptions: ImportedDescriptionRecord[];
  report: ImportReport;
}
