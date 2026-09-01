import type {
  RichDescription,
  RichDescriptionBlock,
  RichInlineNode
} from "../domain/rich-description.js";
import { sourceId } from "./normalize.js";
import type { ImportedDescriptionRecord, ImportIssue } from "./types.js";

export interface DescriptionParseResult {
  records: ImportedDescriptionRecord[];
  issues: ImportIssue[];
}

interface PendingDescription {
  line: number;
  nameRaw: string;
  alternateNameRaw: string;
  bodyLines: string[];
}

export function parseDescriptionSource(
  content: string,
  file = "description_categories.txt"
): DescriptionParseResult {
  const records: ImportedDescriptionRecord[] = [];
  const issues: ImportIssue[] = [];
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  let pending: PendingDescription | null = null;

  const flush = (): void => {
    if (!pending) return;
    const extracted = extractMetadata(pending.bodyLines);
    if (extracted.removedZeroWidthCharacters > 0) {
      issues.push({
        code: "description_zero_width_removed",
        severity: "warning",
        file,
        line: pending.line,
        entity: pending.nameRaw,
        field: "description",
        raw: null,
        message: `${extracted.removedZeroWidthCharacters} caractère(s) U+200B supprimé(s)`
      });
    }
    if (!extracted.characterRaw) {
      issues.push({
        code: "description_owner_missing",
        severity: "warning",
        file,
        line: pending.line,
        entity: pending.nameRaw,
        field: "character",
        raw: null,
        message: "propriétaire de la description absent ou non identifiable"
      });
    }
    const crossReference = extracted.bodyLines.find((line) => /^\s*Identique à(?:\s|$)/iu.test(line));
    if (crossReference) {
      issues.push({
        code: "description_cross_reference",
        severity: "warning",
        file,
        line: pending.line,
        entity: pending.nameRaw,
        field: "description",
        raw: crossReference.trim(),
        message: "description constituée d'un renvoi à résoudre par un alias explicite"
      });
    }
    const embeddedIconLines = extracted.bodyLines.filter(hasUnresolvedIconReference);
    if (embeddedIconLines.length > 0) {
      issues.push({
        code: "description_embedded_icon_unresolved",
        severity: "warning",
        file,
        line: pending.line,
        entity: pending.nameRaw,
        field: "description",
        raw: null,
        message: `${embeddedIconLines.length} ligne(s) contiennent une référence PNG collée au texte`
      });
    }

    records.push({
      id: sourceId("description", pending.line),
      nameRaw: pending.nameRaw,
      alternateNameRaw: pending.alternateNameRaw,
      characterRaw: extracted.characterRaw,
      portraitRaw: extracted.portraitRaw,
      description: toRichDescription(extracted.bodyLines, pending.nameRaw, pending.alternateNameRaw),
      provenance: { file, line: pending.line }
    });
    pending = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const columns = line.split("\t");
    if (columns.length >= 3 && columns[0]?.trim() && columns[1]?.trim()) {
      flush();
      pending = {
        line: index + 1,
        nameRaw: columns[0].trim(),
        alternateNameRaw: columns[1].trim(),
        bodyLines: [columns.slice(2).join("\t")]
      };
    } else if (pending) {
      pending.bodyLines.push(line);
    } else if (line.trim()) {
      issues.push({
        code: "description_preamble_ignored",
        severity: "warning",
        file,
        line: index + 1,
        entity: null,
        field: null,
        raw: line,
        message: "texte trouvé avant le premier enregistrement"
      });
    }
  }
  flush();

  return { records, issues };
}

function extractMetadata(lines: string[]): {
  bodyLines: string[];
  characterRaw: string | null;
  portraitRaw: string | null;
  removedZeroWidthCharacters: number;
} {
  let removedZeroWidthCharacters = 0;
  const bodyLines = lines.map((line) => {
    const matches = line.match(/\u200B/g);
    removedZeroWidthCharacters += matches?.length ?? 0;
    return line.replace(/\u200B/g, "");
  });
  trimTrailingBlanks(bodyLines);

  let portraitRaw: string | null = null;
  const lastLine = bodyLines.at(-1)?.trim() ?? "";
  if (/^K\d{2}\b.*\.png$/i.test(lastLine)) {
    portraitRaw = lastLine;
    bodyLines.pop();
    trimTrailingBlanks(bodyLines);
  }

  let characterRaw: string | null = null;
  const metadataCandidate = bodyLines.at(-1) ?? "";
  const tabParts = metadataCandidate.split("\t");
  if (tabParts.length >= 2) {
    const possibleCharacter = tabParts.at(-1)?.trim() ?? "";
    if (possibleCharacter) {
      characterRaw = possibleCharacter;
      const remaining = tabParts.slice(0, -1).join("\t").trimEnd();
      if (remaining) bodyLines[bodyLines.length - 1] = remaining;
      else bodyLines.pop();
    }
  } else if (looksLikeOwner(metadataCandidate, portraitRaw !== null)) {
    characterRaw = metadataCandidate.trim();
    bodyLines.pop();
  }

  trimTrailingBlanks(bodyLines);
  return { bodyLines, characterRaw, portraitRaw, removedZeroWidthCharacters };
}

