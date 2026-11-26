import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PerkEffect } from "../src/domain/effect.js";
import type { Killer } from "../src/domain/killer.js";
import type { Perk } from "../src/domain/perk.js";
import { createCurrentBuildExport, type CurrentBuildExport } from "../src/services/local-data.js";
import { PERK_EFFECT_OVERRIDES } from "../src/data/perk-effect-overrides.js";
import { SURVIVOR_PERK_EFFECTS } from "../src/data/survivor-perk-effects.js";
import { answerBuildQuestion } from "../src/services/build-assistant.js";
import { ASSISTANT_PROVIDER_IDS, createAssistantProvider, normalizeServerUrl } from "../src/services/assistant-provider.js";
import { readAppSession } from "../src/services/app-session.js";
import { blindTestResultComment, findBlindTestAudioFile, getBlindTestPlayback, killerBreathingFileNames, pickWeightedBlindTestTrack } from "../src/services/blind-test.js";
import { BUILD_STACKING_POLICY, calculateBuild, collectBuildConditions } from "../src/services/build-calculator.js";
import { buildChatGPTPrompt } from "../src/services/chatgpt-prompt-builder.js";
import { buildNativeChatPrompt } from "../src/services/native-chat-prompt.js";
import { buildAssistantContext, perkDescriptionToText, richDescriptionToText } from "../src/services/openai-build-assistant.js";

const killer: Killer = {
  id: "test-killer",
  name: { fr: "Tueur test", en: "Test Killer" },
  speed: 4.6,
  terrorRadius: 32,
  size: "normal",
  tier: "B+",
  difficulty: "normal",
  portrait: null
};

function survivorAnalysis(ids: string[], conditions: Record<string, boolean> = {}) {
  const perks = ids.map((id) => ({ ...perk(`survivor-${id}`, [...SURVIVOR_PERK_EFFECTS[`survivor-${id}`]!]), side: "survivor" as const }));
  return calculateBuild({ killer: { ...killer, id: "jake", speed: 4, terrorRadius: 0 }, perks, side: "survivor", scenario: { conditions, perkStates: Object.fromEntries(perks.map(({ id }) => [id, "active" as const])) } });
}

test("les vitesses et soins survivants utilisent leurs références et leur point de vue", () => {
  const lithe = survivorAnalysis(["lithe"], { after_survivor_vault: true, survivor_exhausted: false });
  assert.equal(lithe.baseStats.speed, 4);
  assert.equal(lithe.finalStats.speed, 6);
  assert.ok(lithe.stats["survivor.run_speed"]!.benefit! > 0);
  assert.equal(survivorAnalysis(["botany-knowledge"]).stats["healing.time"]?.final, 10.666667);
  assert.ok(survivorAnalysis(["botany-knowledge"]).stats["healing.time"]!.benefit! > 0);
  assert.equal(survivorAnalysis(["self-care"]).stats["survivor.self_heal_time"]?.final, 45.714286);
  assert.equal(survivorAnalysis(["unbreakable"], { survivor_downed: true }).stats["survivor.recovery_time"]?.final, 22.518519);
  assert.equal(survivorAnalysis(["urban-evasion"]).stats["survivor.crouch_speed"]?.final, 2.26);
  assert.equal(survivorAnalysis(["fixated"]).stats["survivor.walk_speed"]?.final, 2.712);
});

test("la progression permanente, les soins reçus et les réparations coopératives sont distincts", () => {
  assert.equal(survivorAnalysis(["fast-track"], { perk_triggered: true }).stats["generator.permanent_progress"]?.final, 13.5);
  assert.equal(survivorAnalysis(["specialist"], { survivor_six_tokens: true }).stats["generator.permanent_progress"]?.final, 21.6);
  assert.equal(survivorAnalysis(["lend-a-hand"], { perk_triggered: true }).stats["ally.healing_progress_charges"]?.final, 4);
  assert.equal(survivorAnalysis(["invocation-weaving-spiders"], { perk_triggered: true }).stats["generator.required_charges"]?.final, 80);
  assert.equal(survivorAnalysis(["prove-thyself"], { survivor_coop_repair: true }).stats["generator.coop_repair_time"]?.final, 48.128342);
  assert.equal(survivorAnalysis(["deja-vu"], { survivor_on_revealed_generator: true }).stats["generator.repair_time"]?.final, 84.90566);
  assert.equal(survivorAnalysis(["resurgence"], { survivor_unhooked: true }).stats["survivor.healing_progress"]?.final, 70);
  assert.equal(survivorAnalysis(["flow-state"], { survivor_five_tokens: true }).stats["generator.repair_time"], undefined);
});

test("les bonus aux alliés et le ralentissement adverse ne modifient pas votre vitesse", () => {
  const babysitter = survivorAnalysis(["babysitter"], { survivor_rescued_ally: true });
  assert.equal(babysitter.stats["ally.run_speed"]?.final, 4.4);
  assert.equal(babysitter.finalStats.speed, 4);
  const leader = survivorAnalysis(["leader"], { perk_triggered: true });
  assert.equal(leader.stats["healing.time"], undefined);
  assert.equal(leader.stats["generator.repair_time"], undefined);
  assert.equal(leader.stats["ally.healing_time"]?.final, 12.307692);
  const trap = survivorAnalysis(["chemical-trap"], { perk_triggered: true });
  assert.equal(trap.stats["opponent.speed"]?.final, 2.3);
  assert.equal(trap.stats["opponent.speed"]?.approximate, true);
  assert.ok(trap.stats["opponent.speed"]!.benefit! > 0);
  assert.equal(trap.finalStats.speed, 4);
});

