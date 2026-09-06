import type { Killer } from "../domain/killer.js";
import type { Perk } from "../domain/perk.js";
import type { CurrentBuildExport } from "./local-data.js";
import { richDescriptionToText } from "./openai-build-assistant.js";

export interface NativeChatKnowledge {
  howToPlay: string;
  constants: string;
  killers: readonly Killer[];
  perks: readonly Perk[];
  perkDescriptionOverrides: Readonly<Record<string, string>>;
  killerPowerDescription: (killer: Killer) => string;
}

export function buildNativeChatPrompt(
  question: string,
  currentBuild: CurrentBuildExport,
  knowledge: NativeChatKnowledge
): string {
  const killerSections = knowledge.killers.map((killer) => {
    const associatedPerks = knowledge.perks
      .filter((perk) => perk.characterId === killer.id)
      .map(perkName)
      .join(", ") || "Aucune perk associée renseignée.";
    return [
      `## ${localizedName(killer.name, killer.id)}`,
      `Identifiant : ${killer.id}`,
      `Statistiques : vitesse ${killer.speed} m/s ; rayon de terreur ${killer.terrorRadius} m ; taille ${killer.size} ; tier ${killer.tier} ; difficulté ${killer.difficulty}.`,
      `Perks associées : ${associatedPerks}`,
      "Capacité / pouvoir :",
      knowledge.killerPowerDescription(killer)
    ].join("\n");
  }).join("\n\n");

  const perkSections = knowledge.perks.map((perk) => [
    `## ${localizedName(perk.name, perk.id)}`,
    `Identifiant : ${perk.id}`,
    `Description : ${perkDescription(perk, knowledge.perkDescriptionOverrides[perk.id]) || "Non disponible."}`
  ].join("\n")).join("\n\n");

  return [
    "Tu es un expert de Dead by Daylight chargé d'analyser et d'optimiser le build actuel.",
    "Réponds en français en t'appuyant en priorité sur le contexte ci-dessous. N'invente aucune donnée absente et signale clairement les informations manquantes ou contradictoires.",
    "",
    "=== 1. HOW TO PLAY ===",
    knowledge.howToPlay.trim(),
    "",
    "=== 2. CONSTANTES ===",
    knowledge.constants.trim(),
    "",
    "=== 3. TUEURS ===",
    killerSections,
    "",
    "=== 4. PERKS ===",
    perkSections,
    "",
    "=== 5. BUILD ACTUEL ===",
    JSON.stringify(currentBuild, null, 2),
    "",
    "=== 6. QUESTION DE L'UTILISATEUR ===",
    question.trim()
  ].join("\n");
}

function localizedName(name: Killer["name"], fallback: string): string {
  const primary = name.fr ?? name.en ?? fallback;
  return name.en && name.en !== primary ? `${primary} (${name.en})` : primary;
}

function perkName(perk: Perk): string {
  return localizedName(perk.name, perk.id);
}

function perkDescription(perk: Perk, localOverride?: string): string {
  const html = localOverride ?? perk.nativeDescriptionHtml;
  return html ? htmlToText(html) : richDescriptionToText(perk.description.fr ?? perk.description.en);
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<li(?:\s[^>]*)?>/gi, "- ")
    .replace(/<\/(?:p|div|li|ul|ol|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
