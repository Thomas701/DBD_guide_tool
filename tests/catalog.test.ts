import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { SURVIVOR_PERK_CATEGORIES_BY_ID } from "../src/data/survivor-perk-categories.js";
import { SURVIVOR_PERK_CATEGORIES } from "../src/domain/category.js";
import type { Killer } from "../src/domain/killer.js";
import type { Perk } from "../src/domain/perk.js";
import type { RichDescription } from "../src/domain/rich-description.js";
import { buildNativeChatPrompt, type NativeChatKnowledge } from "../src/services/native-chat-prompt.js";
import { perkDescriptionToText } from "../src/services/openai-build-assistant.js";
import type { CurrentBuildExport } from "../src/services/local-data.js";
import { filterPerks, type PerkFilters } from "../src/services/perk-filter.js";
import { selectKillers } from "../src/services/killer-selector.js";
import { PERK_BASE_TIERS, PERK_TIER_GROUPS } from "../src/data/perk-tiers.js";
import { rankPerks } from "../src/services/tier-list.js";
import { perkCooldown } from "../src/services/perk-cooldown.js";
import { PERK_EFFECT_OVERRIDES } from "../src/data/perk-effect-overrides.js";
import { calculateBuild, collectBuildConditions } from "../src/services/build-calculator.js";
import { perkStatusDefinitions } from "../src/services/perk-status-definitions.js";
import { SURVIVOR_PERK_EFFECTS } from "../src/data/survivor-perk-effects.js";

test("toutes les perks survivants possèdent leurs effets revus, sérialisés et calculables", async () => {
  const catalog = JSON.parse(await readFile("src/data/generated/survivor-perks.json", "utf8")) as Perk[];
  assert.deepEqual(Object.keys(SURVIVOR_PERK_EFFECTS).sort(), catalog.map(({ id }) => id).sort());
  const actor: Killer = { id: "jake", name: { fr: "Jake", en: null }, speed: 4, terrorRadius: 0, portrait: null, size: "normal", difficulty: "easy", tier: "D" };
  for (const perk of catalog) {
    assert.deepEqual(perk.effects, SURVIVOR_PERK_EFFECTS[perk.id], perk.id);
    assert.ok(perk.effects.length > 0 && perk.analysisReadiness !== "unavailable", perk.id);
    assert.ok(!/\p{L}\?\p{L}/u.test(JSON.stringify(perk.effects)), perk.id);
    const conditions = Object.fromEntries(collectBuildConditions([perk]).map((key) => [key, true]));
    if (conditions.in_chase) conditions.not_in_chase = false;
    const result = calculateBuild({ killer: actor, perks: [perk], side: "survivor", scenario: { conditions, perkStates: { [perk.id]: "active" } } });
    assert.equal(result.unresolvedEffects.length, 0, perk.id);
    assert.ok(result.affectedStats.length + result.qualitativeEffects.length > 0, perk.id);
    assert.ok(result.affectedStats.every(({ final }) => Number.isFinite(final)), perk.id);
    assert.ok(result.qualitativeEffects.every(({ statLabel }) => !/^[a-z]+\./.test(statLabel)), perk.id);
  }
});

test("le cooldown survivant suit la description native ou locale, sans confondre charges et épuisement", async () => {
  const all = JSON.parse(await readFile("src/data/generated/survivor-perks.json", "utf8")) as Perk[];
  const natives = JSON.parse(await readFile("src/data/perk-native-overrides.json", "utf8")) as Record<string, { nativeDescriptionHtml?: string }>;
  const catalog = all.map((perk) => {
    const current = { ...perk, ...natives[perk.id] };
    return { ...current, cooldown: perkCooldown(current) };
  });
  const filters: PerkFilters = { side: "survivor", query: "", categories: [], categoryMode: "any", characterIds: [], cooldown: "with" };
  const withCooldown = filterPerks(catalog, filters);
  const without = filterPerks(catalog, { ...filters, cooldown: "without" });
  assert.ok(withCooldown.length > 0 && without.length > 0);
  assert.equal(withCooldown.length + without.length, catalog.length);
  assert.ok(withCooldown.some(({ id, cooldown }) => id === "survivor-finesse" && cooldown === 30));
  assert.ok(without.some(({ id }) => id === "survivor-built-to-last"));
  assert.ok(without.some(({ id }) => id === "survivor-lithe"));
  const sample = catalog[0]!;
  assert.equal(perkCooldown(sample, "<p>Recharge : 60 / 45 / 30 secondes.</p>"), 30);
  assert.equal(perkCooldown(sample, "<p>Effet actif pendant 40 secondes. Épuisement pendant 60 secondes.</p>"), null);
  assert.equal(perkCooldown(sample, "<p>Recharge ment : 40 secondes</p>"), 40);
});