test("épuisement, santé et cooldown n’annulent pas les effets passifs indépendants", () => {
  assert.equal(survivorAnalysis(["lithe"], { after_survivor_vault: true, survivor_exhausted: true }).finalStats.speed, 4);
  assert.equal(survivorAnalysis(["finesse"], { survivor_healthy: false, perk_triggered: true }).stats["survivor.window_vault_time"]?.final, .5);
  const wglf = { ...perk("survivor-we-re-gonna-live-forever", [...SURVIVOR_PERK_EFFECTS["survivor-we-re-gonna-live-forever"]!]), side: "survivor" as const, cooldown: 30 };
  const result = calculateBuild({ killer, perks: [wglf], scenario: { conditions: { survivor_healing_downed_ally: true, survivor_healed_ally: true }, perkStates: { [wglf.id]: "inactive" } } });
  assert.equal(result.stats["healing.time"]?.final, 8);
  assert.equal(result.qualitativeEffects.find(({ stat }) => stat === "survivor.status.endurance")?.active, false);
});

test("les synergies d’aura survivant prolongent la durée et la portée compatibles", () => {
  const result = survivorAnalysis(["eyes-of-belmont", "alert", "bond", "open-handed"], { generator_completed: true, perk_triggered: true });
  assert.equal(result.qualitativeEffects.find(({ perkId }) => perkId === "survivor-alert")?.duration, 7);
  assert.equal(result.qualitativeEffects.find(({ perkId, stat }) => perkId === "survivor-eyes-of-belmont" && stat === "killer.aura")?.duration, 5);
  assert.equal(result.qualitativeEffects.find(({ perkId }) => perkId === "survivor-bond")?.range, 52);
  assert.equal(result.qualitativeEffects.find(({ perkId }) => perkId === "survivor-bond")?.duration, undefined);
});

test("les reworks survivants respectent les actions et les phases auxquelles ils s’appliquent", () => {
  const windows = survivorAnalysis(["windows-of-opportunity"], { perk_triggered: true });
  assert.equal(windows.stats["survivor.window_vault_time"]?.final, .454545);
  assert.equal(windows.stats["survivor.pallet_vault_time"], undefined);
  const finesse = survivorAnalysis(["finesse"], { survivor_healthy: true, perk_triggered: true });
  assert.equal(finesse.stats["survivor.medium_vault_time"], undefined);
  assert.equal(finesse.stats["survivor.slow_vault_time"], undefined);
  assert.equal(survivorAnalysis(["wake-up"], { exit_gates_powered: true, survivor_four_alive: true }).stats["exit_gate.open_time"]?.final, 11.764706);
  assert.equal(survivorAnalysis(["resilience"], { survivor_injured: true }).stats["exit_gate.open_time"]?.final, 18.348624);
  assert.equal(survivorAnalysis(["calm-spirit"]).stats["chest.open_time"]?.final, 7.272727);
  const illumination = survivorAnalysis(["boon-illumination"], { survivor_boon_active: true, survivor_inside_boon: false });
  assert.equal(illumination.stats["totem.dull_bless_time"]?.final, 4.666667);
  assert.equal(illumination.stats["totem.dull_cleanse_time"], undefined);
  const roadLife = survivorAnalysis(["road-life"], { survivor_injured: true, perk_triggered: true });
  assert.equal(roadLife.stats["survivor.self_heal_time"]?.final, 14.545455);
  assert.equal(roadLife.stats["healing.time"], undefined);
  const plotTwist = survivorAnalysis(["plot-twist"], { survivor_downed: true, survivor_healthy: false, perk_triggered: true });
  assert.equal(plotTwist.finalStats.speed, 4);
  assert.equal(plotTwist.stats["survivor.recovery_time"]?.final, 24.32);
  assert.equal(survivorAnalysis(["no-mither"]).qualitativeEffects[0]?.active, true);
});

test("calcule 4.6 m/s + 5 % = 4.83 m/s", () => {
  const result = calculateBuild({
    killer,
    perks: [perk("speed", [{
      stat: "killer.speed",
      operation: "multiply",
      interpretation: "verified",
      value: 5,
      unit: "percent"
    }])],
  });

  assert.equal(result.baseStats.speed, 4.6);
  assert.equal(result.finalStats.speed, 4.83);
  assert.equal(result.deltas.speed.absolute, 0.23);
  assert.equal(result.deltas.speed.percent, 5);
});

test("refuse un cumul mixte dont l'ordre métier n'est pas vérifié", () => {
  const result = calculateBuild({
    killer,
    perks: [perk("terror", [
      {
        stat: "killer.terror_radius",
        operation: "multiply",
        interpretation: "verified",
        value: 1.25,
        unit: "multiplier"
      },
      {
        stat: "killer.terror_radius",
        operation: "add",
        interpretation: "verified",
        value: 8,
        unit: "meters"
      }
    ])]
  });

  assert.equal(result.finalStats.terrorRadius, 32);
  assert.equal(result.unresolvedEffects.length, 2);
  assert.match(result.unresolvedEffects[0]?.reasons.at(-1) ?? "", /Ordre de cumul mixte/);
  assert.equal(result.stackingPolicy, BUILD_STACKING_POLICY);
});

test("set remplace la valeur de base du rayon de terreur", () => {
  const result = calculateBuild({
    killer,
    perks: [perk("set-terror", [{
      stat: "killer.terror_radius",
      operation: "set",
      interpretation: "verified",
      value: 24,
      unit: "meters"
    }])]
  });

  assert.equal(result.finalStats.terrorRadius, 24);
  assert.equal(result.deltas.terrorRadius.absolute, -8);
});

