export const KNOWN_CONDITIONS = [
  "in_chase",
  "not_in_chase",
  "carrying_survivor",
  "after_hook",
  "survivor_hooked",
  "obsession_hooked",
  "generator_completed",
  "near_completed_generator",
  "generator_damaged",
  "bloodlust_active",
  "survivor_injured",
  "survivor_downed",
  "inside_terror_radius",
  "outside_terror_radius",
  "totem_active",
  "hex_active",
  "exit_gates_powered",
  "exit_gate_open",
  "after_basic_attack",
  "after_blind",
  "after_break_action",
  "after_fall",
  "after_pickup",
  "after_survivor_vault",
  "survivor_unhooked",
  "survivor_lost_health_state",
  "generator_at_90_percent",
  "skill_check_failed",
  "four_survivors_injured",
  "lullaby_five_tokens",
  "pentimento_five_tokens",
  "four_generators_completed",
  "target_is_obsession",
  "after_killer_vault",
  "compromised_generator_completed",
  "survivor_within_32m",
  "forever_entwined_max_tokens",
  "exit_gate_progress_80",
  "perk_triggered"
] as const;

export type KnownConditionType = (typeof KNOWN_CONDITIONS)[number];
export type ConditionParameter = string | number | boolean;

export interface AtomicEffectCondition {
  type: KnownConditionType | (string & {});
  parameters?: Record<string, ConditionParameter>;
}

export interface AllEffectConditions {
  operator: "all";
  conditions: EffectCondition[];
}

export interface AnyEffectConditions {
  operator: "any";
  conditions: EffectCondition[];
}

export interface NegatedEffectCondition {
  operator: "not";
  condition: EffectCondition;
}

export type EffectCondition =
  | AtomicEffectCondition
  | AllEffectConditions
  | AnyEffectConditions
  | NegatedEffectCondition;
