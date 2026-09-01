import { posix } from "node:path";

import {
  KILLER_ALIASES,
  PERK_ALIASES,
  type KillerAlias,
  type PerkAlias
} from "../data/catalog-aliases.js";
import { PERK_CATEGORY_SET, type PerkCategory } from "../domain/category.js";
import {
  KILLER_DIFFICULTIES,
  KILLER_SIZES,
  KILLER_TIERS,
  type Killer,
  type KillerDifficulty,
  type KillerSize,
  type KillerTier
} from "../domain/killer.js";
import type { Perk, PerkSide } from "../domain/perk.js";
import type { RichDescription } from "../domain/rich-description.js";
import { CHARACTER_ALIASES } from "../data/import-overrides.js";
import { PERK_EFFECT_OVERRIDES } from "../data/perk-effect-overrides.js";
import { parseDescriptionSource } from "./description-parser.js";
import { parseLegacyEffects } from "./effect-parser.js";
import {
  isNullToken,
  normalizeLookup,
  normalizeWords,
  sourceId
} from "./normalize.js";
import type {
  ImportBundle,
  ImportIssue,
  ImportReport,
  ImportedDescriptionRecord,
  UnparsedEffect,
  UnresolvedKillerReference,
  UnresolvedPerkReference
} from "./types.js";

export interface ImportInputs {
  sourceText: string;
  descriptionText: string;
  iconFileNames: string[];
  portraitFileNames?: string[];
  sourceFile?: string;
  descriptionFile?: string;
  iconDirectory?: string;
  portraitDirectory?: string;
}

interface RawCandidate {
  line: number;
  raw: string;
  columns: string[];
}

interface ScannedSource {
  perkCandidates: RawCandidate[];
  killerCandidates: RawCandidate[];
}

interface ParsedPerkRow {
  line: number;
  raw: string;
  nameRaw: string;
  sideRaw: string;
  categoriesRaw: string;
  characterRaw: string;
  iconRaw: string;
  descriptionRaw: string;
  effectRaw: string;
  cooldownRaw: string;
}

const ICON_EXTENSION = /\.png$/i;

