import type { EffectCondition } from "./condition.js";

export const EFFECT_OPERATIONS = [
  "add",
  "multiply",
  "set",
  "reveal",
  "block",
  "apply_status",
  "cap"
] as const;

export const EFFECT_UNITS = [
  "multiplier",
  "percent",
  "percentage_points",
  "meters",
  "meters_per_second",
  "seconds",
  "boolean",
  "count"
] as const;

export type EffectOperation = (typeof EFFECT_OPERATIONS)[number];
export type EffectUnit = (typeof EFFECT_UNITS)[number];
export type EffectInterpretation = "verified" | "inferred";
export type EffectCalculationMode = "action_speed" | "scalar" | "duration" | "points";

export interface PerkEffect {
  stat: string;
  operation: EffectOperation;
  interpretation: EffectInterpretation;
  value?: number | boolean;
  unit?: EffectUnit;
  condition?: EffectCondition;
  duration?: number | null;
  cooldown?: number | null;
  target?: string;
  tierValues?: [number, number, number];
  calculationMode?: EffectCalculationMode;
  source?: {
    format: "legacy-effect";
    raw: string;
  };
}
