import type { Perk } from "../domain/perk.js";
import { perkDescriptionToText } from "./openai-build-assistant.js";

export function perkCooldown(perk: Perk, descriptionHtml?: string): number | null {
  const text = perkDescriptionToText(perk, descriptionHtml).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
  // Une recharge d’objet ou de jetons n’est pas un délai de réutilisation de la perk.
  const match = /(?:temps de (?:recharge|refroidissement)|\brecharge(?:\s*ment)?\s*:?\s*(?=\d)|se recharge pendant|la recharge dure|cooldown)[^.!;\d]{0,65}(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)*)\s*(?:secondes?|s\b)/.exec(text);
  if (match?.[1]) return Number(match[1].split("/").at(-1)!.trim().replace(",", "."));
  const hasDescription = Boolean(perkDescriptionToText(perk, descriptionHtml).trim());
  return hasDescription ? null : perk.cooldown;
}
