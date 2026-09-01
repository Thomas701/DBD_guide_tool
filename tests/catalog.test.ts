import assert from "node:assert/strict";
import test from "node:test";

import type { Killer } from "../src/domain/killer.js";
import type { Perk } from "../src/domain/perk.js";
import { filterPerks, type PerkFilters } from "../src/services/perk-filter.js";
import { selectKillers } from "../src/services/killer-selector.js";

const perks: Perk[] = [
  perk("agitation", "Agitation", ["speed", "hook"], "trapper", null),
  perk("presence-perturbante", "Unnerving Presence", ["hability_test"], "trapper", null),
  perk("nurses-calling", "A Nurse's Calling", ["aura", "care"], "nurse", null),
  perk("discordance", "Discordance", ["generator", "aura"], "legion", 30),
  { ...perk("general", "General Perk", ["generator"], null, 0), characterResolution: "general" },
  { ...perk("unknown-owner", "Unknown Owner", ["generator"], null, null), characterResolution: "unresolved" },
  { ...perk("survivor", "Survivor", ["speed"], null, null), side: "survivor" }
];

test("recherche les noms FR et EN sans accents ni casse", () => {
  assert.deepEqual(run({ query: "PRESENCE" }).map((perk) => perk.id), ["presence-perturbante"]);
  assert.deepEqual(run({ query: "nurse calling" }).map((perk) => perk.id), ["nurses-calling"]);
  assert.deepEqual(run({ query: "piégeur" }).map((perk) => perk.id), ["agitation", "presence-perturbante"]);
  assert.deepEqual(run({ query: "the nurse" }).map((perk) => perk.id), ["nurses-calling"]);
});

test("combine les catégories en modes ANY et ALL", () => {
  assert.deepEqual(
    run({ categories: ["generator", "aura"], categoryMode: "all" }).map((perk) => perk.id),
    ["discordance"]
  );
  assert.equal(run({ categories: ["generator", "aura"], categoryMode: "any" }).length, 4);
  assert.equal(run({ categories: [], categoryMode: "all" }).length, 6);
});

test("distingue les perks générales des propriétaires non résolus", () => {
  assert.deepEqual(run({ characterIds: [null] }).map((perk) => perk.id), ["general"]);
  assert.deepEqual(run({ characterIds: ["trapper"] }).map((perk) => perk.id), [
    "agitation",
    "presence-perturbante"
  ]);
  assert.deepEqual(run({ characterIds: ["trapper", "nurse"] }).map((perk) => perk.id), [
    "agitation",
    "presence-perturbante",
    "nurses-calling"
  ]);
});

test("filtre les cooldowns et cumule les critères sans muter l'entrée", () => {
  const before = perks.map((perk) => perk.id);
  assert.deepEqual(run({ cooldown: "with" }).map((perk) => perk.id), ["discordance", "general"]);
  assert.deepEqual(run({ cooldown: "without" }).map((perk) => perk.id), [
    "agitation",
    "presence-perturbante",
    "nurses-calling",
    "unknown-owner"
  ]);
  assert.deepEqual(
    run({ query: "discord", categories: ["generator", "aura"], categoryMode: "all", characterIds: ["legion"], cooldown: "with" })
      .map((perk) => perk.id),
    ["discordance"]
  );
  assert.deepEqual(perks.map((perk) => perk.id), before);
});

test("recherche et trie les killers avec les rangs métier", () => {
  const killers = [
    killer("nurse", "L'infirmière", "The Nurse", "S+", "nightmare", 3.8),
    killer("trapper", "Le piégeur", "The Trapper", "D", "easy", 4.6),
    killer("blight", "Le fléau", "The Blight", "S-", "difficult", 4.4)
  ];
  const before = killers.map((killer) => killer.id);

  assert.deepEqual(selectKillers(killers, { query: "infirmiere", sortBy: "name", direction: "asc", locale: "fr" }).map((killer) => killer.id), ["nurse"]);
  assert.deepEqual(selectKillers(killers, { query: "trapper", sortBy: "name", direction: "asc", locale: "en" }).map((killer) => killer.id), ["trapper"]);
  assert.deepEqual(selectKillers(killers, { query: "", sortBy: "tier", direction: "asc", locale: "fr" }).map((killer) => killer.id), ["nurse", "blight", "trapper"]);
  assert.deepEqual(selectKillers(killers, { query: "", sortBy: "difficulty", direction: "desc", locale: "fr" }).map((killer) => killer.id), ["nurse", "blight", "trapper"]);
  assert.deepEqual(selectKillers(killers, { query: "", sortBy: "speed", direction: "desc", locale: "fr" }).map((killer) => killer.id), ["trapper", "blight", "nurse"]);
  assert.deepEqual(killers.map((killer) => killer.id), before);
});

function run(overrides: Partial<PerkFilters>): Perk[] {
  return filterPerks(perks, {
    side: "killer",
    query: "",
    categories: [],
    categoryMode: "any",
    characterIds: [],
    cooldown: "any",
    ...overrides
  }, [
    killer("trapper", "Le piégeur", "The Trapper", "D", "easy", 4.6),
    killer("nurse", "L'infirmière", "The Nurse", "S+", "nightmare", 3.8),
    killer("legion", "La légion", "The Legion", "C-", "easy", 4.6)
  ]);
}

function perk(
  id: string,
  nameEn: string | null,
  categories: Perk["categories"],
  characterId: string | null,
  cooldown: number | null
): Perk {
  return {
    id,
    name: { fr: id.replaceAll("-", " "), en: nameEn },
    side: "killer",
    categories,
    characterId,
    characterResolution: characterId ? "resolved" : "general",
    icon: null,
    description: { fr: null, en: null },
    effects: [],
    cooldown,
    effectImportStatus: "unparsed",
    analysisReadiness: "unavailable"
  };
}

function killer(
  id: string,
  nameFr: string,
  nameEn: string | null,
  tier: Killer["tier"],
  difficulty: Killer["difficulty"],
  speed: number
): Killer {
  return {
    id,
    name: { fr: nameFr, en: nameEn },
    portrait: null,
    speed,
    terrorRadius: 32,
    size: "normal",
    tier,
    difficulty
  };
}
