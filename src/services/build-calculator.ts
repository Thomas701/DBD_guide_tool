import {
  ANALYZABLE_STATS,
  type AnalyzableStatDefinition,
  type AnalyzableStatKey,
  type AnalysisTheme,
  type StatCalculationMode
} from "../data/global-mechanics.js";
import type { ConditionParameter, EffectCondition } from "../domain/condition.js";
import type { EffectCalculationMode, EffectOperation, EffectUnit, PerkEffect } from "../domain/effect.js";
import type { Killer } from "../domain/killer.js";
import type { Perk, PerkSide } from "../domain/perk.js";

export type ScenarioConditionValue = boolean | Readonly<Record<string, ConditionParameter>>;
export type PerkRuntimeState = "inactive" | "active" | "cooldown";

export interface BuildScenario {
  conditions: Readonly<Record<string, ScenarioConditionValue>>;
  perkStates: Readonly<Record<string, PerkRuntimeState>>;
}

export const EMPTY_BUILD_SCENARIO: BuildScenario = { conditions: {}, perkStates: {} };
export type CalculatedStatKey = "speed" | "terrorRadius";
export type EffectCalculationStatus = "active" | "inactive" | "cooldown" | "unresolved";

export interface BuildStats {
  speed: number;
  terrorRadius: number;
}

export interface StatDelta {
  absolute: number;
  percent: number | null;
}

export interface EffectCalculation {
  detail: string | null;
  range: number | null;
  perkId: string;
  perkName: string;
  stat: string;
  statKey: AnalyzableStatKey | null;
  statLabel: string;
  theme: AnalysisTheme;
  operation: EffectOperation;
  interpretation: PerkEffect["interpretation"];
  value: number | boolean | null;
  target: string | null;
  unit: EffectUnit | null;
  status: EffectCalculationStatus;
  active: boolean;
  conditionActive: boolean;
  duration: number | null | undefined;
  cooldown: number | null | undefined;
  reasons: string[];
  before: number | null;
  after: number | null;
  qualitative: boolean;
  calculationMode: EffectCalculationMode | null;
}

export interface CalculatedStat {
  key: AnalyzableStatKey;
  label: string;
  theme: AnalysisTheme;
  unit: string;
  mode: StatCalculationMode;
  approximate: boolean;
  base: number;
  final: number;
  delta: number;
  deltaPercent: number | null;
  benefit: number | null;
  effects: EffectCalculation[];
}

export interface BuildCalculation {
  baseStats: BuildStats;
  finalStats: BuildStats;
  deltas: Record<CalculatedStatKey, StatDelta>;
  stats: Record<string, CalculatedStat> & { speed: CalculatedStat; terrorRadius: CalculatedStat };
  affectedStats: CalculatedStat[];
  qualitativeEffects: EffectCalculation[];
  activeEffects: EffectCalculation[];
  inactiveEffects: EffectCalculation[];
  cooldownEffects: EffectCalculation[];
  unresolvedEffects: EffectCalculation[];
  explanations: string[];
  stackingPolicy: "diminishing_returns_mixed_operations_unresolved";
}

export interface CalculateBuildInput {
  killer: Killer;
  perks: readonly Perk[];
  scenario?: BuildScenario;
  side?: PerkSide;
}

const NUMERIC_OPERATIONS = new Set<EffectOperation>(["set", "add", "multiply"]);
const QUALITATIVE_OPERATIONS = new Set<EffectOperation>(["reveal", "block", "apply_status"]);
const LEGACY_STAT_TARGETS: Readonly<Record<string, readonly AnalyzableStatKey[]>> = {
  "killer.break_action_speed": ["killer.pallet_break_time", "killer.wall_break_time", "generator.damage_time"],
  "killer.break_action_speed.palette": ["killer.pallet_break_time"],
  "generator.damage_action_speed": ["generator.damage_time"],
  "killer.vault_speed": ["killer.window_vault_time"],
  "chase.attack_distance": ["killer.lunge_range"],
  "chase.attack_speed": ["killer.missed_attack_recovery_time"],
  "chase.etourdissement_time": ["killer.pallet_stun_duration"],
  "hook.transport_speed": ["killer.carry_speed"],
  "hook.wiggle_speed": ["hook.wiggle_time"],
  "hook.wiggle_strength": ["hook.wiggle_strength"],
  "hook.sacrifice_speed": ["hook.phase_duration"],
  "hook.action_speed": ["hook.hook_time"],
  "locker.open": ["locker.search_time"],
  "sound.gemissement": ["sound.grunt_volume"],
  "sound.respiration": ["sound.breathing_volume"],
  "survivor.speed": ["survivor.run_speed"],
  "survivor.healing": ["healing.time"],
  "survivor.healing.speed": ["healing.time"],
  "blood_trace.time": ["tracking.blood_pool_lifetime"],
  "exit_gate.speed": ["exit_gate.open_time"],
  "action.totem": ["totem.dull_cleanse_time", "totem.hex_cleanse_time", "totem.dull_bless_time", "totem.hex_bless_time"]
};