test("trace les conditions génériques actives et inactives avec leur raison", () => {
  const result = calculateBuild({
    killer,
    perks: [
      perk("active", [{
        stat: "killer.speed",
        operation: "multiply",
        interpretation: "verified",
        value: 1.05,
        unit: "multiplier",
        condition: {
          operator: "all",
          conditions: [
            { type: "carrying_survivor" },
            { operator: "not", condition: { type: "in_chase" } }
          ]
        }
      }]),
      perk("inactive", [{
        stat: "killer.terror_radius",
        operation: "add",
        interpretation: "verified",
        value: 8,
        unit: "meters",
        condition: { type: "near_completed_generator", parameters: { distance: 16 } }
      }])
    ],
    scenario: {
      conditions: { carrying_survivor: true, in_chase: false },
      perkStates: {}
    }
  });

  assert.equal(result.finalStats.speed, 4.83);
  assert.equal(result.finalStats.terrorRadius, 32);
  assert.equal(result.activeEffects[0]?.perkId, "active");
  assert.equal(result.inactiveEffects[0]?.perkId, "inactive");
  assert.equal(
    result.inactiveEffects[0]?.reasons.includes("Condition manquante : near_completed_generator"),
    true
  );
});

test("refuse une unité incompatible au lieu de modifier silencieusement la vitesse", () => {
  const result = calculateBuild({
    killer,
    perks: [perk("bad-unit", [{
      stat: "killer.speed",
      operation: "add",
      interpretation: "verified",
      value: 5,
      unit: "seconds"
    }])]
  });

  assert.equal(result.finalStats.speed, 4.6);
  assert.equal(result.unresolvedEffects[0]?.perkId, "bad-unit");
  assert.match(result.unresolvedEffects[0]?.reasons.at(-1) ?? "", /Unité incompatible/);
});

test("considère le cooldown comme inactif", () => {
  const temporary = perk("temporary", [{
    stat: "killer.speed",
    operation: "multiply",
    interpretation: "inferred",
    value: 1.05,
    unit: "multiplier",
    duration: 5
  }]);

  const inactive = calculateBuild({ killer, perks: [temporary] });
  const active = calculateBuild({
    killer,
    perks: [temporary],
    scenario: { conditions: {}, perkStates: { temporary: "active" } }
  });
  const cooldown = calculateBuild({
    killer,
    perks: [temporary],
    scenario: { conditions: {}, perkStates: { temporary: "cooldown" } }
  });

  assert.equal(inactive.finalStats.speed, 4.6);
  assert.equal(active.finalStats.speed, 4.83);
  assert.equal(active.activeEffects[0]?.reasons.includes("Effet déclenché dans la simulation"), true);
  assert.equal(cooldown.finalStats.speed, 4.6);
  assert.equal(cooldown.inactiveEffects[0]?.perkId, "temporary");
});

test("ne traite pas une durée et un cooldown null comme un effet temporaire", () => {
  const result = calculateBuild({
    killer,
    perks: [perk("permanent", [{
      stat: "killer.speed",
      operation: "multiply",
      interpretation: "verified",
      value: 5,
      unit: "percent",
      duration: null,
      cooldown: null
    }])]
  });

  assert.equal(result.finalStats.speed, 4.83);
  assert.equal(result.activeEffects[0]?.conditionActive, true);
  assert.equal(result.activeEffects[0]?.active, true);
});

test("refuse une statistique héritée du prototype de l'objet de mapping", () => {
  const result = calculateBuild({
    killer,
    perks: [perk("prototype-stat", [{
      stat: "toString",
      operation: "add",
      interpretation: "verified",
      value: 8,
      unit: "meters"
    }])]
  });

  assert.equal(result.activeEffects.length, 0);
  assert.equal(result.unresolvedEffects[0]?.perkId, "prototype-stat");
  assert.match(result.unresolvedEffects[0]?.reasons.at(-1) ?? "", /sans référence fiable/);
});

test("n'active pas une condition absente héritée du prototype", () => {
  const result = calculateBuild({
    killer,
    perks: [perk("prototype-condition", [{
      stat: "killer.speed",
      operation: "multiply",
      interpretation: "verified",
      value: 5,
      unit: "percent",
      condition: { type: "__proto__" }
    }])]
  });

  assert.equal(result.finalStats.speed, 4.6);
  assert.equal(result.inactiveEffects[0]?.perkId, "prototype-condition");
});

test("divise un temps par le bonus de vitesse d'action", () => {
  const result = calculateBuild({
    killer,
    perks: [perk("brutal-strength", [...(PERK_EFFECT_OVERRIDES["brutal-strength"] ?? [])])]
  });

  assert.equal(result.stats["killer.pallet_break_time"]?.base, 2.34);
  assert.equal(result.stats["killer.pallet_break_time"]?.final, 1.95);
  assert.equal(result.stats["killer.pallet_break_time"]?.delta, -0.39);
  assert.equal(result.stats["generator.damage_time"]?.final, 1.5);
});

test("calcule 16 s avec +50 % de vitesse en 10.666667 s", () => {
  const result = calculateBuild({
    killer,
    perks: [perk("healing-speed", [{
      stat: "healing.time",
      operation: "multiply",
      interpretation: "verified",
      value: 1.5,
      unit: "multiplier"
    }])]
  });

  assert.equal(result.stats["healing.time"]?.final, 10.666667);
});

test("distingue une durée multipliée d'une vitesse d'action", () => {
  const result = calculateBuild({
    killer,
    perks: [perk("enduring", [...(PERK_EFFECT_OVERRIDES.enduring ?? [])])],
    scenario: { conditions: { pallet_stunned: true }, perkStates: {} }
  });

  assert.equal(result.stats["killer.pallet_stun_duration"]?.base, 2);
  assert.equal(result.stats["killer.pallet_stun_duration"]?.final, 1);
});

