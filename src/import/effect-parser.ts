import type { AtomicEffectCondition } from "../domain/condition.js";
import type { EffectUnit, PerkEffect } from "../domain/effect.js";
import { normalizeWords, splitTopLevel } from "./normalize.js";

export interface LegacyEffectProblem {
  token: string;
  reason: string;
}

export interface LegacyEffectParseResult {
  effects: PerkEffect[];
  unresolved: LegacyEffectProblem[];
  warnings: LegacyEffectProblem[];
}

interface ParsedAmount {
  infinite: boolean;
  percent: boolean;
  signedValue: number | null;
}

interface MappedTarget {
  stat: string;
  condition?: AtomicEffectCondition;
  duration?: number;
  target?: string;
}

const KNOWN_ROOTS = new Set([
  "action",
  "aura",
  "be_one_shot",
  "blind",
  "blood_trace",
  "bloodlust",
  "care",
  "cave",
  "chase",
  "destruction",
  "exhausted",
  "exit_door",
  "generator",
  "hability_test",
  "hook",
  "indetectable",
  "locker",
  "obsession",
  "recharge",
  "sound",
  "speed",
  "survivant_transport",
  "terror_rayon",
  "totem"
]);

const STATUS_STATS = new Set([
  "killer.status.undetectable",
  "survivor.status.blindness",
  "survivor.status.exhausted",
  "survivor.status.exposed",
  "survivor.status.hemorrhage",
  "survivor.status.mangled",
  "survivor.status.sick"
]);

export function parseLegacyEffects(raw: string): LegacyEffectParseResult {
  const result: LegacyEffectParseResult = { effects: [], unresolved: [], warnings: [] };
  const trimmed = raw.trim();

  if (!trimmed || trimmed.toLocaleLowerCase("fr") === "null") {
    result.unresolved.push({ token: raw, reason: "effet absent" });
    return result;
  }

  for (const token of splitTopLevel(trimmed)) {
    if (token.toLocaleLowerCase("fr") === "null") {
      result.unresolved.push({ token, reason: "jeton null dans une liste d'effets" });
      continue;
    }

    const parsed = parseTokenEnvelope(token);
    if (!parsed) {
      result.unresolved.push({ token, reason: "syntaxe d'effet inconnue" });
      continue;
    }

    if (parsed.nonCanonicalEnvelope) {
      result.warnings.push({ token, reason: "parenthèses externes normalisées en crochets" });
    }

    const amount = parseAmount(parsed.amount);
    if (!amount || amount.signedValue === null && !amount.infinite) {
      result.unresolved.push({ token, reason: "valeur d'effet inconnue" });
      continue;
    }

    const targetExpressions = splitTopLevel(parsed.target);
    if (targetExpressions.length === 0) {
      result.unresolved.push({ token, reason: "cible d'effet absente" });
      continue;
    }

    let tokenProducedEffect = false;
    for (const expression of targetExpressions) {
      const paths = expandTargetPaths(expression);
      if (paths.length === 0) {
        result.unresolved.push({ token, reason: `cible illisible: ${expression}` });
        continue;
      }

      for (const path of paths) {
        const root = path[0];
        if (!root || !KNOWN_ROOTS.has(root)) {
          result.unresolved.push({ token, reason: `statistique inconnue: ${root ?? expression}` });
          continue;
        }

        const target = mapTarget(path);
        const effect = buildEffect(token, amount, target);
        if (!effect) {
          result.unresolved.push({ token, reason: `valeur incompatible avec ${target.stat}` });
          continue;
        }

        result.effects.push(effect);
        tokenProducedEffect = true;
      }
    }

    if (!tokenProducedEffect && !result.unresolved.some((problem) => problem.token === token)) {
      result.unresolved.push({ token, reason: "aucun effet structuré produit" });
    }
  }

  return result;
}

function parseTokenEnvelope(token: string): {
  amount: string;
  target: string;
  nonCanonicalEnvelope: boolean;
} | null {
  const match = token.match(/^\s*(infinite|[+-]?(?:\d+(?:\.\d+)?|x)%?)\s*(\[|\()([\s\S]+)(\]|\))\s*$/i);
  if (!match) {
    return null;
  }

  const amount = match[1];
  const opening = match[2];
  const target = match[3];
  const closing = match[4];
  if (!amount || !opening || !target || !closing) {
    return null;
  }
  if (opening === "[" && closing !== "]" || opening === "(" && closing !== ")") {
    return null;
  }

  return { amount, target, nonCanonicalEnvelope: opening === "(" };
}

function parseAmount(raw: string): ParsedAmount | null {
  if (raw.toLocaleLowerCase("fr") === "infinite") {
    return { infinite: true, percent: false, signedValue: null };
  }
  if (raw.toLocaleLowerCase("fr").includes("x")) {
    return { infinite: false, percent: raw.endsWith("%"), signedValue: null };
  }

  const percent = raw.endsWith("%");
  const value = Number.parseFloat(percent ? raw.slice(0, -1) : raw);
  return Number.isFinite(value) ? { infinite: false, percent, signedValue: value } : null;
}

function expandTargetPaths(expression: string, prefix: string[] = []): string[][] {
  const trimmed = normalizeWords(expression).replace(/ /g, "_");
  const openingIndex = expression.indexOf("(");
  if (openingIndex === -1) {
    return trimmed ? [[...prefix, trimmed]] : [];
  }

  if (!expression.endsWith(")")) {
    return [];
  }
  const root = normalizeWords(expression.slice(0, openingIndex)).replace(/ /g, "_");
  if (!root) {
    return [];
  }
  const inner = expression.slice(openingIndex + 1, -1);
  return splitTopLevel(inner).flatMap((child) => expandTargetPaths(child, [...prefix, root]));
}