export const BUILD_STACKING_POLICY = "diminishing_returns_mixed_operations_unresolved" as const;

export function calculateBuild({ killer, perks, scenario = EMPTY_BUILD_SCENARIO, side = perks[0]?.side ?? "killer" }: CalculateBuildInput): BuildCalculation {
  const effects = perks.flatMap((perk) => perk.effects.flatMap((effect) => createCalculations(perk, effect, scenario)));
  if (perks.some((perk) => perk.id === "lethal-pursuer")) {
    effects.filter((effect) => effect.stat === "survivor.aura" && effect.operation === "reveal" && effect.duration != null)
      .forEach((effect) => { effect.duration = effect.duration! + 2; effect.reasons.push("Poursuivant meurtrier : +2 s de révélation d’aura temporisée"); });
  }
  if (perks.some((perk) => perk.id === "survivor-eyes-of-belmont")) {
    effects.filter((effect) => effect.stat === "killer.aura" && effect.operation === "reveal" && effect.duration != null)
      .forEach((effect) => { effect.duration = effect.duration! + 2; effect.reasons.push("Yeux de Belmont : +2 s de révélation d’aura temporisée du tueur"); });
  }
  if (perks.some((perk) => perk.id === "survivor-open-handed")) {
    effects.filter((effect) => effect.range != null && effect.operation === "reveal")
      .forEach((effect) => { effect.range = effect.range! + 16; effect.reasons.push("Main tendue : +16 m de portée d’aura compatible"); });
  }
  const numericStats = Object.fromEntries(
    [...new Set(effects.flatMap((effect) => effect.statKey ? [effect.statKey] : []))]
      .flatMap((key) => {
        const stat = calculateStat(key, killer, effects, side);
        return stat ? [[key, stat] as const] : [];
      })
  ) as Record<string, CalculatedStat>;
  const speedKey = side === "survivor" ? "survivor.run_speed" : "killer.speed";
  const speed = numericStats[speedKey] ?? emptyStat(speedKey, killer);
  const terrorRadius = numericStats["killer.terror_radius"] ?? emptyStat("killer.terror_radius", killer);
  const affectedStats = Object.values(numericStats)
    .sort((left, right) => left.theme.localeCompare(right.theme, "fr") || left.label.localeCompare(right.label, "fr"));
  const activeEffects = effects.filter((effect) => effect.status === "active");
  const inactiveEffects = effects.filter((effect) => effect.status === "inactive");
  const cooldownEffects = effects.filter((effect) => effect.status === "cooldown");
  const unresolvedEffects = effects.filter((effect) => effect.status === "unresolved");

  return {
    baseStats: { speed: speed.base, terrorRadius: terrorRadius.base },
    finalStats: { speed: speed.final, terrorRadius: terrorRadius.final },
    deltas: {
      speed: { absolute: speed.delta, percent: speed.deltaPercent },
      terrorRadius: { absolute: terrorRadius.delta, percent: terrorRadius.deltaPercent }
    },
    stats: { ...numericStats, speed, terrorRadius },
    affectedStats,
    qualitativeEffects: effects.filter((effect) => effect.qualitative && effect.status !== "unresolved"),
    activeEffects,
    inactiveEffects,
    cooldownEffects,
    unresolvedEffects,
    explanations: affectedStats.flatMap(explainStat),
    stackingPolicy: BUILD_STACKING_POLICY
  };
}

