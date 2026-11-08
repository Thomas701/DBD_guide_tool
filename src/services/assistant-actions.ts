import { validateBuildDraft, type Build, type BuildDraft } from "../domain/build.js";
import { KILLER_TIERS, type Killer, type KillerTier } from "../domain/killer.js";
import type { Perk } from "../domain/perk.js";
import type { CurrentBuildExport } from "./local-data.js";
import { perkDescriptionToText } from "./openai-build-assistant.js";

type AssistantBuildDraft = Required<BuildDraft>;
export type AssistantAction =
  | { type: "update_perk_description"; perkId: string; descriptionHtml: string }
  | { type: "set_killer_tier"; killerId: string; tier: KillerTier }
  | { type: "set_perk_tier"; perkId: string; tier: KillerTier }
  | ({ type: "save_build"; buildId: string | null } & AssistantBuildDraft)
  | ({ type: "set_current_build" } & AssistantBuildDraft);

export interface AssistantResponse {
  answer: string;
  actions: AssistantAction[];
}

export interface AssistantActionCatalog {
  killers: readonly Killer[];
  survivors: readonly Killer[];
  perks: readonly Perk[];
  builds: readonly Build[];
}

export interface AssistantActionSnapshot {
  currentBuild: CurrentBuildExport;
  savedBuilds: readonly Build[];
  perks: readonly Perk[];
  perkDescriptionOverrides: Readonly<Record<string, string>>;
}

export function validateAssistantSnapshot(actions: readonly AssistantAction[], before: AssistantActionSnapshot, current: AssistantActionSnapshot): void {
  for (const action of actions) {
    if (action.type === "set_current_build" && JSON.stringify(before.currentBuild.build) !== JSON.stringify(current.currentBuild.build)) throw new Error("Le build courant a changé pendant la réponse. Relancez la demande pour conserver vos modifications.");
    if (action.type === "save_build" && action.buildId !== null
      && JSON.stringify(before.savedBuilds.find(({ id }) => id === action.buildId)) !== JSON.stringify(current.savedBuilds.find(({ id }) => id === action.buildId))) {
      throw new Error("Cette sauvegarde a changé pendant la réponse. Relancez la demande pour conserver vos modifications.");
    }
    if (action.type === "update_perk_description") {
      const previous = before.perks.find(({ id }) => id === action.perkId);
      const latest = current.perks.find(({ id }) => id === action.perkId);
      if (previous && latest && perkDescriptionToText(previous, before.perkDescriptionOverrides[action.perkId]) !== perkDescriptionToText(latest, current.perkDescriptionOverrides[action.perkId])) {
        throw new Error("Cette description a changé pendant la réponse. Relancez la demande pour conserver vos modifications.");
      }
    }
  }
}

export function parseAssistantResponse(value: unknown): AssistantResponse {
  if (!isRecord(value) || typeof value.answer !== "string" || !value.answer.trim()
    || !Array.isArray(value.actions) || value.actions.length > 50 || !value.actions.every(isAssistantAction)) {
    throw new Error("Réponse de l’assistant invalide : aucune action appliquée.");
  }
  return { answer: value.answer, actions: value.actions };
}

export function validateAssistantActions(actions: readonly AssistantAction[], catalog: AssistantActionCatalog): void {
  if (actions.length > 50 || !actions.every(isAssistantAction)) throw new Error("Actions de l’assistant invalides.");
  const killerIds = new Set(catalog.killers.map(({ id }) => id));
  const survivorIds = new Set(catalog.survivors.map(({ id }) => id));
  const perksById = new Map(catalog.perks.map((perk) => [perk.id, perk]));
  const buildIds = new Set(catalog.builds.map(({ id }) => id));
  for (const action of actions) {
    if (action.type === "update_perk_description" || action.type === "set_perk_tier") {
      if (!perksById.has(action.perkId)) throw new Error(`Perk inconnue : ${action.perkId}`);
    } else if (action.type === "set_killer_tier") {
      if (!killerIds.has(action.killerId)) throw new Error(`Tueur inconnu : ${action.killerId}`);
    } else {
      if (validateBuildDraft(action).length > 0 || action.name.length > 80) throw new Error(`Build invalide : ${action.name}`);
      if (!(action.side === "survivor" ? survivorIds : killerIds).has(action.killerId)) throw new Error(`Personnage inconnu pour ce camp : ${action.killerId}`);
      if (action.perkIds.some((id) => perksById.get(id)?.side !== action.side)) throw new Error("Un build doit utiliser les perks de son camp.");
      if (action.type === "save_build" && action.buildId !== null && !buildIds.has(action.buildId)) throw new Error(`Build introuvable : ${action.buildId}`);
    }
  }
}