test("chaque perk tueur possède une analyse revue, calculable et sans ancien effet non résolu", async () => {
  const all = JSON.parse(await readFile("src/data/generated/perks.json", "utf8")) as Perk[];
  assert.deepEqual(Object.keys(PERK_EFFECT_OVERRIDES).sort(), all.map(({ id }) => id).sort());
  const actor: Killer = { id: "audit", name: { fr: "Audit", en: null }, speed: 4.6, terrorRadius: 32, portrait: null, size: "normal", difficulty: "normal", tier: "B+" };
  for (const current of all) {
    assert.ok(current.effects.length > 0, current.id);
    assert.ok(!/\p{L}\?\p{L}/u.test(JSON.stringify(current.effects)), `Texte corrompu : ${current.id}`);
    const conditions = Object.fromEntries(collectBuildConditions([current]).map((key) => [key, true]));
    if (conditions.in_chase) conditions.not_in_chase = false;
    const result = calculateBuild({ killer: actor, perks: [current], scenario: { conditions, perkStates: { [current.id]: "active" } } });
    assert.equal(result.unresolvedEffects.length, 0, current.id);
    assert.ok(result.affectedStats.length + result.qualitativeEffects.length > 0, current.id);
    assert.ok(result.affectedStats.every(({ final }) => Number.isFinite(final)), current.id);
    assert.ok(result.qualitativeEffects.every(({ statLabel }) => !/^[a-z]+\./.test(statLabel)), current.id);
  }
});

test("le glossaire suit la description affichée, sans doublons ni termes tirés des attributs HTML", async () => {
  const [base] = JSON.parse(await readFile("src/data/generated/perks.json", "utf8")) as Perk[];
  const perk = { ...base!, nativeDescriptionHtml: "<p>Épuisement et Brisé. Épuisement ; État critique, puis Insaisissable.</p>" };
  const terms = (html?: string) => perkStatusDefinitions(perk, html).map(({ term }) => term);
  assert.deepEqual(terms(), ["Épuisement", "Brisé", "État critique", "Insaisissable"]);
  assert.deepEqual(terms("<p>insaisissable</p>"), ["Insaisissable"]);
  assert.deepEqual(terms('<p title="Brisé">Une palette brisée vous aide à avancer rapidement.</p>'), []);
  assert.deepEqual(terms("<p>EPUISEMENT et etat critique</p>"), ["Épuisement", "État critique"]);
  assert.deepEqual(perkStatusDefinitions({ ...perk, nativeDescriptionHtml: "", description: { fr: { version: 1, blocks: [{ type: "paragraph", children: [{ type: "text", value: "Brisé" }] }] }, en: null } }).map(({ term }) => term), ["Brisé"]);
});

test("les deux tier lists classent chaque perk du catalogue exactement une fois par identifiant", async () => {
  const killerPerks = JSON.parse(await readFile("src/data/generated/perks.json", "utf8")) as Perk[];
  const survivorPerks = JSON.parse(await readFile("src/data/generated/survivor-perks.json", "utf8")) as Perk[];
  for (const [side, catalog] of [["killer", killerPerks], ["survivor", survivorPerks]] as const) {
    const classified = Object.values(PERK_TIER_GROUPS[side]).flat().map((id) => side === "survivor" ? `survivor-${id}` : id);
    assert.equal(new Set(classified).size, classified.length, `Doublon côté ${side}`);
    assert.deepEqual([...classified].sort(), catalog.map(({ id }) => id).sort());
  }
  const catalog = [...killerPerks, ...survivorPerks];
  const ranked = rankPerks(catalog, { "survivor-flow-state": "S+", agitation: "D" });
  assert.equal(ranked.length, catalog.length);
  assert.equal(ranked.every((entry) => entry.baseTier !== null), true);
  assert.equal(ranked.find(({ perk }) => perk.id === "survivor-flow-state")?.tier, "S+");
  assert.equal(ranked.find(({ perk }) => perk.id === "agitation")?.tier, "D");
  const renamed = rankPerks([{ ...killerPerks[0]!, name: { fr: "Nouveau nom", en: null } }], {});
  assert.equal(renamed[0]?.baseTier, PERK_BASE_TIERS[killerPerks[0]!.id]);
  assert.equal(renamed[0]?.name, "Nouveau nom");
});