function mapTarget(path: string[]): MappedTarget {
  const [root, ...rawQualifiers] = path;
  const qualifiers = [...rawQualifiers];
  let condition: AtomicEffectCondition | undefined;
  let duration: number | undefined;
  let target: string | undefined;

  for (let index = qualifiers.length - 1; index >= 0; index -= 1) {
    const qualifier = qualifiers[index];
    if (qualifier === "in_chase") {
      condition = { type: "in_chase" };
      qualifiers.splice(index, 1);
    } else if (qualifier === "no_chase") {
      condition = { type: "not_in_chase" };
      qualifiers.splice(index, 1);
    } else if (qualifier === "fixed") {
      condition = { type: "generator_completed" };
      qualifiers.splice(index, 1);
    } else if (qualifier === "all_finished") {
      condition = { type: "exit_gates_powered" };
      qualifiers.splice(index, 1);
    } else if (qualifier === "obsession" || qualifier === "survivant") {
      target = qualifier === "obsession" ? "obsession" : "survivor";
      qualifiers.splice(index, 1);
    } else if (qualifier && /^\d+(?:\.\d+)?sec$/.test(qualifier)) {
      duration = Number.parseFloat(qualifier.slice(0, -3));
      qualifiers.splice(index, 1);
    }
  }

  const suffix = qualifiers.join(".");
  let stat: string;
  switch (root) {
    case "speed":
      stat = target === "survivor"
        ? "survivor.speed"
        : suffix === "jump" ? "killer.vault_speed" : "killer.speed";
      break;
    case "terror_rayon":
      stat = "killer.terror_radius";
      break;
    case "survivant_transport":
      stat = "hook.transport_speed";
      break;
    case "hook":
      stat = mapHookStat(suffix);
      break;
    case "destruction":
      stat = suffix === "generator" ? "generator.damage_action_speed" : `killer.break_action_speed${suffix ? `.${suffix}` : ""}`;
      break;
    case "aura":
      stat = `survivor.aura${suffix ? `.${suffix}` : ""}`;
      break;
    case "indetectable":
      stat = "killer.status.undetectable";
      break;
    case "be_one_shot":
      stat = "survivor.status.exposed";
      break;
    case "blind":
      stat = `survivor.status.blindness${suffix ? `.${suffix}` : ""}`;
      break;
    case "exhausted":
      stat = "survivor.status.exhausted";
      break;
    case "care":
      stat = mapCareStat(suffix);
      break;
    case "exit_door":
      stat = `exit_gate${suffix ? `.${suffix}` : ""}`;
      break;
    default:
      stat = `${root}${suffix ? `.${suffix}` : ""}`;
  }

  const mapped: MappedTarget = { stat };
  if (condition) mapped.condition = condition;
  if (duration !== undefined) mapped.duration = duration;
  if (target) mapped.target = target;
  return mapped;
}

function mapHookStat(suffix: string): string {
  if (suffix === "speed_debattement") return "hook.wiggle_speed";
  if (suffix === "strengh_debattement") return "hook.wiggle_strength";
  if (suffix === "death_speed") return "hook.sacrifice_speed";
  return `hook.action_speed${suffix ? `.${suffix}` : ""}`;
}

function mapCareStat(suffix: string): string {
  if (suffix === "hemorragie") return "survivor.status.hemorrhage";
  if (suffix === "estropiement") return "survivor.status.mangled";
  if (suffix === "sick") return "survivor.status.sick";
  return `survivor.healing${suffix ? `.${suffix}` : ""}`;
}

function buildEffect(token: string, amount: ParsedAmount, target: MappedTarget): PerkEffect | null {
  const base: PerkEffect = {
    stat: target.stat,
    operation: "add",
    interpretation: "inferred",
    source: { format: "legacy-effect", raw: token }
  };
  if (target.condition) base.condition = target.condition;
  if (target.duration !== undefined) base.duration = target.duration;
  if (target.target) base.target = target.target;

  const lockLike = target.stat.endsWith(".lock") || target.stat.includes("palette_lock");
  const statusBase = [...STATUS_STATS].some((stat) => target.stat === stat || target.stat.startsWith(`${stat}.`));
  const aura = target.stat.startsWith("survivor.aura");

  if (amount.infinite) {
    base.operation = aura ? "reveal" : statusBase ? "apply_status" : "set";
    base.value = true;
    base.unit = "boolean";
    base.duration = null;
    return base;
  }

  const value = amount.signedValue;
  if (value === null) return null;

  if (amount.percent) {
    base.operation = "multiply";
    base.value = Number((1 + value / 100).toFixed(6));
    base.unit = "multiplier";
    return base;
  }

  if (lockLike || aura || statusBase) {
    if (value < 0) return null;
    base.operation = lockLike ? "block" : aura ? "reveal" : "apply_status";
    base.duration = value;
    base.unit = "seconds";
    return base;
  }

  base.operation = "add";
  base.value = value;
  const unit = inferUnit(target.stat);
  if (unit) base.unit = unit;
  return base;
}

function inferUnit(stat: string): EffectUnit | null {
  if (stat === "killer.terror_radius") return "meters";
  if (stat.includes("time") || stat.includes("duration")) return "seconds";
  return null;
}