export function importData(inputs: ImportInputs): ImportBundle {
  const sourceFile = inputs.sourceFile ?? "source.txt";
  const descriptionFile = inputs.descriptionFile ?? "description_categories.txt";
  const iconDirectory = (inputs.iconDirectory ?? "DBDImages-main/DBDImages-main/images/perks/killer")
    .replace(/\\/g, "/")
    .replace(/\/$/, "");
  const portraitDirectory = (inputs.portraitDirectory ?? "DBDImages-main/DBDImages-main/images/characters/killer")
    .replace(/\\/g, "/")
    .replace(/\/$/, "");
  const warnings: ImportIssue[] = [];
  const errors: ImportIssue[] = [];
  const unresolvedIcons: UnresolvedPerkReference[] = [];
  const unresolvedKillerPortraits: UnresolvedKillerReference[] = [];
  const unresolvedCharacters: UnresolvedPerkReference[] = [];
  const unparsedEffects: UnparsedEffect[] = [];
  const iconFiles = new Set(inputs.iconFileNames.filter((value) => ICON_EXTENSION.test(value)));
  const portraitFiles = new Set((inputs.portraitFileNames ?? []).filter((value) => ICON_EXTENSION.test(value)));
  const usedIconFiles = new Set<string>();
  const usedPortraitFiles = new Set<string>();
  const perkAliasIndex = aliasIndex(PERK_ALIASES);
  const killerAliasIndex = aliasIndex(KILLER_ALIASES);

  const scanned = scanSource(inputs.sourceText);
  const killerCandidates = scanned.killerCandidates.filter((candidate) => {
    if (candidate.columns.length === 6) return true;
    errors.push(issue(
      "killer_column_count",
      "error",
      sourceFile,
      candidate.line,
      candidate.columns[0] ?? null,
      null,
      candidate.raw,
      `6 colonnes attendues, ${candidate.columns.length} reçues`
    ));
    return false;
  });
  const killers = parseKillers({
    candidates: killerCandidates,
    file: sourceFile,
    errors,
    warnings,
    aliasIndex: killerAliasIndex,
    portraitFiles,
    portraitDirectory,
    usedPortraitFiles,
    unresolvedKillerPortraits
  });
  const killerIndex = uniqueIndex(killers, (killer) => normalizeWords(killer.name.fr ?? ""));

  const parsedDescriptionResult = parseDescriptionSource(inputs.descriptionText, descriptionFile);
  warnings.push(...parsedDescriptionResult.issues.filter((entry) => entry.severity === "warning"));
  errors.push(...parsedDescriptionResult.issues.filter((entry) => entry.severity === "error"));
  const descriptions = parsedDescriptionResult.records;
  const descriptionIndex = uniqueIndex(descriptions, (record) => normalizeLookup(record.nameRaw));
  const matchedDescriptionIds = new Set<string>();

  const validPerkRows: ParsedPerkRow[] = [];
  for (const candidate of scanned.perkCandidates) {
    if (candidate.columns.length !== 8) {
      errors.push(issue(
        "perk_column_count",
        "error",
        sourceFile,
        candidate.line,
        candidate.columns[0] ?? null,
        null,
        candidate.raw,
        `8 colonnes attendues, ${candidate.columns.length} reçues; ligne mise en quarantaine`
      ));
      continue;
    }
    const [nameRaw, sideRaw, categoriesRaw, characterRaw, iconRaw, descriptionRaw, effectRaw, cooldownRaw] = candidate.columns;
    if (
      nameRaw === undefined || sideRaw === undefined || categoriesRaw === undefined
      || characterRaw === undefined || iconRaw === undefined || descriptionRaw === undefined
      || effectRaw === undefined || cooldownRaw === undefined
    ) {
      continue;
    }
    validPerkRows.push({
      line: candidate.line,
      raw: candidate.raw,
      nameRaw,
      sideRaw,
      categoriesRaw,
      characterRaw,
      iconRaw,
      descriptionRaw,
      effectRaw,
      cooldownRaw
    });
  }

  const perks: Perk[] = [];
  for (const row of validPerkRows) {
    const perk = parsePerk({
      row,
      sourceFile,
      iconDirectory,
      iconFiles,
      usedIconFiles,
      perkAliasIndex,
      killerIndex,
      descriptionIndex,
      matchedDescriptionIds,
      warnings,
      errors,
      unresolvedIcons,
      unresolvedCharacters,
      unparsedEffects
    });
    if (perk) perks.push(perk);
  }

  const perkDescriptionMatches = new Set(
    perks.filter((perk) => perk.description.fr !== null).map((perk) => perk.id)
  );
  const unresolvedDescriptionPerks = perks
    .filter((perk) => !perkDescriptionMatches.has(perk.id))
    .map((perk) => unresolvedReference(
      perk,
      null,
      "aucune description liée par correspondance normalisée exacte"
    ));
  const unresolvedDescriptionRecords = descriptions
    .filter((record) => !matchedDescriptionIds.has(record.id))
    .map((record) => ({
      descriptionId: record.id,
      name: record.nameRaw,
      line: record.provenance.line,
      reason: "aucune perk liée par correspondance normalisée exacte"
    }));

  sortIssues(warnings);
  sortIssues(errors);
  unresolvedIcons.sort(byLine);
  unresolvedKillerPortraits.sort(byLine);
  unresolvedCharacters.sort(byLine);
  unparsedEffects.sort(byLine);

  const report: ImportReport = {
    formatVersion: 1,
    imported: {
      perks: perks.length,
      killers: killers.length,
      descriptions: descriptions.length
    },
    skipped: {
      perks: scanned.perkCandidates.length - perks.length,
      killers: scanned.killerCandidates.length - killers.length
    },
    sourceRows: {
      perkCandidates: scanned.perkCandidates.length,
      killerCandidates: scanned.killerCandidates.length
    },
    warnings,
    errors,
    unresolvedIcons,
    unresolvedKillerPortraits,
    unusedIcons: [...iconFiles].filter((fileName) => !usedIconFiles.has(fileName)).sort(),
    unusedKillerPortraits: [...portraitFiles].filter((fileName) => !usedPortraitFiles.has(fileName)).sort(),
    unresolvedCharacters,
    unresolvedDescriptions: {
      perks: unresolvedDescriptionPerks,
      records: unresolvedDescriptionRecords
    },
    unparsedEffects,
    incompleteTranslations: {
      perkNamesEn: perks.filter((perk) => perk.name.en === null).length,
      killerNamesEn: killers.filter((killer) => killer.name.en === null).length,
      perkDescriptionsEn: perks.filter((perk) => perk.description.en === null).length
    }
  };

  return { perks, killers, descriptions, report };
}

