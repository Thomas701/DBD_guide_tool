import type { EffectCondition } from "../domain/condition.js";
import type { EffectUnit, PerkEffect } from "../domain/effect.js";

const carrying = condition("carrying_survivor");
const insideTerrorRadius = condition("inside_terror_radius");
const afterHook = condition("after_hook");
const generatorDamaged = condition("generator_damaged");
const perkTriggered = condition("perk_triggered");
const hexActive = condition("hex_active");

/** Corrections vérifiées depuis les descriptions locales et statistiques_fixe.txt. */
export const PERK_EFFECT_OVERRIDES: Readonly<Record<string, readonly PerkEffect[]>> = {
  "agitation": [
    multiply("killer.carry_speed", 1.18, carrying),
    add("killer.terror_radius", 12, "meters", carrying)
  ],
  "brutal-strength": [
    multiply("killer.pallet_break_time", 1.2),
    multiply("killer.wall_break_time", 1.2),
    multiply("generator.damage_time", 1.2)
  ],
  "unnerving-presence": [
    add("generator.skill_check_chance", 10, "percentage_points", insideTerrorRadius),
    multiply("generator.skill_check_good_zone", 0.4, insideTerrorRadius),
    multiply("healing.skill_check_good_zone", 0.4, insideTerrorRadius)
  ],
  "bloodhound": [add("tracking.blood_pool_lifetime", 4, "seconds", condition("survivor_injured"))],
  "thanatophobia": [
    multiply("generator.repair_time", 0.8, condition("four_survivors_injured")),
    multiply("hook.sabotage_time", 0.8, condition("four_survivors_injured")),
    multiply("totem.dull_cleanse_time", 0.8, condition("four_survivors_injured")),
    multiply("totem.hex_cleanse_time", 0.8, condition("four_survivors_injured"))
  ],
  "monitor-and-abuse": [
    multiply("killer.terror_radius", 1.15, condition("in_chase")),
    multiply("killer.terror_radius", 0.75, condition("not_in_chase"))
  ],
  "hex-huntress-lullaby": [
    add("generator.skill_check_failure_penalty", 6, "percentage_points", hexActive),
    add("healing.skill_check_failure_penalty", 6, "percentage_points", hexActive),
    setValue("skill_check.warning_delay", 0, "percent", all(hexActive, condition("lullaby_five_tokens")))
  ],
  "bamboozle": [multiply("killer.window_vault_time", 1.15)],
  "enduring": [multiply("killer.pallet_stun_duration", 0.5)],
  "unrelenting": [multiply("killer.missed_attack_recovery_time", 1.3)],
  "mad-grit": [
    setValue("killer.missed_attack_recovery_time", 0, "seconds", carrying),
    status("hook.wiggle_paused", 4, all(carrying, condition("after_basic_attack")))
  ],
  "dissolution": [
    setValue("killer.pallet_break_time", 0, "seconds", all(perkTriggered, condition("after_survivor_vault"), insideTerrorRadius), 20)
  ],
  "stridor": [
    multiply("sound.grunt_volume", 1.5),
    multiply("sound.breathing_volume", 1.25)
  ],
  "iron-maiden": [
    multiply("locker.search_time", 1.5),
    status("survivor.status.exposed", 30, condition("perk_triggered"))
  ],
  "coulrophobia": [
    multiply("healing.time", 0.7, insideTerrorRadius),
    multiply("healing.skill_check_pointer_speed", 1.5, insideTerrorRadius)
  ],
  "iron-grasp": [
    multiply("hook.wiggle_time", 0.88, carrying),
    multiply("hook.wiggle_strength", 0.25, carrying)
  ],
  "batteries-included": [
    multiply("killer.speed", 1.05, condition("near_completed_generator"), 5)
  ],
  "forced-hesitation": [
    multiply("survivor.run_speed", 0.8, condition("survivor_downed"), 10, 30)
  ],
  "hex-nothing-but-misery": [
    multiply("survivor.run_speed", 0.95, all(hexActive, condition("after_basic_attack")), 15)
  ],
  "hex-scared-to-death": [
    multiply("survivor.run_speed", 0.87, all(hexActive, condition("in_chase")), 3)
  ],
  "keep-them-waiting": [
    multiply("killer.successful_attack_recovery_time", 0.6, perkTriggered)
  ],
  "help-wanted": [{
    ...multiply("killer.successful_attack_recovery_time", 1.25, condition("compromised_generator_completed"), 60),
    calculationMode: "action_speed"
  }],
  "shadowborn": [multiply("killer.speed", 1.1, condition("after_blind"), 10)],
  "rapid-brutality": [multiply("killer.speed", 1.05, condition("after_basic_attack"), 10)],
  "furtive-chase": [
    multiply("killer.speed", 1.1, condition("obsession_hooked"), 18),
    status("killer.status.undetectable", 18, condition("obsession_hooked"))
  ],
  "machine-learning": [
    multiply("killer.speed", 1.08, condition("generator_completed"), 60),
    status("killer.status.undetectable", 60, condition("generator_completed"))
  ],
  "rampage": [multiply("killer.speed", 1.13, perkTriggered, 13, 20)],
  "see-how-they-run": [multiply("killer.speed", 1.15, all(hexActive, perkTriggered))],
  "hex-no-one-escapes-death": [
    multiply("killer.speed", 1.04, all(condition("exit_gates_powered"), hexActive)),
    status("survivor.status.exposed", null, all(condition("exit_gates_powered"), hexActive))
  ],
  "sloppy-butcher": [
    multiply("healing.time", 0.8, condition("after_basic_attack"), 90),
    status("survivor.status.mangled", 90, condition("after_basic_attack")),
    status("survivor.status.hemorrhage", 90, condition("after_basic_attack"))
  ],
  "scourge-hook-weeping-wounds": [
    multiply("healing.time", 0.84, condition("survivor_unhooked")),
    multiply("generator.repair_time", 0.84, condition("survivor_unhooked")),
    status("survivor.status.hemorrhage", 90, condition("survivor_unhooked"))
  ],
  "leverage": [multiply("healing.time", 0.7, condition("survivor_unhooked"), 60)],
  "blood-echo": [
    status("survivor.status.exhausted", 30, afterHook),
    status("survivor.status.hemorrhage", 30, afterHook)
  ],
  "forced-penance": [status("survivor.status.broken", 80, condition("perk_triggered"))],
  "terminus": [status("survivor.status.broken", 45, condition("exit_gates_powered"))],
  "hex-the-third-seal": [status("survivor.status.blindness", null, all(hexActive, condition("after_basic_attack")))],
  "spirit-fury": [status("chase.instant_pallet_break", null, perkTriggered)],
  "franklins-demise": [
    status("item.forced_drop", null, condition("after_basic_attack")),
    reveal("item.aura.within_64m", null, condition("after_basic_attack"))
  ],
  "whispers": [status("tracking.whispers", null, condition("survivor_within_32m"))],
  "oppression": [
    status("generator.additional_regression", null, generatorDamaged),
    status("generator.difficult_skill_check", null, generatorDamaged)
  ],
  "call-of-brine": [
    multiply("generator.regression_rate", 1.5, generatorDamaged, 90),
    reveal("generator.aura", 90, generatorDamaged)
  ],
  "hex-ruin": [multiply("generator.regression_rate", 1.5, hexActive)],
  "overcharge": [
    add("generator.damage_penalty", 4, "percentage_points", generatorDamaged),
    multiply("generator.regression_rate", 1.3, generatorDamaged, 30)
  ],
  "pop-goes-the-weasel": [
    add("generator.damage_penalty", 15, "percentage_points", all(afterHook, generatorDamaged), 45)
  ],
  "eruption": [
    multiply("generator.progress", 0.9, condition("survivor_downed"), null, 30),
    reveal("survivor.aura", 12, condition("survivor_downed"))
  ],
  "scourge-hook-pain-resonance": [multiply("generator.progress", 0.8, afterHook)],
  "surge": [multiply("generator.progress", 0.92, condition("survivor_downed"))],
  "turn-back-the-clock": [multiply("generator.progress", 0.9, all(afterHook, perkTriggered), 60)],
  "hex-hive-mind": [multiply("generator.progress", 0.9, all(hexActive, condition("four_generators_completed")))],
  "undone": [
    multiply("generator.progress", 0.7, all(condition("skill_check_failed"), generatorDamaged), null, 60),
    block("generator.lock", 30, all(condition("skill_check_failed"), generatorDamaged))
  ],
  "scourge-hook-monstrous-shrine": [
    multiply("hook.phase_duration", 1.2, condition("survivor_hooked"))
  ],
  "forever-entwined": [
    multiply("hook.hook_time", 1.32, condition("forever_entwined_max_tokens")),
    status("hook.pickup_drop_action_speed", null, condition("forever_entwined_max_tokens"))
  ],
  "all-shaking-thunder": [
    multiply("killer.lunge_range", 1.75, condition("after_fall"), 25, 5)
  ],
  "coup-de-grace": [multiply("killer.lunge_range", 1.8, perkTriggered)],
  "dark-arrogance": [multiply("killer.window_vault_time", 1.25)],
  "superior-anatomy": [multiply("killer.window_vault_time", 1.4, condition("after_survivor_vault"))],
  "fire-up": [
    multiply("killer.window_vault_time", 1.06, condition("generator_completed")),
    multiply("killer.pallet_break_time", 1.06, condition("generator_completed")),
    multiply("killer.wall_break_time", 1.06, condition("generator_completed")),
    multiply("generator.damage_time", 1.06, condition("generator_completed"))
  ],
  "remember-me": [add("exit_gate.open_time", 30, "seconds", perkTriggered)],
  "haywire": [setValue("exit_gate.regression_rate", 100, "percent", condition("exit_gate_progress_80"))],
  "blood-warden": [
    block("exit_gate.lock", 60, all(condition("exit_gate_open"), condition("survivor_hooked"))),
    reveal("survivor.aura.exit_gate", null, condition("exit_gate_open"))
  ],
  "no-way-out": [block("exit_gate.lock", 60, all(condition("exit_gates_powered"), perkTriggered))],
  "corrupt-intervention": [block("generator.lock", 120, perkTriggered)],
  "dead-mans-switch": [block("generator.lock", 35, afterHook)],
  "grim-embrace": [block("generator.lock", 40, afterHook)],
  "merciless-storm": [block("generator.lock", 20, condition("generator_at_90_percent"))],
  "no-holds-barred": [block("generator.lock", 25, condition("generator_completed"))],
  "thrilling-tremors": [block("generator.lock", 16, condition("after_pickup"), 30)],
  "hex-blood-favor": [block("chase.palette_lock", 15, all(hexActive, condition("survivor_lost_health_state")))],
  "hex-crowd-control": [block("chase.window_lock", 15, all(hexActive, condition("after_survivor_vault")))],
  "none-are-free": [
    block("chase.palette_lock", 16, perkTriggered),
    block("chase.window_lock", 16, perkTriggered)
  ],
  "hex-wretched-fate": [
    multiply("generator.repair_time", 0.67, all(hexActive, condition("generator_completed"), condition("target_is_obsession")))
  ],
  "unbound": [
    multiply("killer.speed", 1.07, all(condition("survivor_injured"), condition("after_killer_vault")), 10)
  ],
  "hex-pentimento": [
    multiply("healing.time", 0.68, all(hexActive, condition("pentimento_five_tokens"))),
    multiply("generator.repair_time", 0.68, all(hexActive, condition("pentimento_five_tokens"))),
    status("totem.rekindled_blocked", null, all(hexActive, condition("pentimento_five_tokens")))
  ]
};