test("permet à un effet de vitesse d'action de cibler une durée de référence", () => {
  const recoverySpeed = calculateBuild({
    killer,
    perks: [perk("help-wanted", [...(PERK_EFFECT_OVERRIDES["help-wanted"] ?? [])])],
    scenario: { conditions: { compromised_generator_completed: true }, perkStates: {} }
  });
  const durationReduction = calculateBuild({
    killer,
    perks: [perk("keep-them-waiting", [...(PERK_EFFECT_OVERRIDES["keep-them-waiting"] ?? [])])],
    scenario: { conditions: { perk_triggered: true }, perkStates: {} }
  });

  assert.equal(recoverySpeed.stats["killer.successful_attack_recovery_time"]?.final, 2.025);
  assert.equal(durationReduction.stats["killer.successful_attack_recovery_time"]?.final, 1.62);
});

test("ajoute des points de pourcentage à une probabilité", () => {
  const result = calculateBuild({
    killer,
    perks: [perk("unnerving-presence", [...(PERK_EFFECT_OVERRIDES["unnerving-presence"] ?? [])])],
    scenario: { conditions: { inside_terror_radius: true }, perkStates: {} }
  });

  assert.equal(result.stats["generator.skill_check_chance"]?.base, 8);
  assert.equal(result.stats["generator.skill_check_chance"]?.final, 18);
});

test("les reworks remplacent les anciens effets et appliquent les bonnes bases", () => {
  function compute(id: string, conditions: Record<string, boolean> = {}) {
    return calculateBuild({ killer, perks: [perk(id, [...PERK_EFFECT_OVERRIDES[id]!])], scenario: { conditions, perkStates: { [id]: "active" } } });
  }
  assert.equal(compute("unrelenting").stats["killer.missed_attack_recovery_time"]?.final, .9);
  assert.equal(compute("unrelenting").stats["killer.successful_attack_recovery_time"]?.final, 2.43);
  assert.equal(compute("iron-grasp", { carrying_survivor: true }).stats["hook.wiggle_time"]?.final, 17.92);
  assert.equal(compute("undone", { generator_damaged: true, perk_triggered: true }).stats["generator.instant_regression"]?.final, 27);
  assert.ok(!collectBuildConditions([perk("undone", [...PERK_EFFECT_OVERRIDES.undone!])]).includes("skill_check_failed"));
  const shrine = compute("scourge-hook-monstrous-shrine", { survivor_hooked: true, scourge_hook: true, far_from_hook: true });
  assert.equal(shrine.stats["generator.regression_rate"]?.final, .5);
  assert.equal(shrine.stats["hook.phase_duration"], undefined);
  assert.equal(compute("fire-up", { fire_up_five_tokens: true }).stats["killer.pallet_break_time"]?.final, 1.671429);
  assert.equal(compute("none-are-free", { exit_gates_powered: true, perk_triggered: true }).qualitativeEffects[0]?.duration, 64);
});

test("les cumuls de bonus utilisent les rendements décroissants et restent indépendants de l’ordre des perks", () => {
  const selected = [perk("brutal-strength", [...PERK_EFFECT_OVERRIDES["brutal-strength"]!]), perk("fire-up", [...PERK_EFFECT_OVERRIDES["fire-up"]!])];
  const calculate = (perks: Perk[]) => calculateBuild({ killer, perks, scenario: { conditions: { fire_up_five_tokens: true }, perkStates: {} } });
  assert.equal(calculate(selected).stats["killer.pallet_break_time"]?.final, 1.56); // 2,34 / (1 + 0,40 + 0,20 × 0,5)
  assert.equal(calculate([...selected].reverse()).stats["killer.pallet_break_time"]?.final, 1.56);
  assert.ok(calculate(selected).activeEffects.some(({ reasons }) => reasons.some((reason) => reason.startsWith("Rendements"))));
});

test("Poursuivant meurtrier prolonge les auras temporisées mais pas les auras continues", () => {
  const ids = ["lethal-pursuer", "barbecue-and-chilli", "a-nurses-calling"];
  const result = calculateBuild({ killer, perks: ids.map((id) => perk(id, [...PERK_EFFECT_OVERRIDES[id]!])), scenario: { conditions: { trial_start: true, after_hook: true, healing_within_32m: true }, perkStates: {} } });
  assert.equal(result.qualitativeEffects.find(({ perkId, stat }) => perkId === "lethal-pursuer" && stat === "survivor.aura")?.duration, 11);
  assert.equal(result.qualitativeEffects.find(({ perkId }) => perkId === "barbecue-and-chilli")?.duration, 7);
  assert.equal(result.qualitativeEffects.find(({ perkId }) => perkId === "a-nurses-calling")?.duration, undefined);
});

test("utilise la vitesse de transport sans modifier la vitesse normale", () => {
  const agitation = perk("agitation", [...(PERK_EFFECT_OVERRIDES.agitation ?? [])]);
  const inactive = calculateBuild({ killer, perks: [agitation] });
  const active = calculateBuild({
    killer,
    perks: [agitation],
    scenario: { conditions: { carrying_survivor: true }, perkStates: {} }
  });

  assert.equal(inactive.stats["killer.carry_speed"]?.final, 3.68);
  assert.equal(active.stats["killer.carry_speed"]?.final, 4.3424);
  assert.equal(active.finalStats.speed, 4.6);
  assert.equal(active.finalStats.terrorRadius, 44);
});

test("calcule la durée des flaques de sang avec Limier", () => {
  const result = calculateBuild({
    killer,
    perks: [perk("bloodhound", [...(PERK_EFFECT_OVERRIDES.bloodhound ?? [])])],
    scenario: { conditions: { blood_pool_present: true }, perkStates: {} }
  });

  assert.equal(result.stats["tracking.blood_pool_lifetime"]?.base, 4);
  assert.equal(result.stats["tracking.blood_pool_lifetime"]?.final, 8);
  assert.equal(result.unresolvedEffects.length, 0);
});