export function applyAssistantActions(actions: readonly AssistantAction[], catalog: AssistantActionCatalog, targets: {
  updateDescription: (perkId: string, html: string) => void;
  updateKillerTier: (killerId: string, tier: KillerTier) => void;
  updatePerkTier: (perkId: string, tier: KillerTier) => void;
  saveBuild: (action: Extract<AssistantAction, { type: "save_build" }>) => void;
  setCurrentBuild: (action: Extract<AssistantAction, { type: "set_current_build" }>) => void;
}): string[] {
  validateAssistantActions(actions, catalog);
  return actions.map((action) => {
    try {
      switch (action.type) {
        case "update_perk_description":
          targets.updateDescription(action.perkId, action.descriptionHtml);
          return `Description mise à jour : ${perkName(action.perkId)}.`;
        case "set_killer_tier":
          targets.updateKillerTier(action.killerId, action.tier);
          return `Tier ${action.tier} : ${catalog.killers.find(({ id }) => id === action.killerId)?.name.fr ?? action.killerId}.`;
        case "set_perk_tier":
          targets.updatePerkTier(action.perkId, action.tier);
          return `Tier ${action.tier} : ${perkName(action.perkId)}.`;
        case "save_build":
          targets.saveBuild(action);
          return `Build ${action.buildId === null ? "créé et sauvegardé" : "modifié et sauvegardé"} (${action.side === "survivor" ? "survivant" : "tueur"}) : ${action.name}.`;
        case "set_current_build":
          targets.setCurrentBuild(action);
          return `Build courant modifié : ${action.name}.`;
      }
    } catch (error) {
      return `Échec de l’action ${action.type} : ${error instanceof Error ? error.message : "erreur inconnue"}`;
    }
  });

  function perkName(id: string): string {
    const perk = catalog.perks.find((candidate) => candidate.id === id);
    return perk?.name.fr ?? perk?.name.en ?? id;
  }
}

function isAssistantAction(value: unknown): value is AssistantAction {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  const exactKeys = (...allowed: string[]): boolean => keys.length === allowed.length && keys.every((key) => allowed.includes(key));
  const validTier = typeof value.tier === "string" && (KILLER_TIERS as readonly string[]).includes(value.tier);
  switch (value.type) {
    case "update_perk_description": return exactKeys("type", "perkId", "descriptionHtml") && nonEmpty(value.perkId) && nonEmpty(value.descriptionHtml)
      && value.descriptionHtml.length <= 200_000 && value.descriptionHtml.replace(/<[^>]*>|&nbsp;/gi, "").trim().length > 0;
    case "set_killer_tier": return exactKeys("type", "killerId", "tier") && nonEmpty(value.killerId) && validTier;
    case "set_perk_tier": return exactKeys("type", "perkId", "tier") && nonEmpty(value.perkId) && validTier;
    case "save_build":
    case "set_current_build": return exactKeys("type", "name", "side", "killerId", "perkIds", ...(value.type === "save_build" ? ["buildId"] : []))
      && nonEmpty(value.name) && nonEmpty(value.killerId) && (value.side === "killer" || value.side === "survivor")
      && Array.isArray(value.perkIds) && value.perkIds.every(nonEmpty)
      && (value.type !== "save_build" || value.buildId === null || nonEmpty(value.buildId));
    default: return false;
  }
}

function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