function scanSource(content: string): ScannedSource {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const perkCandidates: RawCandidate[] = [];
  const killerCandidates: RawCandidate[] = [];
  let section: "perk" | "killer" | "other" = "other";

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const trimmed = raw.trim();
    const marker = trimmed.toLocaleUpperCase("fr");
    if (marker === "PERK:") {
      section = "perk";
      continue;
    }
    if (marker === "KILLER:") {
      section = "killer";
      continue;
    }
    if (marker === "CATEGORIE:" || marker === "TIERS LIST:") {
      section = "other";
      continue;
    }
    if (!trimmed || trimmed.startsWith("name;")) continue;

    const columns = trimmed.split(";").map((column) => column.trim());
    if (section === "perk" && !isPerkGroupHeading(trimmed, columns)) {
      perkCandidates.push({ line: index + 1, raw: trimmed, columns });
    } else if (section === "killer" && trimmed.includes(";")) {
      killerCandidates.push({ line: index + 1, raw: trimmed, columns });
    }
  }

  return { perkCandidates, killerCandidates };
}

function isPerkGroupHeading(value: string, columns: string[]): boolean {
  if (value.endsWith(":")) return true;
  if (columns.length === 2 && columns[1] === "") {
    return columns[0] === columns[0]?.toLocaleUpperCase("fr");
  }
  return !value.includes(";") && value === value.toLocaleUpperCase("fr");
}

interface ParseKillerContext {
  candidates: RawCandidate[];
  file: string;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  aliasIndex: Map<string, KillerAlias | null>;
  portraitFiles: Set<string>;
  portraitDirectory: string;
  usedPortraitFiles: Set<string>;
  unresolvedKillerPortraits: UnresolvedKillerReference[];
}

