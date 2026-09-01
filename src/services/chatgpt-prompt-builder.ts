import type { AssistantBuildContext, AssistantHistoryItem } from "./openai-build-assistant.js";

export function buildChatGPTPrompt(
  request: string,
  context: AssistantBuildContext,
  history: readonly AssistantHistoryItem[]
): string {
  const recentHistory = history
    .filter((entry, index) => !(index === history.length - 1 && entry.role === "user" && entry.content.trim() === request.trim()))
    .slice(-6)
    .map((entry) => `${entry.role === "user" ? "Utilisateur" : "Assistant"} : ${entry.content}`)
    .join("\n\n") || "Aucun historique pertinent.";

  const perks = context.perks.length === 0
    ? "Aucune perk équipée."
    : context.perks.map((perk, index) => [
      `${index + 1}. ${perk.name}`,
      `Catégories : ${perk.categories.join(", ") || "non renseignées"}`,
      `Description :\n${perk.description || "non disponible"}`,
      "Effets :",
      ...(perk.effects.length > 0 ? perk.effects.map((effect) => `- ${formatEffect(effect)}`) : ["- aucun effet structuré"])
    ].join("\n")).join("\n\n");

  return [
    "=== ROLE ===",
    "Tu es un expert de Dead by Daylight spécialisé dans l’analyse de builds.",
    "Utilise prioritairement les données fournies. Ne modifie jamais arbitrairement une valeur. Distingue clairement les faits, les calculs et les recommandations. Si une donnée manque ou reste non vérifiée, indique-le.",
    "",
    "=== USER REQUEST ===",
    request,
    "",
    "=== KILLER ===",
    `Nom : ${context.killer.name}`,
    `Vitesse : ${context.killer.speed} m/s`,
    `Rayon de terreur : ${context.killer.terrorRadius} m`,
    `Taille : ${context.killer.size}`,
    `Tier : ${context.killer.tier}`,
    `Difficulté : ${context.killer.difficulty}`,
    "Pouvoirs : non disponibles dans le modèle de données actuel.",
    "",
    "=== PERKS ===",
    perks,
    "",
    "=== ADD-ONS ===",
    "Non disponibles dans le modèle de données actuel.",
    "",
    "=== OFFERING ===",
    "Non disponible dans le modèle de données actuel.",
    "",
    "=== CURRENT STATE ===",
    JSON.stringify(context.currentState, null, 2),
    "",
    "=== CALCULATED DATA ===",
    JSON.stringify(context.calculatedData, null, 2),
    "",
    "=== CONVERSATION HISTORY ===",
    recentHistory,
    "",
    "=== USER REQUEST ===",
    request
  ].join("\n");
}

function formatEffect(effect: AssistantBuildContext["perks"][number]["effects"][number]): string {
  return [
    `stat=${effect.stat}`,
    `opération=${effect.operation}`,
    effect.value === undefined ? null : `valeur=${String(effect.value)}`,
    effect.unit ? `unité=${effect.unit}` : null,
    effect.condition ? `condition=${JSON.stringify(effect.condition)}` : "condition=aucune",
    effect.duration == null ? null : `durée=${effect.duration}s`,
    effect.cooldown == null ? null : `cooldown=${effect.cooldown}s`,
    `interprétation=${effect.interpretation}`
  ].filter((part): part is string => part !== null).join(" ; ");
}