export function perkNeedsRuntimeState(perk: Perk): boolean {
  return perk.cooldown !== null || perk.effects.some((effect) =>
    effect.cooldown != null
    || !effect.condition && effect.duration != null
    || !effect.condition && effect.interpretation === "inferred" && QUALITATIVE_OPERATIONS.has(effect.operation)
  );
}

export function collectBuildConditions(perks: readonly Perk[]): string[] {
  const conditions = new Set<string>();
  const visit = (condition: EffectCondition | undefined): void => {
    if (!condition) return;
    if ("type" in condition) conditions.add(condition.type);
    else if (condition.operator === "not") visit(condition.condition);
    else condition.conditions.forEach(visit);
  };
  perks.forEach((perk) => perk.effects.forEach((effect) => visit(effect.condition)));
  return [...conditions].sort((left, right) => left.localeCompare(right, "fr"));
}

function createCalculations(perk: Perk, effect: PerkEffect, scenario: BuildScenario): EffectCalculation[] {
  if (QUALITATIVE_OPERATIONS.has(effect.operation)) return [createCalculation(perk, effect, scenario, null)];
  if (!NUMERIC_OPERATIONS.has(effect.operation)) {
    return [unresolved(createCalculation(perk, effect, scenario, null), `Opération non calculée : ${effect.operation}`)];
  }
  const targets = numericTargets(effect.stat);
  if (targets.length === 0) {
    return [unresolved(createCalculation(perk, effect, scenario, null), `Statistique sans référence fiable : ${effect.stat}`)];
  }
  return targets.map((target) => createCalculation(perk, effect, scenario, target));
}

function createCalculation(
  perk: Perk,
  effect: PerkEffect,
  scenario: BuildScenario,
  statKey: AnalyzableStatKey | null
): EffectCalculation {
  const conditionResult = evaluateCondition(effect.condition, scenario.conditions);
  const needsRuntimeActivation = !effect.runtimeIndependent && (perk.cooldown !== null
    || effect.cooldown != null
    || !effect.condition && effect.duration != null
    || !effect.condition && effect.interpretation === "inferred" && QUALITATIVE_OPERATIONS.has(effect.operation));
  const runtimeState = scenario.perkStates[perk.id] === "active" ? "active" : "inactive";
  const active = conditionResult.active && (!needsRuntimeActivation || runtimeState === "active");
  const presentation = statKey ? ANALYZABLE_STATS[statKey] : qualitativePresentation(effect.stat);
  const reasons = effect.interpretation === "inferred" && !effect.condition
    ? ["Effet importé sans condition structurée"]
    : [...conditionResult.reasons];
  if (needsRuntimeActivation) {
    reasons.push(runtimeState === "active" ? "Effet déclenché dans la simulation" : "Déclenchement manquant");
  }
  const calculation: EffectCalculation = {
    detail: effect.detail ?? null,
    range: effect.range ?? null,
    perkId: perk.id,
    perkName: perk.name.fr ?? perk.name.en ?? perk.id,
    stat: effect.stat,
    statKey,
    statLabel: effect.label ?? presentation.label,
    theme: presentation.theme,
    operation: effect.operation,
    interpretation: effect.interpretation,
    value: effect.value ?? null,
    target: effect.target ?? null,
    unit: effect.unit ?? null,
    status: active ? "active" : "inactive",
    active,
    conditionActive: conditionResult.active,
    duration: effect.duration,
    cooldown: effect.cooldown ?? perk.cooldown,
    reasons,
    before: null,
    after: null,
    qualitative: QUALITATIVE_OPERATIONS.has(effect.operation),
    calculationMode: effect.calculationMode ?? null
  };
  if (statKey) {
    const definition = ANALYZABLE_STATS[statKey];
    if (definition.base === null && !definition.baseFromKiller) {
      return unresolved(calculation, definition.unknownReason ?? `Valeur de base inconnue : ${statKey}`);
    }
    const validationError = calculationValidationError(calculation, definition);
    if (validationError) return unresolved(calculation, validationError);
  }
  return calculation;
}