function looksLikeOwner(value: string, hasPortrait: boolean): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed === "Tous") return true;
  return hasPortrait
    && trimmed.length <= 40
    && !trimmed.includes(".png")
    && !/[.!?;:«»]/.test(trimmed);
}

function trimTrailingBlanks(lines: string[]): void {
  while (lines.length > 0 && !lines.at(-1)?.trim()) lines.pop();
}

function toRichDescription(lines: string[], ...perkNames: string[]): RichDescription {
  const items: RichInlineNode[][] = [];
  let currentItem: string | null = null;
  let insideQuote = false;

  const flushCurrentItem = (): void => {
    if (!currentItem) return;
    const simplified = simplifyDescriptionItem(currentItem, perkNames);
    if (simplified) items.push(parseInlineNodes(simplified));
    currentItem = null;
  };

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (insideQuote) {
      if (closesQuote(line)) insideQuote = false;
      continue;
    }
    if (line.startsWith("«")) {
      flushCurrentItem();
      insideQuote = !closesQuote(line);
      continue;
    }
    const trailingQuote = line.indexOf("«");
    if (trailingQuote > 0 && /[.!?]\s*$/.test(line.slice(0, trailingQuote))) {
      line = line.slice(0, trailingQuote).trimEnd();
    }
    if (!line) {
      flushCurrentItem();
      continue;
    }

    if (currentItem && (hasOnlyInlineIconRefs(line) || endsWithInlineIconRef(currentItem) || isContinuation(line))) {
      currentItem = appendText(currentItem, line);
      continue;
    }

    flushCurrentItem();
    currentItem = line;
  }

  flushCurrentItem();

  const blocks: RichDescriptionBlock[] = items.length > 0
    ? [{ type: "list", ordered: false, items }]
    : [];

  return { version: 1, blocks };
}

function appendText(target: string, value: string): string {
  if (!target) return value;
  if (!value) return target;
  const joiner = /^[,.;:!?)]/.test(value) ? "" : " ";
  return `${target}${joiner}${value}`;
}