test("calcule Prédateur uniquement avec la poursuite abandonnée", () => {
  const predator = perk("predator", [...(PERK_EFFECT_OVERRIDES.predator ?? [])]);
  predator.cooldown = 40;
  const result = calculateBuild({
    killer,
    perks: [predator],
    scenario: { conditions: { chase_abandoned: true }, perkStates: { predator: "active" } }
  });

  assert.equal(result.qualitativeEffects[0]?.duration, 4);
  assert.equal(result.inactiveEffects.length, 0);
});

test("calcule Rejeton de la lumière avec un aveuglement", () => {
  const lightborn = perk("lightborn", [...(PERK_EFFECT_OVERRIDES.lightborn ?? [])]);
  const result = calculateBuild({
    killer,
    perks: [lightborn],
    scenario: { conditions: { blind_attempted: true }, perkStates: {} }
  });

  assert.equal(result.qualitativeEffects.find((effect) => effect.stat === "survivor.aura")?.duration, 10);
  assert.equal(result.inactiveEffects.length, 0);
});

test("calcule Réparateur avec un générateur à 70 %", () => {
  const result = calculateBuild({
    killer,
    perks: [perk("tinkerer", [...(PERK_EFFECT_OVERRIDES.tinkerer ?? [])])],
    scenario: { conditions: { generator_at_70_percent: true }, perkStates: {} }
  });

  assert.equal(result.qualitativeEffects[0]?.duration, 16);
  assert.equal(result.inactiveEffects.length, 0);
});

test("décrit Vocation de l’infirmière comme une révélation continue conditionnelle à 32 m", () => {
  const result = calculateBuild({
    killer,
    perks: [perk("a-nurses-calling", [...(PERK_EFFECT_OVERRIDES["a-nurses-calling"] ?? [])])],
    scenario: { conditions: { healing_within_32m: true }, perkStates: {} }
  });

  assert.equal(result.qualitativeEffects[0]?.stat, "survivor.aura");
  assert.equal(result.qualitativeEffects[0]?.status, "active");
  assert.equal(result.affectedStats.length, 0);
});

test("applique les paliers de Mangeur d’espoir", () => {
  const perkEffects = [...(PERK_EFFECT_OVERRIDES["hex-devour-hope"] ?? [])];
  const result = calculateBuild({
    killer,
    perks: [perk("hex-devour-hope", perkEffects)],
    scenario: { conditions: { hex_active: true, after_hook: true, survivor_downed: true, devour_hope_2_tokens: true, devour_hope_3_tokens: true, devour_hope_5_tokens: true }, perkStates: {} }
  });

  assert.equal(result.stats["killer.speed"]?.final, 4.83);
  assert.equal(result.qualitativeEffects.filter((effect) => effect.status === "active").length, 2);
  assert.ok(result.qualitativeEffects.some((effect) => effect.stat === "survivor.kill_available"));
});

test("affiche un statut qualitatif et respecte sa condition", () => {
  const terminus = perk("terminus", [...(PERK_EFFECT_OVERRIDES.terminus ?? [])]);
  const inactive = calculateBuild({ killer, perks: [terminus] });
  const active = calculateBuild({
    killer,
    perks: [terminus],
    scenario: { conditions: { exit_gates_powered: true, survivor_injured: true }, perkStates: {} }
  });

  assert.equal(inactive.qualitativeEffects[0]?.status, "inactive");
  assert.equal(active.qualitativeEffects[0]?.status, "active");
  assert.equal(active.qualitativeEffects[0]?.statLabel, "Brisé");
});

test("collecte uniquement les conditions réellement utilisées par le build", () => {
  const selected = [
    perk("agitation", [...(PERK_EFFECT_OVERRIDES.agitation ?? [])]),
    perk("terminus", [...(PERK_EFFECT_OVERRIDES.terminus ?? [])])
  ];

  assert.deepEqual(collectBuildConditions(selected), ["carrying_survivor", "exit_gates_powered", "survivor_injured"]);
});

test("l'assistant explique une valeur depuis le résultat réel du moteur", () => {
  const selectedPerks = [perk("agitation", [...(PERK_EFFECT_OVERRIDES.agitation ?? [])])];
  const scenario = { conditions: { carrying_survivor: true }, perkStates: {} };
  const calculation = calculateBuild({ killer, perks: selectedPerks, scenario });
  const answer = answerBuildQuestion("Explique Agitation", { killer, perks: selectedPerks, scenario, calculation });

  assert.match(answer, /Agitation/i);
  assert.match(answer, /3,68 → 4,342/);
});

test("le contexte OpenAI contient les données calculées du build", () => {
  const selectedPerks = [perk("agitation", [...(PERK_EFFECT_OVERRIDES.agitation ?? [])])];
  const scenario = { conditions: { carrying_survivor: true }, perkStates: {} };
  const context = buildAssistantContext({ killer, perks: selectedPerks, scenario, calculation: calculateBuild({ killer, perks: selectedPerks, scenario }) });

  assert.equal(context.killer.name, "Tueur test");
  assert.equal(context.perks.length, 1);
  assert.equal(context.calculatedData.affectedStats.length > 0, true);
});

