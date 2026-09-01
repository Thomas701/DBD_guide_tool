import assert from "node:assert/strict";
import test from "node:test";

import type { PerkEffect } from "../src/domain/effect.js";
import type { Killer } from "../src/domain/killer.js";
import type { Perk } from "../src/domain/perk.js";
import { PERK_EFFECT_OVERRIDES } from "../src/data/perk-effect-overrides.js";
import { answerBuildQuestion } from "../src/services/build-assistant.js";
import { createAssistantProvider, normalizeServerUrl } from "../src/services/assistant-provider.js";
import { readAppSession } from "../src/services/app-session.js";
import { BUILD_STACKING_POLICY, calculateBuild, collectBuildConditions } from "../src/services/build-calculator.js";
import { buildChatGPTPrompt } from "../src/services/chatgpt-prompt-builder.js";
import { buildAssistantContext, richDescriptionToText } from "../src/services/openai-build-assistant.js";

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

test("n'applique un effet temporaire que lorsqu'il est déclenché et hors cooldown", () => {
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
  assert.equal(cooldown.cooldownEffects[0]?.perkId, "temporary");
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
    perks: [perk("enduring", [...(PERK_EFFECT_OVERRIDES.enduring ?? [])])]
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

  assert.equal(recoverySpeed.stats["killer.successful_attack_recovery_time"]?.final, 2.16);
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

test("conserve une statistique explicitement inconnue en analyse partielle", () => {
  const result = calculateBuild({
    killer,
    perks: [perk("bloodhound", [...(PERK_EFFECT_OVERRIDES.bloodhound ?? [])])],
    scenario: { conditions: { survivor_injured: true }, perkStates: {} }
  });

  assert.equal(result.stats["tracking.blood_pool_lifetime"], undefined);
  assert.equal(result.unresolvedEffects.length, 1);
  assert.match(result.unresolvedEffects[0]?.reasons.at(-1) ?? "", /non vérifiée/);
});

test("affiche un statut qualitatif et respecte sa condition", () => {
  const terminus = perk("terminus", [...(PERK_EFFECT_OVERRIDES.terminus ?? [])]);
  const inactive = calculateBuild({ killer, perks: [terminus] });
  const active = calculateBuild({
    killer,
    perks: [terminus],
    scenario: { conditions: { exit_gates_powered: true }, perkStates: {} }
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

  assert.deepEqual(collectBuildConditions(selected), ["carrying_survivor", "exit_gates_powered"]);
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
  assert.equal(createAssistantProvider("local", "http://127.0.0.1:8787").id, "local");
  assert.equal(createAssistantProvider("clipboard", "http://127.0.0.1:8787").id, "clipboard");
  assert.equal(createAssistantProvider("codex", "http://127.0.0.1:8787").id, "codex");
  assert.equal(createAssistantProvider("browser", "http://127.0.0.1:8787").id, "browser");
  assert.equal(createAssistantProvider("openai", "http://127.0.0.1:8787").id, "openai");
  assert.equal(normalizeServerUrl("http://127.0.0.1:8787/api/build-assistant"), "http://127.0.0.1:8787");
});

test("restaure une session locale en écartant les identifiants inconnus", () => {
  const session = readAppSession(JSON.stringify({
    activeView: "perks",
    selectedKillerId: "trapper",
    selectedPerkId: "agitation",
    equippedPerkIds: ["agitation", "missing", "agitation"],
    buildName: "Mon build",
    scenario: { conditions: { carrying_survivor: true }, perkStates: { agitation: "active" } }
  }), new Set(["trapper"]), new Set(["agitation"]));

  assert.equal(session.activeView, "perks");
  assert.deepEqual(session.equippedPerkIds, ["agitation"]);
  assert.equal(session.scenario.conditions.carrying_survivor, true);
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