test("trouve les perks d’Onze avec son nom français ou anglais", () => {
  const eleven = killer("eleven", "Onze", "Eleven", "D", "easy", 4);
  const perk = survivorPerk("survivor-extrasensory-perception", "Perception extrasensorielle", "Extrasensory Perception", "eleven");
  const filters: PerkFilters = { side: "survivor", query: "", categories: [], categoryMode: "any", characterIds: [], cooldown: "any" };

  assert.deepEqual(filterPerks([perk], { ...filters, query: "Onze" }, [eleven]).map((candidate) => candidate.id), [perk.id]);
  assert.deepEqual(filterPerks([perk], { ...filters, query: "eleven" }, [eleven]).map((candidate) => candidate.id), [perk.id]);
});

test("attribue une ou plusieurs catégories survivant valides à chaque perk", async () => {
  const sourceIds = (JSON.parse(await readFile("src/data/generated/survivor-perks.json", "utf8")) as Array<{ id: string }>)
    .map((perk) => perk.id)
    .sort();
  const survivorCategorySet = new Set(SURVIVOR_PERK_CATEGORIES);
  const categorizedPerks = Object.values(SURVIVOR_PERK_CATEGORIES_BY_ID);

  assert.deepEqual(Object.keys(SURVIVOR_PERK_CATEGORIES_BY_ID).sort(), sourceIds);
  assert.equal(categorizedPerks.every((categories) => categories.length > 0 && categories.every((category) => survivorCategorySet.has(category))), true);
});