function calculateStat(key: AnalyzableStatKey, killer: Killer, effects: EffectCalculation[], side: PerkSide): CalculatedStat | null {
  const definition = ANALYZABLE_STATS[key];
  const base = resolveBase(definition, killer);
  if (base === null) return null;
  const related = effects.filter((effect) => effect.statKey === key);
  const applicable = related.filter((effect) => effect.status === "active");
  const setEffects = applicable.filter((effect) => effect.operation === "set");
  if (new Set(setEffects.map(normalizedValue)).size > 1) {
    setEffects.forEach((effect) => unresolved(effect, "Plusieurs valeurs imposées incompatibles"));
  }
  const operations = new Set(applicable.filter((effect) => effect.status === "active").map((effect) => effect.operation));
  if (operations.size > 1) {
    applicable.forEach((effect) => {
      if (effect.status === "active") unresolved(effect, "Ordre de cumul mixte non vérifié par les données source");
    });
  }
  let current = round(base);
  const ordered = applicable.filter((effect) => effect.status === "active");
  const multipliers = ordered.filter((effect) => effect.operation === "multiply");
  if (multipliers.length > 1) {
    const modes = new Set(multipliers.map((effect) => effect.calculationMode ?? definition.mode));
    const signs = new Set(multipliers.map((effect) => Math.sign((normalizedValue(effect) ?? 1) - 1)));
    if (modes.size > 1 || signs.size > 1 || new Set(multipliers.map((effect) => effect.perkId)).size !== multipliers.length) {
      multipliers.forEach((effect) => unresolved(effect, "Cumul de contextes ou de modes différents : activez une seule situation à la fois"));
    } else {
      const weights = [1, .5, .25, .125];
      const ranked = [...multipliers].sort((a, b) => Math.abs((normalizedValue(b) ?? 1) - 1) - Math.abs((normalizedValue(a) ?? 1) - 1) || a.perkId.localeCompare(b.perkId));
      const factor = 1 + ranked.reduce((sum, effect, index) => {
        const weight = weights[index] ?? .05;
        effect.reasons.push(`Rendements décroissants : ${weight * 100} % du modificateur (règle 9.6)`);
        return sum + ((normalizedValue(effect) ?? 1) - 1) * weight;
      }, 0);
      if (factor <= 0) multipliers.forEach((effect) => unresolved(effect, "Le cumul dépasse les limites de vitesse prises en charge"));
      else {
        const mode = multipliers[0]!.calculationMode ?? definition.mode;
        const final = round(mode === "action_speed" ? base / factor : base * factor);
        multipliers.forEach((effect) => { effect.before = base; effect.after = final; });
        current = final;
      }
    }
  }
  for (const effect of ordered) {
    if (effect.status !== "active" || multipliers.length > 1 && effect.operation === "multiply") continue;
    const value = normalizedValue(effect);
    if (value === null) continue;
    effect.before = current;
    if (effect.operation === "set") current = value;
    if (effect.operation === "add") current += value;
    if (effect.operation === "multiply") current = (effect.calculationMode ?? definition.mode) === "action_speed" ? current / value : current * value;
    current = round(current);
    effect.after = current;
  }
  const final = round(current);
  const delta = round(final - base);
  const applied = new Set(ordered);
  return {
    key,
    label: definition.label,
    theme: definition.theme,
    unit: definition.unit,
    mode: definition.mode,
    approximate: definition.approximate ?? false,
    base: round(base),
    final,
    delta,
    deltaPercent: base === 0 ? null : round(delta / base * 100),
    benefit: definition.benefit === "neutral" ? null : round((definition.benefit === "higher" ? delta : -delta) * (side === "survivor" ? -1 : 1)),
    effects: [...ordered, ...related.filter((effect) => !applied.has(effect))]
  };
}

function emptyStat(key: AnalyzableStatKey, killer: Killer): CalculatedStat {
  const definition = ANALYZABLE_STATS[key];
  const base = resolveBase(definition, killer) ?? 0;
  return {
    key,
    label: definition.label,
    theme: definition.theme,
    unit: definition.unit,
    mode: definition.mode,
    approximate: definition.approximate ?? false,
    base,
    final: base,
    delta: 0,
    deltaPercent: 0,
    benefit: 0,
    effects: []
  };
}