function parseKillers(context: ParseKillerContext): Killer[] {
  const killers: Killer[] = [];
  const names = new Set<string>();

  for (const candidate of context.candidates) {
    const [nameRaw, speedRaw, terrorRadiusRaw, sizeRaw, tierRaw, difficultyRaw] = candidate.columns;
    const speed = Number(speedRaw);
    const terrorRadius = Number(terrorRadiusRaw);
    const size = sizeRaw as KillerSize;
    const tier = tierRaw as KillerTier;
    const difficulty = difficultyRaw as KillerDifficulty;
    const invalidFields: string[] = [];
    if (!nameRaw) invalidFields.push("name");
    if (!Number.isFinite(speed) || speed <= 0) invalidFields.push("speed");
    if (!Number.isFinite(terrorRadius) || terrorRadius < 0) invalidFields.push("terror_rayon");
    if (!KILLER_SIZES.some((value) => value === size)) invalidFields.push("size");
    if (!KILLER_TIERS.some((value) => value === tier)) invalidFields.push("tierlist");
    if (!KILLER_DIFFICULTIES.some((value) => value === difficulty)) invalidFields.push("difficulty");

    const key = normalizeWords(nameRaw ?? "");
    if (names.has(key)) invalidFields.push("name(duplicate)");
    if (invalidFields.length > 0) {
      context.errors.push(issue(
        "killer_validation_failed",
        "error",
        context.file,
        candidate.line,
        nameRaw ?? null,
        invalidFields.join(","),
        candidate.raw,
        `champs invalides: ${invalidFields.join(", ")}`
      ));
      continue;
    }

    names.add(key);
    const alias = context.aliasIndex.get(normalizeLookup(nameRaw ?? "")) ?? null;
    if (!alias) {
      context.warnings.push(issue(
        "killer_alias_missing",
        "warning",
        context.file,
        candidate.line,
        nameRaw ?? null,
        "name",
        nameRaw ?? null,
        "aucun alias explicite; identifiant de provenance conservé"
      ));
    }
    const id = alias?.id ?? sourceId("killer", candidate.line);
    let portrait: string | null = null;
    if (alias?.portraitFile && context.portraitFiles.has(alias.portraitFile)) {
      portrait = posix.join(context.portraitDirectory, alias.portraitFile);
      context.usedPortraitFiles.add(alias.portraitFile);
    } else {
      context.unresolvedKillerPortraits.push({
        killerId: id,
        name: nameRaw ?? id,
        line: candidate.line,
        raw: alias?.portraitFile ?? null,
        reason: alias?.portraitFile
          ? "le portrait déclaré dans le mapping est absent du dossier"
          : "aucun portrait explicite n'est disponible dans le snapshot"
      });
    }
    killers.push({
      id,
      name: { fr: nameRaw ?? null, en: alias?.nameEn ?? null },
      portrait,
      speed,
      terrorRadius,
      size,
      tier,
      difficulty,
      provenance: { file: context.file, line: candidate.line }
    });
  }

  return killers;
}

interface ParsePerkContext {
  row: ParsedPerkRow;
  sourceFile: string;
  iconDirectory: string;
  iconFiles: Set<string>;
  usedIconFiles: Set<string>;
  perkAliasIndex: Map<string, PerkAlias | null>;
  killerIndex: Map<string, Killer | null>;
  descriptionIndex: Map<string, ImportedDescriptionRecord | null>;
  matchedDescriptionIds: Set<string>;
  warnings: ImportIssue[];
  errors: ImportIssue[];
  unresolvedIcons: UnresolvedPerkReference[];
  unresolvedCharacters: UnresolvedPerkReference[];
  unparsedEffects: UnparsedEffect[];
}