function isCondition(value: string): boolean {
  return /^(?:lorsqu(?:e|['’])|lors de|chaque fois|à chaque fois|après\b|au début|à moins|dès qu|tant que|si\b|une fois|pendant que|quand\b|en (?:transportant|franchissant|poursuite)|pour chaque|toutes les|à partir de|à \d)/iu.test(value);
}

function isContinuation(value: string): boolean {
  return /^[,.;:!?]|^[a-zàâäçéèêëîïôöùûüÿœ]/u.test(value);
}

function closesQuote(value: string): boolean {
  return value.includes("»") || /\.[»"](?:\s|$)/u.test(value);
}

function hasOnlyInlineIconRefs(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed) && trimmed.replace(INLINE_ICON_REFERENCE, "").trim().length === 0;
}

function endsWithInlineIconRef(value: string): boolean {
  const matches = [...value.matchAll(INLINE_ICON_REFERENCE)];
  const last = matches.at(-1);
  return last !== undefined && last.index !== undefined && last.index + last[0].length === value.length;
}

function simplifyDescriptionItem(value: string, perkNames: readonly string[]): string | null {
  let text = value.replace(INLINE_ICON_REFERENCE, " ");
  text = text.replace(/\b([cdjlmnst])['’]\s+/giu, "$1'");
  text = text.replace(/\s+/g, " ");
  text = text.replace(/\s+([,.;:!?)])/g, "$1");
  text = text.replace(/([(])\s+/g, "$1");
  text = text.replace(/\s+([/])/g, " $1");
  text = text.replace(/([/])\s+/g, "$1 ");
  text = text.trim();

  if (!text) return null;

  text = dropPerkNamesInActivation(text, perkNames);
  text = text.replace(/\bEffets? de statut\b/giu, "");
  text = text.replace(/\s{2,}/g, " ").trim();

  if (isDiscardableIntro(text)) return null;
  if (/^Provoque les souffrances de tous les survivants/iu.test(text) && /exposition/iu.test(text)) {
    return "Tous les survivants deviennent exposés.";
  }
  if (/^Au début de l['’]épreuve, les auras de /iu.test(text) && /vous sont révél/iu.test(text)) {
    return text.replace(
      /^Au début de l['’]épreuve, les auras de (.+?) vous sont révélés? pendant ([^.]+)\.?$/iu,
      "Au début de l'épreuve, vous voyez les auras de $1 pendant $2."
    );
  }
  if (/^Vous voyez les /iu.test(text) && /vous sont révél/iu.test(text)) {
    return text
      .replace(/^Vous voyez les auras tous les autres\b/iu, "Vous voyez les auras de tous les autres")
      .replace(/^Vous voyez les auras (.+?) vous sont révélés? pendant ([^.]+)\.?$/iu, "Vous voyez les auras $1 pendant $2.")
      .replace(/^Vous voyez les (.+?) vous sont révélés? pendant ([^.]+)\.?$/iu, "Vous voyez les $1 pendant $2.");
  }
  if (/^Prolonge de /iu.test(text) && /occurrences d['’]une aura de survivant qui vous est révélée\.?$/iu.test(text)) {
    return text.replace(
      /^Prolonge de (\+?\d+) secondes la durée de toutes les occurrences d['’]une aura de survivant qui vous est révélée\.?$/iu,
      "Prolonge de $1 secondes la durée de toutes les révélations d'aura de survivant."
    );
  }
  if (/^Prolonge de /iu.test(text) && /occurrences d['’]une aura de survivant qui\.?$/iu.test(text)) {
    return text.replace(
      /^Prolonge de (\+?\d+) secondes la durée de toutes les occurrences d['’]une aura de survivant qui\.?$/iu,
      "Prolonge de $1 secondes la durée de toutes les révélations d'aura de survivant."
    );
  }

  text = text
    .replace(/^À chaque fois qu['’]un générateur\s+Une fois\b/iu, "Une fois")
    .replace(/^Lorsqu['’]un générateur\s+Une fois\b/iu, "Une fois")
    .replace(/^Chaque fois qu['’]un survivant perd un état de santé\s+Quoi qu['’]il en soit,\s*/iu, "Quand un survivant perd un état de santé, ")
    .replace(/^Lorsqu['’]un survivant est transporté\s*:\s*$/iu, "Quand vous transportez un survivant :")
    .replace(/^Lorsque vous transportez un survivant\s*:\s*$/iu, "Quand vous transportez un survivant :")
    .replace(/^Chaque fois que vous accrochez un survivant\s*:\s*$/iu, "Quand vous accrochez un survivant :")
    .replace(/^Après avoir accroché un survivant\s*:\s*$/iu, "Après avoir accroché un survivant :")
    .replace(/^Lors de l['’]exécution de l['’]action\s+/iu, "Quand vous ")
    .replace(/^Confère un bonus de ([+-]?\d+(?:[,.]\d+)?\s*%) à la hâte\b/iu, "Vous gagnez $1 de vitesse")
    .replace(/^Confère ([+-]?\d+(?:[,.]\d+)?\s*%) à la hâte\b/iu, "Vous gagnez $1 de vitesse")
    .replace(/^Confère un bonus de hâte de\s+([\d.,/ ]+%)(?:\s+pendant\s+([^.]+))?\.?$/iu, (_match, amount: string, duration?: string) =>
      duration ? `Vous gagnez ${amount.trim()} de vitesse pendant ${duration.trim()}` : `Vous gagnez ${amount.trim()} de vitesse`
    )
    .replace(/^Confère un bonus de hâte de (.+?)\.?$/iu, (_match, amount: string) => `Vous gagnez ${amount.trim()} de vitesse`)
    .replace(/^Accorde l['’]indétectable\b/iu, "Vous devenez indétectable")
    .replace(/\bvous obtenez l['’]indétectabilité\b/iu, "vous devenez indétectable")
    .replace(/^Provoque chez ce survivant (?:le syndrome de )?l['’]inconscient\b/iu, "Ce survivant devient inconscient")
    .replace(/^Provoque .*?l['’]exposition\.*$/iu, "Tous les survivants deviennent exposés")
    .replace(/^Provoque les souffrances de tous les survivants dues à l['’]exposition\.*$/iu, "Tous les survivants deviennent exposés")
    .replace(/^Le .* a un temps de recharge de ([^.]+)\.?$/iu, "Temps de recharge : $1.")
    .replace(/^Prolonge de \+?(\d+) secondes la durée de toutes les occurrences d['’]une aura de survivant qui\.?$/iu, "Prolonge de +$1 secondes la durée de toutes les révélations d'aura de survivant")
    .replace(/^Les auras\s+Les\s+/iu, "Vous voyez les ")
    .replace(/^Les auras\s+/iu, "Vous voyez les auras ")
    .replace(/^L['’]aura\s+/iu, "Vous voyez l'aura ")
    .replace(/les auras de (.+?) vous sont révélé(?:e|é)s? pendant ([^.]+)\.?$/iu, "vous voyez les auras de $1 pendant $2")
    .replace(/^Vous voyez les (.+?) vous sont révélé(?:e|é)s? pendant ([^.]+)\.?$/iu, "Vous voyez les $1 pendant $2")
    .replace(/^Vous voyez les auras (.+?) vous sont révélé(?:e|é)s? pendant ([^.]+)\.?$/iu, "Vous voyez les auras $1 pendant $2")
    .replace(/^Vous voyez l['’]aura (.+?) vous est révélé(?:e|é)? pendant ([^.]+)\.?$/iu, "Vous voyez l'aura $1 pendant $2")
    .replace(/^Au début de l['’]épreuve, les auras de (.+?) vous sont révélé(?:e|é)s? pendant ([^.]+)\.?$/iu, "Au début de l'épreuve, vous voyez les auras de $1 pendant $2")
    .replace(/^Une fois l['’]\s+révélé aux survivants, .+? déclenche l['’]effet suivant\s*:?$/iu, "Une fois révélé aux survivants :")
    .replace(/^Vous voyez l['’]aura de (.+?) est révélée à tous les survivants dans un rayon de ([^.]+)\.?$/iu, "Tous les survivants voient l'aura de $1 dans un rayon de $2")
    .replace(/\s+vous sont révélées?\b/iu, "")
    .replace(/\s+vous est révélée?\b/iu, "")
    .replace(/\s+en jaune\b/iu, "")
    .replace(/^Vous voyez les auras tous les autres\b/iu, "Vous voyez les auras de tous les autres")
    .replace(/^(Vous voyez les(?: auras)? .+?) vous sont révélés pendant ([^.]+)\.?$/iu, "$1 pendant $2")
    .replace(/^Vous voyez vous voyez\s+/iu, "Vous voyez ")
    .replace(/,\s*:\s*$/u, ":")
    .replace(/^Blocs tous les palettes debout à moins de ([^.]+)\.?$/iu, "Bloque toutes les palettes encore debout à moins de $1")
    .replace(/\bPour tous les survivants\b/iu, "pour tous les survivants")
    .replace(/\bson effet principal\b/iu, "l'effet principal")
    .replace(/\bson effet secondaire\b/iu, "l'effet secondaire")
    .replace(/\bpendant que le\b/iu, "tant que le");

  text = text.replace(/\s{2,}/g, " ").trim();
  text = text.replace(/\s+([,.;:!?)])/g, "$1");

  if (!text) return null;
  if (!/[.!?]$/.test(text) && !/:$/.test(text)) text += ".";
  return text;
}

function dropPerkNamesInActivation(value: string, perkNames: readonly string[]): string {
  const escaped = perkNames
    .map((name) => name.trim())
    .filter((name, index, values) => Boolean(name) && values.indexOf(name) === index)
    .map(escapeRegExp);
  if (escaped.length === 0) return normalizeActivationPhrases(value);

  const perkPattern = `(?:${escaped.join("|")})`;
  return normalizeActivationPhrases(
    value
      .replace(new RegExp(`,\\s*${perkPattern}\\s+s['’]active pendant\\s+([^:]+)\\s*:$`, "iu"), ", l'effet dure $1")
      .replace(new RegExp(`,\\s*${perkPattern}\\s+s['’]active\\s*:$`, "iu"), " :")
      .replace(new RegExp(`,\\s*${perkPattern}\\s+déclenche(?: l['’]| son)? effet(?: principal| secondaire)?\\s*:$`, "iu"), " :")
      .replace(new RegExp(`,\\s*${perkPattern}\\s+fait appel à l['’]entité\\s+pour l['’]effet suivant\\s*:$`, "iu"), " :")
      .replace(new RegExp(`,\\s*l['’]${perkPattern}\\s+lui applique ses effets pendant\\s+([^:]+)\\s*:$`, "iu"), ", l'effet dure $1")
  );
}

function normalizeActivationPhrases(value: string): string {
  return value
    .replace(/,\s+vous bénéficiez de l['’]effet suivant\s*:?$/iu, " :")
    .replace(/,\s+vous bénéficiez des effets suivants\s*:?$/iu, " :")
    .replace(/\s+pour l['’]effet suivant\s*:?$/iu, " :")
    .replace(/\s+pour déclencher l['’]effet suivant\s*:?$/iu, " :")
    .replace(/\s+son effet principal se déclenche\s*:?$/iu, " :")
    .replace(/\s+son effet secondaire se déclenche\s*:?$/iu, " :")
    .replace(/\s+l'effet principal se déclenche\s*:?$/iu, " :")
    .replace(/\s+l'effet secondaire se déclenche\s*:?$/iu, " :")
    .replace(/,?\s+la perk s['’]active pendant\s+([^:]+)\s*:?$/iu, ", l'effet dure $1")
    .replace(/,?\s+la perk s['’]active\s*:?$/iu, " :")
    .replace(/,?\s+la perk déclenche son effet\s*:?$/iu, " :")
    .replace(/,\s+[^,]+ déclenche son effet pendant\s+([^:]+)\s*:?$/iu, ", l'effet dure $1")
    .replace(/,\s+[^,]+ s['’]active pendant\s+([^:]+)\s*:?$/iu, ", l'effet dure $1")
    .replace(/,\s+[^,]+ s['’]active\s*:?$/iu, " :")
    .replace(/,\s+[^,]+ déclenche(?: son)? effet(?: principal| secondaire)?\s*:?$/iu, " :");
}

function isDiscardableIntro(value: string): boolean {
  return [
    /^(?:libère|développe) le potentiel de votre capacité à lire l['’]aura[.:]?$/iu,
    /^un lien profond avec l['’]entité .* capacité à lire l['’]aura\.?$/iu,
    /^vous bénéficiez de l['’]effet permanent suivant[.:]?$/iu,
    /^[a-zà-ÿ' -]+ provoque les effets suivants\s*:?$/iu,
    /^vos prières invoquent une force obscure qui compromet les chances de survie des survivants\.?$/iu
  ].some((pattern) => pattern.test(value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseInlineNodes(value: string): RichInlineNode[] {
  const nodes: RichInlineNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(INLINE_ICON_REFERENCE)) {
    const sourceName = match[0];
    const index = match.index;
    if (index > cursor) nodes.push({ type: "text", value: value.slice(cursor, index) });
    nodes.push({ type: "icon", sourceName, ref: null, alt: iconAlt(sourceName) });
    cursor = index + sourceName.length;
  }
  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes.length > 0 ? nodes : [{ type: "text", value }];
}

const INLINE_ICON_REFERENCE = /(?:Effets d['’]état de l['’]icône|Aide à l['’]icône|IcôneAide|IcôneHelp|Icône d['’]aide|Éléments d['’]aide de l['’]icône|IconHelp|IconPerks|IconStatusEffects|Fenêtre d['’]aide)[^.\n]*?\.png/giu;

function isStandaloneIcon(value: string): boolean {
  return /^[^.!?\n]*\.png$/i.test(value) && value.length <= 120;
}

function hasUnresolvedIconReference(value: string): boolean {
  return /\.png/i.test(value.replace(INLINE_ICON_REFERENCE, "")) && !isStandaloneIcon(value.trim());
}

function iconAlt(sourceName: string): string {
  return sourceName
    .replace(/\.png$/i, "")
    .replace(/^(?:Icon|Icône|Aide|Effets d'état de l'icône)\s*/i, "")
    .trim() || "icône";
}

export function descriptionText(description: RichDescription): string {
  return description.blocks
    .flatMap((block) => block.type === "list" ? block.items.flat() : block.children)
    .filter((node): node is Extract<RichInlineNode, { type: "text" }> => node.type === "text")
    .map((node) => node.value)
    .join("\n");
}
