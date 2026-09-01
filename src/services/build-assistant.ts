import type { Killer } from "../domain/killer.js";
import type { Perk } from "../domain/perk.js";
import type { BuildCalculation, BuildScenario, EffectCalculation } from "./build-calculator.js";

export interface BuildAssistantContext {
  killer: Killer;
  perks: readonly Perk[];
  scenario: BuildScenario;
  calculation: BuildCalculation;
}

export function answerBuildQuestion(question: string, context: BuildAssistantContext): string {
  const query = normalize(question);
  if (context.perks.length === 0) return "Ajoutez au moins une perk : je pourrai ensuite expliquer ses valeurs et ses conditions.";

  const matchedPerk = context.perks.find((perk) => {
    const names = [perk.name.fr, perk.name.en, perk.id].filter((name): name is string => Boolean(name));
    return names.some((name) => query.includes(normalize(name)));
  });
  if (matchedPerk) return explainPerk(matchedPerk, context.calculation);

  const matchedStat = context.calculation.affectedStats.find((stat) => query.includes(normalize(stat.label)));
  if (matchedStat) return explainStat(matchedStat.label, matchedStat.base, matchedStat.final, matchedStat.unit, matchedStat.effects);

  if (query.includes("synerg") || query.includes("interaction") || query.includes("cumul")) {
    return explainSynergies(context.calculation);
  }
  if (query.includes("amelior") || query.includes("improv") || query.includes("faiblesse")) {
    return suggestImprovements(context);
  }
  if (query.includes("calcul") || query.includes("valeur") || query.includes("stat")) {
    return showCalculations(context.calculation);
  }
  if (query.includes("pourquoi") || query.includes("why") || query.includes("change")) {
    const changed = context.calculation.affectedStats.find((stat) => stat.delta !== 0)
      ?? context.calculation.affectedStats[0];
    return changed
      ? explainStat(changed.label, changed.base, changed.final, changed.unit, changed.effects)
      : "Aucune valeur numérique ne change avec les conditions actuellement actives.";
  }
  return buildOverview(context);
}

function explainPerk(perk: Perk, calculation: BuildCalculation): string {
  const effects = allEffects(calculation).filter((effect) => effect.perkId === perk.id);
  const name = perk.name.fr ?? perk.name.en ?? perk.id;
  if (effects.length === 0) return `${name} ne possède pas encore d’effet structuré exploitable par l’analyseur.`;
  return [
    `${name} :`,
    ...effects.map((effect) => `• ${describeEffect(effect)}`)
  ].join("\n");
}

function explainStat(label: string, base: number, final: number, unit: string, effects: readonly EffectCalculation[]): string {
  const active = effects.filter((effect) => effect.status === "active");
  const inactive = effects.filter((effect) => effect.status === "inactive" || effect.status === "cooldown");
  return [
    `${label} : ${number(base)} ${unit} → ${number(final)} ${unit}.`,
    ...active.map((effect) => `• ${effect.perkName} : ${describeEffect(effect)}`),
    ...inactive.map((effect) => `• ${effect.perkName} est inactive : ${effect.reasons.at(-1) ?? "condition non remplie"}.`)
  ].join("\n");
}

function explainSynergies(calculation: BuildCalculation): string {
  const groups = new Map<string, EffectCalculation[]>();
  calculation.activeEffects.forEach((effect) => {
    const key = effect.statKey ?? effect.stat;
    groups.set(key, [...(groups.get(key) ?? []), effect]);
  });
  const synergies = [...groups.values()].filter((effects) => new Set(effects.map((effect) => effect.perkId)).size > 1);
  if (synergies.length === 0) return "Aucune statistique n’est actuellement modifiée par plusieurs perks actives. Les effets restent indépendants.";
  return synergies.map((effects) => {
    const names = [...new Set(effects.map((effect) => effect.perkName))];
    return `• ${names.join(" + ")} agissent sur ${effects[0]?.statLabel ?? "la même statistique"}.`;
  }).join("\n");
}

function suggestImprovements(context: BuildAssistantContext): string {
  const inactive = context.calculation.inactiveEffects.filter((effect) => effect.reasons.some((reason) => reason.startsWith("Condition")));
  const penalties = context.calculation.affectedStats.filter((stat) => (stat.benefit ?? 0) < 0);
  const lines: string[] = [];
  if (inactive.length > 0) lines.push(`${new Set(inactive.map((effect) => effect.perkId)).size} perk(s) sont conditionnelles et inactives dans ce scénario.`);
  if (penalties.length > 0) lines.push(`Pénalités calculées : ${penalties.map((stat) => stat.label).join(", ")}.`);
  if (context.calculation.unresolvedEffects.length > 0) lines.push(`${context.calculation.unresolvedEffects.length} effet(s) ne disposent pas encore d’une référence assez fiable.`);
  if (lines.length === 0) lines.push("Le moteur ne détecte ni pénalité active ni effet partiel. Une recommandation de nouvelles perks demanderait des critères de jeu supplémentaires.");
  return lines.join("\n");
}

function showCalculations(calculation: BuildCalculation): string {
  const stats = calculation.affectedStats.filter((stat) => stat.delta !== 0);
  if (stats.length === 0) return "Aucune statistique numérique ne change avec les conditions actuelles.";
  return stats.map((stat) => {
    const delta = stat.delta > 0 ? `+${number(stat.delta)}` : number(stat.delta);
    return `• ${stat.label} : ${number(stat.base)} → ${number(stat.final)} ${stat.unit} (${delta} ${stat.unit}).`;
  }).join("\n");
}

function buildOverview(context: BuildAssistantContext): string {
  const killerName = context.killer.name.fr ?? context.killer.name.en ?? context.killer.id;
  const changed = context.calculation.affectedStats.filter((stat) => stat.delta !== 0);
  return `${killerName} équipe ${context.perks.length} perk(s). ${changed.length} statistique(s) changent avec le scénario actuel. Demandez-moi d’expliquer une perk, une synergie ou les calculs.`;
}

function describeEffect(effect: EffectCalculation): string {
  if (effect.status === "unresolved") return `analyse partielle (${effect.reasons.at(-1) ?? "référence inconnue"})`;
  if (effect.status !== "active") return `inactif (${effect.reasons.at(-1) ?? "condition non remplie"})`;
  if (effect.qualitative) {
    const duration = effect.duration == null ? "" : ` pendant ${number(effect.duration)} s`;
    return `${effect.statLabel} actif${duration}`;
  }
  if (effect.before !== null && effect.after !== null) return `${number(effect.before)} → ${number(effect.after)}`;
  return `${effect.statLabel} actif`;
}

function allEffects(calculation: BuildCalculation): EffectCalculation[] {
  return [
    ...calculation.activeEffects,
    ...calculation.inactiveEffects,
    ...calculation.cooldownEffects,
    ...calculation.unresolvedEffects
  ];
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
}

function number(value: number): string {
  return new Intl.NumberFormat("fr", { maximumFractionDigits: 3 }).format(value);
}