function parsePerk(context: ParsePerkContext): Perk | null {
  const { row, sourceFile } = context;
  const sourceName = row.nameRaw.trim();
  if (!sourceName) {
    context.errors.push(issue(
      "perk_name_missing", "error", sourceFile, row.line, null, "name", row.raw, "nom de perk absent"
    ));
    return null;
  }
  const alias = context.perkAliasIndex.get(normalizeLookup(sourceName)) ?? null;
  const id = alias?.id ?? sourceId("perk", row.line);
  const name = sourceName;
  if (!alias) {
    context.warnings.push(issue(
      "perk_alias_missing",
      "warning",
      sourceFile,
      row.line,
      sourceName,
      "name",
      sourceName,
      "aucun alias explicite; identifiant de provenance conservé"
    ));
  }

  const side = parseSide(row.sideRaw);
  if (!side) {
    context.errors.push(issue(
      "perk_side_invalid", "error", sourceFile, row.line, name, "side", row.sideRaw, "side doit valoir 0 ou 1"
    ));
    return null;
  }

  const categories = parseCategories(row, sourceFile, context.warnings, context.errors);
  const cooldown = parseCooldown(row, sourceFile, context.errors);
  const parsedEffects = parseLegacyEffects(row.effectRaw);
  const effects = PERK_EFFECT_OVERRIDES[id] ?? parsedEffects.effects;
  for (const warning of parsedEffects.warnings) {
    context.warnings.push(issue(
      "effect_syntax_normalized",
      "warning",
      sourceFile,
      row.line,
      name,
      "effect",
      warning.token,
      warning.reason
    ));
  }
  for (const unresolved of parsedEffects.unresolved) {
    context.unparsedEffects.push({
      perkId: id,
      name,
      line: row.line,
      raw: row.effectRaw,
      reason: unresolved.reason,
      token: unresolved.token
    });
  }

  const character = resolveCharacter(context, id, name);
  const icon = resolveIcon(context, id, name, alias);
  const richDescription = resolveDescription(context, name, alias);
  const effectImportStatus = effects.length === 0
    ? "unparsed"
    : parsedEffects.unresolved.length > 0 && !PERK_EFFECT_OVERRIDES[id] ? "partial" : "parsed";
  const analysisReadiness = effects.length === 0
    ? "unavailable"
    : effects.every((effect) => effect.interpretation === "verified") ? "ready" : "partial";

  if (categories.includes("recharge") && cooldown === null) {
    context.warnings.push(issue(
      "cooldown_missing_for_recharge_category",
      "warning",
      sourceFile,
      row.line,
      name,
      "recharge",
      row.cooldownRaw,
      "la catégorie recharge est présente mais aucun cooldown fiable n'est fourni"
    ));
  } else if (!categories.includes("recharge") && cooldown !== null) {
    context.warnings.push(issue(
      "cooldown_without_recharge_category",
      "warning",
      sourceFile,
      row.line,
      name,
      "recharge",
      row.cooldownRaw,
      "un cooldown est fourni sans la catégorie recharge"
    ));
  }

  return {
    id,
    name: { fr: name, en: alias?.nameEn ?? null },
    side,
    categories,
    characterId: character.id,
    characterResolution: character.resolution,
    icon,
    description: { fr: richDescription, en: null },
    effects: [...effects],
    cooldown,
    effectImportStatus,
    analysisReadiness,
    provenance: { file: sourceFile, line: row.line }
  };
}

function parseSide(raw: string): PerkSide | null {
  if (raw.trim() === "1") return "killer";
  if (raw.trim() === "0") return "survivor";
  return null;
}

function parseCategories(
  row: ParsedPerkRow,
  file: string,
  warnings: ImportIssue[],
  errors: ImportIssue[]
): PerkCategory[] {
  const categories: PerkCategory[] = [];
  const seen = new Set<string>();
  for (const rawCategory of row.categoriesRaw.split(",")) {
    const trimmed = rawCategory.trim();
    const normalized = trimmed === "survivant_transport" ? "hook" : trimmed;
    if (trimmed === "survivant_transport") {
      warnings.push(issue(
        "category_renamed",
        "warning",
        file,
        row.line,
        row.nameRaw,
        "category",
        trimmed,
        "survivant_transport normalisé en hook"
      ));
    }
    if (!PERK_CATEGORY_SET.has(normalized)) {
      errors.push(issue(
        "category_unknown",
        "error",
        file,
        row.line,
        row.nameRaw,
        "category",
        trimmed,
        "catégorie inconnue exclue de la donnée nettoyée"
      ));
      continue;
    }
    if (seen.has(normalized)) {
      warnings.push(issue(
        "category_duplicate_removed",
        "warning",
        file,
        row.line,
        row.nameRaw,
        "category",
        normalized,
        "catégorie dupliquée supprimée"
      ));
      continue;
    }
    seen.add(normalized);
    categories.push(normalized as PerkCategory);
  }
  return categories;
}

function parseCooldown(row: ParsedPerkRow, file: string, errors: ImportIssue[]): number | null {
  if (isNullToken(row.cooldownRaw)) return null;
  const cooldown = Number(row.cooldownRaw);
  if (Number.isFinite(cooldown) && cooldown >= 0) return cooldown;
  errors.push(issue(
    "cooldown_invalid",
    "error",
    file,
    row.line,
    row.nameRaw,
    "recharge",
    row.cooldownRaw,
    "cooldown non numérique; valeur laissée à null"
  ));
  return null;
}