test("construit un prompt ChatGPT structuré avec contexte et historique récents", () => {
  const selectedPerks = [perk("agitation", [...(PERK_EFFECT_OVERRIDES.agitation ?? [])])];
  selectedPerks[0]!.categories = ["speed", "hook"];
  const scenario = { conditions: { carrying_survivor: true }, perkStates: {} };
  const context = buildAssistantContext({ killer, perks: selectedPerks, scenario, calculation: calculateBuild({ killer, perks: selectedPerks, scenario }) });
  const prompt = buildChatGPTPrompt("Analyse mon build", context, [
    { role: "user", content: "Question précédente" },
    { role: "assistant", content: "Réponse précédente" },
    { role: "user", content: "Analyse mon build" }
  ]);

  assert.match(prompt, /=== KILLER ===[\s\S]*Tueur test/);
  assert.match(prompt, /=== PERKS ===[\s\S]*agitation[\s\S]*speed, hook/);
  assert.match(prompt, /=== CALCULATED DATA ===[\s\S]*Vitesse de transport/);
  assert.match(prompt, /Question précédente[\s\S]*Réponse précédente/);
  assert.equal(prompt.endsWith("Analyse mon build"), true);
});

test("construit le prompt complet avec les deux camps, les builds et les descriptions affichées", () => {
  const associatedPerk = perk("agitation", []);
  associatedPerk.name = { fr: "Agitation", en: "Agitation" };
  associatedPerk.characterId = killer.id;
  associatedPerk.characterResolution = "resolved";
  associatedPerk.nativeDescriptionHtml = "<p>Description native.</p>";
  const survivor = { ...killer, id: "meg", name: { fr: "Meg Thomas", en: "Meg Thomas" } };
  const survivorPerk: Perk = {
    ...perk("survivor-adrenaline", []),
    side: "survivor",
    name: { fr: "Adrénaline", en: "Adrenaline" },
    characterId: survivor.id,
    characterResolution: "resolved",
    nativeDescriptionHtml: "<p>Version retravaillée : 4 secondes.</p>"
  };
  const currentBuild: CurrentBuildExport = {
    schemaVersion: 1,
    updatedAt: "2026-09-07T00:00:00.000Z",
    build: { id: "build-1", name: "Build test", killerId: killer.id, perkIds: [associatedPerk.id] },
    scenario: { conditions: { carrying_survivor: true }, perkStates: {} },
    assistantContext: null
  };

  const prompt = buildNativeChatPrompt("Optimise mon build", currentBuild, {
    howToPlay: "Déroulement de la partie",
    constants: "Course : 4,00 m/s",
    killers: [killer],
    survivors: [survivor],
    perks: [associatedPerk, survivorPerk],
    savedBuilds: [{ id: "saved-survivor", name: "Build survivant sauvegardé", killerId: survivor.id, side: "survivor", perkIds: [survivorPerk.id], createdAt: "2026-09-07", updatedAt: "2026-09-07" }],
    perkDescriptionOverrides: { agitation: "<p>Description locale &amp; à jour.</p>" },
    killerPowerDescription: () => "Pouvoir de test"
  }, [
    { role: "user", content: "Question précédente" },
    { role: "assistant", content: "Réponse précédente" },
    { role: "user", content: "Optimise mon build" }
  ]);

  assert.match(prompt, /=== 1\. HOW TO PLAY ===[\s\S]*Déroulement de la partie/);
  assert.match(prompt, /=== 2\. CONSTANTES ===[\s\S]*4,00 m\/s/);
  assert.match(prompt, /=== 3\. TUEURS ===[\s\S]*Tueur test \(Test Killer\)[\s\S]*Agitation[\s\S]*Pouvoir de test/);
  assert.match(prompt, /=== 4\. PERKS TUEURS ET SURVIVANTS ===[\s\S]*Description locale & à jour/);
  assert.match(prompt, /Adrénaline \(Adrenaline\)[\s\S]*Camp : survivant[\s\S]*Propriétaire : Meg Thomas[\s\S]*Version retravaillée : 4 secondes/);
  assert.match(prompt, /=== 5\. BUILD ACTUEL ===[\s\S]*Build test/);
  assert.match(prompt, /=== 6\. SURVIVANTS ===[\s\S]*Meg Thomas[\s\S]*Adrénaline/);
  assert.match(prompt, /=== 7\. BUILDS SAUVEGARDÉS ===[\s\S]*Build survivant sauvegardé/);
  assert.match(prompt, new RegExp(`=== 8\\. TIER LIST DES TUEURS ===[\\s\\S]*${killer.tier.replace(/[+]/g, "\\+")} : Tueur test`));
  assert.match(prompt, /=== 9\. HISTORIQUE DE CONVERSATION ===\nUtilisateur : Question précédente\n\nAssistant : Réponse précédente/);
  assert.equal(prompt.split("Optimise mon build").length, 2);
  assert.equal(prompt.endsWith("=== 10. QUESTION DE L'UTILISATEUR ===\nOptimise mon build"), true);
  assert.doesNotMatch(prompt, /Description native\./);
  assert.doesNotMatch(prompt, /FICHIER 1|FICHIER 2/);
});

test("les contextes et l'export du build suivent la priorité locale, native puis importée", () => {
  const selectedPerk = perk("updated", []);
  selectedPerk.description.fr = { version: 1, blocks: [{ type: "paragraph", children: [{ type: "text", value: "Ancienne description" }] }] };
  assert.equal(perkDescriptionToText(selectedPerk), "Ancienne description");
  selectedPerk.nativeDescriptionHtml = "<p>Description native &lt; 10&nbsp;m.</p><ul><li>Premier effet</li><li>Second effet</li></ul>";
  assert.equal(perkDescriptionToText(selectedPerk), "Description native < 10 m.\n- Premier effet\n- Second effet");
  assert.equal(perkDescriptionToText(selectedPerk, "   "), "Ancienne description");
  const input = {
    activeBuildId: null,
    buildName: "Brouillon non sauvegardé",
    killer,
    perks: [selectedPerk],
    scenario: { conditions: {}, perkStates: {} },
    calculation: calculateBuild({ killer, perks: [selectedPerk] }),
    perkDescriptionOverrides: { updated: "<p>Description locale &amp; actuelle.</p>" }
  };
  assert.equal(buildAssistantContext(input).perks[0]?.description, "Description locale & actuelle.");
  const exported = createCurrentBuildExport(input);
  assert.equal(exported.assistantContext?.perks[0]?.description, "Description locale & actuelle.");
  assert.equal(exported.build.id, null);
});