function numericTargets(stat: string): readonly AnalyzableStatKey[] {
  if (Object.hasOwn(ANALYZABLE_STATS, stat)) return [stat as AnalyzableStatKey];
  return LEGACY_STAT_TARGETS[stat] ?? [];
}

function resolveBase(definition: AnalyzableStatDefinition, killer: Killer): number | null {
  return definition.baseFromKiller ? killer[definition.baseFromKiller] : definition.base;
}

function calculationValidationError(effect: EffectCalculation, definition: AnalyzableStatDefinition): string | null {
  if (typeof effect.value !== "number" || !Number.isFinite(effect.value)) return "Valeur numérique absente";
  if (effect.operation === "multiply") {
    if (effect.unit !== "multiplier" && effect.unit !== "percent") {
      return `Unité incompatible avec un multiplicateur : ${effect.unit ?? "absente"}`;
    }
    return (normalizedValue(effect) ?? 0) > 0 ? null : "Multiplicateur nul ou négatif";
  }
  if (effect.operation === "add" && (effect.calculationMode ?? definition.mode) === "points") {
    return effect.unit === "percentage_points" || effect.unit === "percent"
      ? null
      : `Des points de pourcentage sont requis, reçu : ${effect.unit ?? "absente"}`;
  }
  const expected = expectedEffectUnit(definition.unit);
  return !expected || effect.unit === expected ? null : `Unité incompatible : ${effect.unit ?? "absente"}`;
}

function expectedEffectUnit(displayUnit: string): EffectUnit | null {
  if (displayUnit === "m/s") return "meters_per_second";
  if (displayUnit === "m") return "meters";
  if (displayUnit === "s") return "seconds";
  if (displayUnit.startsWith("%")) return "percent";
  return null;
}

function normalizedValue(effect: EffectCalculation): number | null {
  if (effect.target === "infinite") return Infinity;
  if (typeof effect.value !== "number") return null;
  return effect.operation === "multiply" && effect.unit === "percent" ? 1 + effect.value / 100 : effect.value;
}

function unresolved(effect: EffectCalculation, reason: string): EffectCalculation {
  effect.status = "unresolved";
  effect.active = false;
  effect.reasons.push(reason);
  return effect;
}

function evaluateCondition(
  conditionValue: EffectCondition | undefined,
  conditions: BuildScenario["conditions"]
): { active: boolean; reasons: string[] } {
  if (!conditionValue) return { active: true, reasons: ["Aucune condition requise"] };
  if ("type" in conditionValue) {
    const scenarioValue = Object.hasOwn(conditions, conditionValue.type) ? conditions[conditionValue.type] : undefined;
    const active = scenarioValue === true || parametersMatch(conditionValue.parameters, scenarioValue);
    return {
      active,
      reasons: [active ? `Condition remplie : ${conditionValue.type}` : `Condition manquante : ${conditionValue.type}`]
    };
  }
  if (conditionValue.operator === "not") {
    const nested = evaluateCondition(conditionValue.condition, conditions);
    return { active: !nested.active, reasons: [!nested.active ? "Condition négative remplie" : "Condition négative non remplie"] };
  }
  const nested = conditionValue.conditions.map((entry) => evaluateCondition(entry, conditions));
  return {
    active: conditionValue.operator === "all" ? nested.every((entry) => entry.active) : nested.some((entry) => entry.active),
    reasons: nested.flatMap((entry) => entry.reasons)
  };
}

function parametersMatch(
  required: Readonly<Record<string, ConditionParameter>> | undefined,
  actual: ScenarioConditionValue | undefined
): boolean {
  if (!actual || typeof actual !== "object") return false;
  return !required || Object.entries(required).every(([key, value]) => actual[key] === value);
}

