export const KNOWN_CONDITIONS = [
  "in_chase",
  "not_in_chase",
  "chase_abandoned",
  "carrying_survivor",
  "after_hook",
  "survivor_hooked",
  "obsession_hooked",
  "generator_completed",
  "generator_at_70_percent",
  "near_completed_generator",
  "generator_damaged",
  "bloodlust_active",
  "survivor_injured",
  "blood_pool_present",
  "survivor_downed",
  "inside_terror_radius",
  "outside_terror_radius",
  "totem_active",
  "hex_active",
  "exit_gates_powered",
  "exit_gate_open",
  "after_basic_attack",
  "after_blind",
  "blind_attempted",
  "after_break_action",
  "pallet_stunned",
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
  "healing_within_32m",
  "devour_hope_2_tokens",
  "devour_hope_3_tokens",
  "devour_hope_5_tokens",
  "forever_entwined_max_tokens",
  "exit_gate_progress_80",
  "perk_triggered",
  "trial_start", "fire_up_five_tokens", "ravenous_four_tokens", "scourge_hook", "weeping_wounds_healed", "far_from_hook", "grim_embrace_four_tokens", "repairing_generator", "survivor_within_24m", "dying_light_three_tokens",
  "survivor_healthy", "survivor_exhausted", "survivor_inside_boon", "survivor_rescued_ally", "survivor_healed_ally", "survivor_on_revealed_generator", "survivor_safe_rescue", "survivor_ally_two_hook_states", "survivor_hyperfocus_six_tokens", "survivor_last_alive", "survivor_deep_wound", "survivor_aura_visible_to_killer", "survivor_hex_cleansed", "survivor_coop_repair", "survivor_six_tokens", "survivor_in_basement", "survivor_four_alive", "survivor_healing_downed_ally", "survivor_five_tokens", "survivor_using_flashlight", "survivor_boon_active"
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