test("les descriptions natives de toutes les perks retravaillées sont utilisées", async () => {
  for (const file of ["perks.json", "survivor-perks.json"]) {
    const catalog = JSON.parse(await readFile(`src/data/generated/${file}`, "utf8")) as Perk[];
    const nativePerks = catalog.filter((perk) => perk.nativeDescriptionHtml);
    assert.ok(nativePerks.length > 0);
    for (const entry of nativePerks) {
      const description = perkDescriptionToText(entry);
      assert.ok(description.length > 0, entry.id);
      assert.doesNotMatch(description, /<\/?(?:p|span|li|ul|br)\b[^>]*>|&(?:nbsp|amp|lt|gt|quot);/i, entry.id);
      assert.equal(buildAssistantContext({ killer, perks: [entry], scenario: { conditions: {}, perkStates: {} }, calculation: calculateBuild({ killer, perks: [] }) }).perks[0]?.description, description, entry.id);
    }
  }
});

test("un build survivant ne transmet pas les statistiques tueurs de substitution", () => {
  const survivor = { ...killer, id: "meg", name: { fr: "Meg Thomas", en: "Meg Thomas" } };
  const currentBuild = createCurrentBuildExport({ activeBuildId: null, buildName: "Brouillon survivant", killer: survivor, perks: [], scenario: { conditions: {}, perkStates: {} }, calculation: calculateBuild({ killer: survivor, perks: [] }) });
  currentBuild.assistantContext!.calculatedData.affectedStats = [{ final: Infinity }];
  const prompt = buildNativeChatPrompt("Analyse", currentBuild, { killers: [killer], survivors: [survivor], perks: [], savedBuilds: [], howToPlay: "Guide", constants: "Constantes", perkDescriptionOverrides: {}, killerPowerDescription: () => "Pouvoir" });
  const buildSection = prompt.split("=== 5. BUILD ACTUEL ===")[1]!.split("=== 6.")[0]!;
  assert.match(buildSection, /Camp : survivant[\s\S]*Meg Thomas/);
  assert.match(buildSection, /"side": "survivor"/);
  assert.match(buildSection, /"final": "Infinity"/);
  assert.doesNotMatch(buildSection, /"killer":|"tier":|"terrorRadius":/);
});

test("tous les providers distants transmettent le prompt complet sans le tronquer", async (t) => {
  const bodies: Array<{ provider: string; prompt: string }> = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ answer: "Réponse test", actions: [] }));
  });
  const context = buildAssistantContext({ killer, perks: [], scenario: { conditions: {}, perkStates: {} }, calculation: calculateBuild({ killer, perks: [] }) });
  const prompt = "Catalogue complet\n".repeat(30_000);
  for (const id of ["codex", "openai"] as const) {
    const answer = await createAssistantProvider(id, "http://127.0.0.1:8787").send({ message: "Analyse", prompt, context, history: [] });
    assert.equal(answer.answer, "Réponse test");
    assert.equal(bodies.at(-1)?.provider, id);
    assert.equal(bodies.at(-1)?.prompt, prompt);
  }
});

test("sérialise les paragraphes, icônes et listes d’une description riche", () => {
  const text = richDescriptionToText({
    version: 1,
    blocks: [
      { type: "paragraph", children: [{ type: "text", value: "Conditions" }] },
      { type: "list", ordered: false, items: [[{ type: "icon", sourceName: "test", ref: null, alt: "Effet" }]] }
    ]
  });
  assert.equal(text, "Conditions\n\n- Effet");
});

test("sélectionne les providers sans lancer de service externe", () => {
  assert.deepEqual(ASSISTANT_PROVIDER_IDS, ["clipboard", "codex", "openai"]);
  assert.equal(createAssistantProvider("clipboard", "http://127.0.0.1:8787").id, "clipboard");
  assert.equal(createAssistantProvider("codex", "http://127.0.0.1:8787").id, "codex");
  assert.equal(createAssistantProvider("openai", "http://127.0.0.1:8787").id, "openai");
  assert.equal(normalizeServerUrl("http://127.0.0.1:8787/api/build-assistant"), "http://127.0.0.1:8787");
});

test("restaure une session locale en écartant les identifiants inconnus", () => {
  const session = readAppSession(JSON.stringify({
    activeView: "tiers",
    selectedKillerId: "trapper",
    selectedPerkId: "agitation",
    equippedPerkIds: ["agitation", "missing", "agitation"],
    buildName: "Mon build",
    scenario: { conditions: { carrying_survivor: true }, perkStates: { agitation: "active" } }
  }), new Set(["trapper"]), new Set(["agitation"]));

  assert.equal(session.activeView, "tiers");
  assert.deepEqual(session.equippedPerkIds, ["agitation"]);
  assert.equal(session.scenario.conditions.carrying_survivor, true);
});

test("conserve les perks d’une session même sans tueur sélectionné", () => {
  const session = readAppSession(JSON.stringify({
    selectedKillerId: null,
    equippedPerkIds: ["agitation"]
  }), new Set(["trapper"]), new Set(["agitation"]));

  assert.deepEqual(session.equippedPerkIds, ["agitation"]);
});