function resolveCharacter(context: ParsePerkContext, perkId: string, name: string): {
  id: string | null;
  resolution: "resolved" | "general" | "unresolved";
} {
  const raw = context.row.characterRaw.trim();
  if (isNullToken(raw)) return { id: null, resolution: "general" };

  const alias = Object.entries(CHARACTER_ALIASES).find(
    ([source]) => normalizeWords(source) === normalizeWords(raw)
  );
  const resolvedName = alias?.[1] ?? raw;
  if (alias) {
    context.warnings.push(issue(
      "character_alias_applied",
      "warning",
      context.sourceFile,
      context.row.line,
      name,
      "character",
      raw,
      `${raw} normalisé en ${resolvedName}`
    ));
  }
  const killer = context.killerIndex.get(normalizeWords(resolvedName));
  if (killer) return { id: killer.id, resolution: "resolved" };

  context.unresolvedCharacters.push({
    perkId,
    name,
    line: context.row.line,
    raw,
    reason: "aucun killer valide ne correspond exactement à ce personnage"
  });
  return { id: null, resolution: "unresolved" };
}

function resolveIcon(
  context: ParsePerkContext,
  perkId: string,
  name: string,
  alias: PerkAlias | null
): string | null {
  const raw = context.row.iconRaw.trim();
  const iconFile = alias?.iconFile ?? null;
  if (iconFile && context.iconFiles.has(iconFile)) {
    context.usedIconFiles.add(iconFile);
    return posix.join(context.iconDirectory, iconFile);
  }

  context.unresolvedIcons.push({
    perkId,
    name,
    line: context.row.line,
    raw: isNullToken(raw) ? null : raw,
    reason: iconFile
      ? "l'icône déclarée dans le mapping est absente du dossier"
      : "aucune icône explicite sûre n'est disponible dans le snapshot"
  });
  return null;
}

function resolveDescription(
  context: ParsePerkContext,
  name: string,
  alias: PerkAlias | null
): RichDescription | null {
  const raw = context.row.descriptionRaw.trim();
  if (!isNullToken(raw)) {
    return plainDescription(raw);
  }
  const descriptionName = alias?.descriptionNameFr ?? name;
  const record = context.descriptionIndex.get(normalizeLookup(descriptionName));
  if (!record) return null;
  context.matchedDescriptionIds.add(record.id);
  return record.description;
}

function plainDescription(value: string): RichDescription {
  return {
    version: 1,
    blocks: [{ type: "paragraph", children: [{ type: "text", value }] }]
  };
}

function uniqueIndex<T>(values: readonly T[], key: (value: T) => string): Map<string, T | null> {
  const index = new Map<string, T | null>();
  for (const value of values) {
    const normalized = key(value);
    if (index.has(normalized)) index.set(normalized, null);
    else index.set(normalized, value);
  }
  return index;
}

function aliasIndex<T extends { readonly sourceNameFr: string }>(
  values: readonly T[]
): Map<string, T | null> {
  return uniqueIndex(values, (value) => normalizeLookup(value.sourceNameFr));
}

function unresolvedReference(perk: Perk, raw: string | null, reason: string): UnresolvedPerkReference {
  return {
    perkId: perk.id,
    name: perk.name.fr ?? perk.id,
    line: perk.provenance?.line ?? 0,
    raw,
    reason
  };
}

function issue(
  code: string,
  severity: "warning" | "error",
  file: string,
  line: number | null,
  entity: string | null,
  field: string | null,
  raw: string | null,
  message: string
): ImportIssue {
  return { code, severity, file, line, entity, field, raw, message };
}

function sortIssues(issues: ImportIssue[]): void {
  issues.sort((left, right) =>
    left.file.localeCompare(right.file)
    || (left.line ?? 0) - (right.line ?? 0)
    || left.code.localeCompare(right.code)
    || (left.entity ?? "").localeCompare(right.entity ?? "")
  );
}

function byLine(left: { line: number }, right: { line: number }): number {
  return left.line - right.line;
}