function multiply(
  stat: string,
  value: number,
  conditionValue?: EffectCondition,
  duration?: number | null,
  cooldown?: number | null
): PerkEffect {
  return effect(stat, "multiply", value, "multiplier", conditionValue, duration, cooldown);
}

function add(
  stat: string,
  value: number,
  unit: EffectUnit,
  conditionValue?: EffectCondition,
  duration?: number | null
): PerkEffect {
  return effect(stat, "add", value, unit, conditionValue, duration);
}

function setValue(
  stat: string,
  value: number,
  unit: EffectUnit,
  conditionValue?: EffectCondition,
  duration?: number | null
): PerkEffect {
  return effect(stat, "set", value, unit, conditionValue, duration);
}

function status(stat: string, duration: number | null, conditionValue?: EffectCondition): PerkEffect {
  const result: PerkEffect = { stat, operation: "apply_status", interpretation: "verified", value: true, unit: "boolean" };
  if (duration !== undefined) result.duration = duration;
  if (conditionValue) result.condition = conditionValue;
  return result;
}

function reveal(stat: string, duration: number | null, conditionValue?: EffectCondition): PerkEffect {
  const result: PerkEffect = { stat, operation: "reveal", interpretation: "verified", value: true, unit: "boolean", duration };
  if (conditionValue) result.condition = conditionValue;
  return result;
}

function block(stat: string, duration: number, conditionValue?: EffectCondition, cooldown?: number): PerkEffect {
  const result: PerkEffect = { stat, operation: "block", interpretation: "verified", duration, unit: "seconds" };
  if (conditionValue) result.condition = conditionValue;
  if (cooldown !== undefined) result.cooldown = cooldown;
  return result;
}

function effect(
  stat: string,
  operation: "add" | "multiply" | "set",
  value: number,
  unit: EffectUnit,
  conditionValue?: EffectCondition,
  duration?: number | null,
  cooldown?: number | null
): PerkEffect {
  const result: PerkEffect = { stat, operation, interpretation: "verified", value, unit };
  if (conditionValue) result.condition = conditionValue;
  if (duration !== undefined) result.duration = duration;
  if (cooldown !== undefined) result.cooldown = cooldown;
  return result;
}

function condition(type: string): EffectCondition {
  return { type };
}

function all(...conditions: EffectCondition[]): EffectCondition {
  return { operator: "all", conditions };
}