test("restaure les éditeurs des deux camps et migre la sélection des anciennes sessions", () => {
  const characterIds = new Set(["trapper", "jake"]);
  const perkIds = new Set(["agitation", "survivor-lithe"]);
  const legacy = readAppSession(JSON.stringify({ side: "survivor", selectedKillerId: "jake", activeBuildId: "jake-build", equippedPerkIds: ["survivor-lithe"], buildName: "Jake" }), characterIds, perkIds);
  assert.equal(legacy.buildSessions.survivor.activeBuildId, "jake-build");
  assert.equal(legacy.buildSessions.killer.activeBuildId, null);
  const survivorEditor = { ...legacy.buildSessions.survivor, buildName: "Jake modifié sans sauvegarder", scenario: { conditions: { injured: true }, perkStates: {} } };
  const raw = JSON.stringify({ ...legacy, side: "killer", selectedKillerId: "trapper", activeBuildId: "trapper-build", buildName: "Tueur", equippedPerkIds: ["agitation"], buildSessions: { survivor: { ...survivorEditor, equippedPerkIds: ["survivor-lithe", "unknown", "survivor-lithe"] } } });
  const restored = readAppSession(raw, characterIds, perkIds);
  assert.equal(restored.activeBuildId, "trapper-build");
  assert.equal(restored.buildSessions.killer.activeBuildId, "trapper-build");
  assert.equal(restored.buildSessions.survivor.activeBuildId, "jake-build");
  assert.equal(restored.buildSessions.survivor.buildName, survivorEditor.buildName);
  assert.equal(restored.buildSessions.survivor.scenario.conditions.injured, true);
  assert.deepEqual(restored.buildSessions.survivor.equippedPerkIds, ["survivor-lithe"]);
  assert.deepEqual(readAppSession(JSON.stringify(restored), characterIds, perkIds), restored);
});

test("pondère les pistes de BlindTest sans dépasser cinq occurrences", () => {
  const tracks = [
    { id: "theme:a", killerId: "a", kind: "theme" as const, url: "a" },
    { id: "terror:b", killerId: "b", kind: "terror" as const, url: "b" }
  ];
  const picked = pickWeightedBlindTestTrack(tracks, { "theme:a": 3, "terror:b": 5 }, () => 0);

  assert.equal(picked?.track.id, "theme:a");
  assert.deepEqual(picked?.weights, { "theme:a": 1, "terror:b": 5 });
});

test("associe exactement la piste de terreur de l'Animatronic", () => {
  const files = ["TerrorRadius_Animatronic.ogg", "TerrorRadius_Oni.ogg"];

  assert.equal(findBlindTestAudioFile(files, "TerrorRadius_Animatronic.ogg"), "TerrorRadius_Animatronic.ogg");
  assert.equal(findBlindTestAudioFile(files, "TerrorRadius_Oni.ogg"), "TerrorRadius_Oni.ogg");
});

test("associe les fichiers de respiration aux noms atypiques", () => {
  assert.deepEqual(killerBreathingFileNames("animatronic", "animatronic"), ["animatronics_breathing.ogg", "Animatronic_breathing.ogg"]);
  assert.deepEqual(killerBreathingFileNames("dredge", "dredge"), ["dragage_breathing.ogg"]);
  assert.deepEqual(killerBreathingFileNames("ghoul", "ghoul"), ["goule_breathing.ogg"]);
  assert.equal(findBlindTestAudioFile(["Hag_Breathing.ogg"], killerBreathingFileNames("hag", "hag")[0]!), "Hag_Breathing.ogg");
  assert.deepEqual(killerBreathingFileNames("skull-merchant", "skull-merchant"), ["Merchant_idle_breathing.ogg"]);
  assert.deepEqual(killerBreathingFileNames("xenomorph", "xenomorph"), ["xenomorphe_breathing.ogg"]);
  assert.deepEqual(killerBreathingFileNames("trapper", "trapper"), ["trapper_Breathing.ogg", "trapper_Breathing_2.ogg"]);
});

test("joue une piste courte de BlindTest en boucle et garde assez de temps sur une piste longue", () => {
  assert.deepEqual(getBlindTestPlayback(12, 20, "theme", () => 0.8), { loop: true, startTime: 0 });
  assert.deepEqual(getBlindTestPlayback(32, 20, "terror", () => 0.5), { loop: false, startTime: 6 });
  assert.deepEqual(getBlindTestPlayback(32, 20, "breathing", () => 0.5), { loop: false, startTime: 0 });
});

test("choisit le commentaire de résultat de BlindTest selon le score", () => {
  assert.equal(blindTestResultComment(10, 100), "J’ai rarement vu un résultat aussi médiocre. Même le hasard aurait probablement fait mieux.");
  assert.equal(blindTestResultComment(20, 100), "On va dire que tu étais surtout là pour l’ambiance.");
  assert.equal(blindTestResultComment(60, 100), "La moyenne est sauvée. Ton honneur aussi, de justesse.");
  assert.equal(blindTestResultComment(95, 100), "Presque parfait. Cette erreur va probablement te hanter plus longtemps qu’elle ne devrait.");
  assert.equal(blindTestResultComment(100, 100), "Parfait. Soit tu es une encyclopédie musicale, soit tu as triché avec une discrétion admirable.");
});

function perk(id: string, effects: PerkEffect[]): Perk {
  return {
    id,
    name: { fr: id, en: id },
    side: "killer",
    categories: [],
    characterId: null,
    characterResolution: "general",
    icon: null,
    description: { fr: null, en: null },
    effects,
    cooldown: null,
    effectImportStatus: "parsed",
    analysisReadiness: "ready"
  };
}