function qualitativePresentation(stat: string): { label: string; theme: AnalysisTheme } {
  if (stat === "survivor.mechanic") return { label: "Effet de la compétence", theme: "Effets de statut" };
  if (stat === "killer.aura") return { label: "Aura du tueur", theme: "Traque" };
  if (stat === "killer.status.undetectable") return { label: "Indétectable", theme: "Traque" };
  if (stat === "tracking.whispers") return { label: "Murmures de présence à moins de 32 m", theme: "Traque" };
  if (stat === "item.forced_drop") return { label: "Objet forcé à terre", theme: "Traque" };
  if (stat.startsWith("item.aura")) return { label: "Aura des objets au sol révélée jusqu’à 64 m", theme: "Traque" };
  if (stat === "chase.instant_pallet_break") return { label: "Prochaine palette brisée instantanément", theme: "Poursuite" };
  if (stat === "hook.wiggle_paused") return { label: "Progression de gigotement interrompue", theme: "Hook / Transport" };
  if (stat === "hook.pickup_drop_action_speed") return { label: "Ramassage et lâcher accélérés de 32 %", theme: "Hook / Transport" };
  if (stat === "generator.additional_regression") return { label: "Jusqu’à 4 générateurs supplémentaires régressent", theme: "Générateurs" };
  if (stat === "generator.difficult_skill_check") return { label: "Test d’habileté difficile déclenché", theme: "Générateurs" };
  if (stat === "totem.rekindled_blocked") return { label: "Totems ravivés bloqués", theme: "Totems" };
  if (stat.startsWith("survivor.aura")) return { label: "Aura des survivants révélée", theme: "Traque" };
  if (stat === "generator.aura") return { label: "Aura du générateur révélée", theme: "Générateurs" };
  if (stat.startsWith("generator") && stat.includes("lock")) return { label: "Générateur bloqué", theme: "Générateurs" };
  if (stat.startsWith("exit_gate") && stat.includes("lock")) return { label: "Portes de sortie bloquées", theme: "Portes" };
  if (stat.includes("palette") && stat.includes("lock")) return { label: "Palettes bloquées", theme: "Poursuite" };
  if (stat.includes("window") && stat.includes("lock") || stat.includes("jump.lock")) return { label: "Fenêtres bloquées", theme: "Poursuite" };
  if (stat === "survivor.status.exposed") return { label: "Survivants exposés", theme: "Effets de statut" };
  if (stat === "survivor.kill_available") return { label: "Tuer le survivant", theme: "Effets de statut" };
  if (stat === "survivor.status.exhausted") return { label: "Survivants épuisés", theme: "Effets de statut" };
  if (stat === "survivor.status.blindness") return { label: "Survivants aveuglés", theme: "Effets de statut" };
  if (stat === "survivor.status.hemorrhage") return { label: "Hémorragie", theme: "Effets de statut" };
  if (stat === "survivor.status.mangled") return { label: "Mutilé", theme: "Effets de statut" };
  if (stat === "survivor.status.broken") return { label: "Brisé", theme: "Effets de statut" };
  if (stat === "survivor.status.oblivious") return { label: "Inconscient", theme: "Effets de statut" };
  if (stat === "totem.lock") return { label: "Totems bloqués", theme: "Totems" };
  if (stat.startsWith("survivor.status")) return { label: stat.split(".").at(-1)?.replaceAll("_", " ") ?? stat, theme: "Effets de statut" };
  if (stat.startsWith("sound")) return { label: "Information sonore", theme: "Traque" };
  if (stat.startsWith("hook")) return { label: stat.replaceAll("_", " "), theme: "Hook / Transport" };
  if (stat.startsWith("totem")) return { label: stat.replaceAll("_", " "), theme: "Totems" };
  if (stat.startsWith("chase")) return { label: stat.replaceAll("_", " "), theme: "Poursuite" };
  if (stat.startsWith("healing")) return { label: stat.replaceAll("_", " "), theme: "Soins" };
  if (stat.startsWith("generator")) return { label: stat.replaceAll("_", " "), theme: "Générateurs" };
  return { label: stat.replaceAll("_", " "), theme: "Traque" };
}

function explainStat(stat: CalculatedStat): string[] {
  return [
    `${stat.label} — base : ${stat.base} ${stat.unit}`,
    ...stat.effects.filter((effect) => effect.status === "active")
      .map((effect) => `${effect.perkName} : ${effect.before} → ${effect.after} ${stat.unit}`),
    `${stat.label} — résultat : ${stat.final} ${stat.unit}`
  ];
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