test("les nouveaux survivants ont leurs trois perks, leurs images et sont repris automatiquement dans le prompt", async () => {
  const [survivorsJson, perksJson, ownersJson, descriptionsJson] = await Promise.all([
    readFile("src/data/generated/survivors.json", "utf8"),
    readFile("src/data/generated/survivor-perks.json", "utf8"),
    readFile("src/data/generated/survivor-perk-owners.json", "utf8"),
    readFile("src/data/generated/survivor-perk-descriptions.json", "utf8")
  ]);
  const owners = JSON.parse(ownersJson) as Record<string, string>;
  const descriptions = JSON.parse(descriptionsJson) as Record<string, RichDescription>;
  const survivors = (JSON.parse(survivorsJson) as Array<Pick<Killer, "id" | "name" | "portrait">>).map((survivor): Killer => ({
    ...survivor, speed: 4, terrorRadius: 0, size: "normal", tier: "D", difficulty: "easy"
  }));
  const catalogPerks = (JSON.parse(perksJson) as Perk[]).map((perk): Perk => ({
    ...perk,
    characterId: owners[perk.id] ?? null,
    characterResolution: owners[perk.id] ? "resolved" : "general",
    categories: [...(SURVIVOR_PERK_CATEGORIES_BY_ID[perk.id] ?? [])],
    description: { fr: descriptions[perk.id] ?? null, en: null },
    cooldown: null,
    analysisReadiness: "unavailable"
  }));
  const additions = [
    { id: "aurora", name: "Aurora Stardotter", perks: ["survivor-fruits-of-your-labor", "survivor-salvations-cry", "survivor-boon-steadfast"] },
    { id: "shane", name: "Shane Wiigwaas", perks: ["survivor-wide-open-throttle", "survivor-lend-a-hand", "survivor-cross-examination"] },
    { id: "kwon", name: "Kwon Tae-young", perks: ["survivor-flow-state", "survivor-a-place-for-us", "survivor-five-moves-ahead"] },
    { id: "sienna", name: "Sienna Shaw", perks: ["survivor-best-gift-ever", "survivor-shared-trauma", "survivor-valkyries-rage"] }
  ];
  const currentBuild: CurrentBuildExport = {
    schemaVersion: 1,
    updatedAt: "2026-11-07T00:00:00.000Z",
    build: { id: null, name: "Nouveau build", killerId: "aurora", perkIds: additions[0]!.perks },
    scenario: { conditions: {}, perkStates: {} },
    assistantContext: null
  };
  const knowledge: NativeChatKnowledge = { killers: [], survivors, perks: catalogPerks, savedBuilds: [], howToPlay: "Guide", constants: "Constantes", perkDescriptionOverrides: {}, killerPowerDescription: () => "" };
  const prompt = buildNativeChatPrompt("Analyse", currentBuild, knowledge);
  for (const addition of additions) {
    const survivor = survivors.find((candidate) => candidate.id === addition.id);
    assert.ok(survivor);
    assert.equal(survivor.name.fr, addition.name);
    await access(`DBDImages-main/DBDImages-main/images/characters/survivor/${survivor.portrait}`);
    assert.ok(prompt.includes(`## ${addition.name}\nIdentifiant : ${addition.id}`));
    assert.deepEqual(catalogPerks.filter((perk) => perk.characterId === addition.id).map((perk) => perk.id).sort(), [...addition.perks].sort());
    assert.deepEqual(filterPerks(catalogPerks, { side: "survivor", query: addition.name, categories: [], categoryMode: "any", characterIds: [], cooldown: "any" }, survivors).map((perk) => perk.id).sort(), [...addition.perks].sort());
    for (const id of addition.perks) {
      const perk = catalogPerks.find((candidate) => candidate.id === id);
      assert.ok(perk);
      assert.ok(perk.categories.length > 0);
      await access(`DBDImages-main/DBDImages-main/images/perks/survivor/${perk.icon}`);
      assert.ok(perkDescriptionToText(perk).length > 0);
      assert.ok(prompt.includes(`Identifiant : ${id}\nCamp : survivant\nPropriétaire : ${addition.name}`));
      assert.ok(prompt.includes(`Description affichée : ${perkDescriptionToText(perk)}`));
    }
  }
  const flowState = catalogPerks.find((perk) => perk.id === "survivor-flow-state")!;
  const updatedPrompt = buildNativeChatPrompt("Analyse", currentBuild, { ...knowledge, perkDescriptionOverrides: { [flowState.id]: "<p>Description mise à jour après l’ajout.</p>" } });
  assert.match(updatedPrompt, /Description affichée : Description mise à jour après l’ajout\./);
  assert.ok(!updatedPrompt.includes(perkDescriptionToText(flowState)));
});

const perks: Perk[] = [
  perk("agitation", "Agitation", ["speed", "hook"], "trapper", null),
  perk("presence-perturbante", "Unnerving Presence", ["hability_test"], "trapper", null),
  perk("nurses-calling", "A Nurse's Calling", ["aura", "care"], "nurse", null),
  perk("discordance", "Discordance", ["generator", "aura"], "legion", 30),
  { ...perk("general", "General Perk", ["generator"], null, 0), characterResolution: "general" },
  { ...perk("unknown-owner", "Unknown Owner", ["generator"], null, null), characterResolution: "unresolved" },
  survivorPerk("survivor-self-aware", "Conscience de soi", "Self-Aware", "nea"),
  survivorPerk("survivor-sprint-burst", "Sprint", "Sprint Burst", "meg"),
  survivorPerk("survivor-adrenaline", "Adrénaline", "Adrenaline", "meg")
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

test("trie les perks survivant par survivant puis par nom", () => {
  assert.deepEqual(runSurvivor({}).map((perk) => perk.id), [
    "survivor-adrenaline",
    "survivor-sprint-burst",
    "survivor-self-aware"
  ]);
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

function runSurvivor(overrides: Partial<PerkFilters>): Perk[] {
  return filterPerks(perks, {
    side: "survivor",
    query: "",
    categories: [],
    categoryMode: "any",
    characterIds: [],
    cooldown: "any",
    ...overrides
  }, [
    killer("meg", "Meg Thomas", "Meg Thomas", "D", "easy", 4),
    killer("nea", "Néa Karlsson", "Nea Karlsson", "D", "easy", 4)
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

function survivorPerk(id: string, nameFr: string, nameEn: string | null, characterId: string | null): Perk {
  return {
    ...perk(id, nameEn, ["speed"], characterId, null),
    name: { fr: nameFr, en: nameEn },
    side: "survivor"
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
