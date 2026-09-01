export const MAX_BUILD_PERKS = 4;

export interface Build {
  id: string;
  name: string;
  killerId: string;
  perkIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type BuildPerkValidationError = "too_many_perks" | "duplicate_perks";

export interface BuildDraft {
  name: string;
  killerId: string;
  perkIds: readonly string[];
}

export type BuildValidationError =
  | "missing_name"
  | "invalid_killer_id"
  | "invalid_perk_id"
  | BuildPerkValidationError;

export function validateBuildPerkIds(perkIds: readonly string[]): BuildPerkValidationError[] {
  const errors: BuildPerkValidationError[] = [];
  if (perkIds.length > MAX_BUILD_PERKS) errors.push("too_many_perks");
  if (new Set(perkIds).size !== perkIds.length) errors.push("duplicate_perks");
  return errors;
}

export function validateBuildDraft(build: BuildDraft): BuildValidationError[] {
  const errors: BuildValidationError[] = [];
  if (build.name.trim().length === 0) errors.push("missing_name");
  if (build.killerId.trim().length === 0 || build.killerId.trim() !== build.killerId) {
    errors.push("invalid_killer_id");
  }
  if (build.perkIds.some((id) => id.trim().length === 0 || id.trim() !== id)) {
    errors.push("invalid_perk_id");
  }
  errors.push(...validateBuildPerkIds(build.perkIds));
  return errors;
}
