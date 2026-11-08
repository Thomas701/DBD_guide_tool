import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import type { Killer } from "../src/domain/killer.js";
import type { Perk } from "../src/domain/perk.js";
import { applyAssistantActions, parseAssistantResponse, validateAssistantActions, validateAssistantSnapshot, type AssistantAction } from "../src/services/assistant-actions.js";
import { ASSISTANT_CONVERSATIONS_STORAGE_KEY, LocalAssistantConversationRepository } from "../src/services/assistant-conversations.js";
import { connectOpenAIProvider, createAssistantProvider, getCodexProviderStatus } from "../src/services/assistant-provider.js";
import { LocalTierOverrideRepository, rankPerks, TIER_OVERRIDES_STORAGE_KEY } from "../src/services/tier-list.js";
import { LocalBuildRepository } from "../src/services/build-repository.js";
import { buildNativeChatPrompt } from "../src/services/native-chat-prompt.js";
import { createCurrentBuildExport } from "../src/services/local-data.js";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}
const killer: Killer = { id: "trapper", name: { fr: "Piégeur", en: "Trapper" }, portrait: null, speed: 4.6, terrorRadius: 32, size: "big", difficulty: "easy", tier: "D" };
const survivor: Killer = { ...killer, id: "meg", name: { fr: "Meg", en: "Meg" } };
const perk: Perk = { id: "agitation", side: "killer", name: { fr: "Agitation", en: "Agitation" }, categories: ["speed"], characterId: killer.id, characterResolution: "resolved", icon: null, description: { fr: null, en: null }, effects: [], cooldown: null, effectImportStatus: "unparsed", analysisReadiness: "unavailable" };
const survivorPerk: Perk = { ...perk, id: "survivor-adrenaline", side: "survivor", characterId: "meg", name: { fr: "Adrénaline", en: "Adrenaline" } };
const catalog = { killers: [killer], survivors: [survivor], perks: [perk, survivorPerk], builds: [] };

test("les réponses structurées refusent les commandes et les données mal formées", async () => {
  const actions: AssistantAction[] = [
    { type: "update_perk_description", perkId: perk.id, descriptionHtml: "<p>Nouvelle description.</p>" },
    { type: "set_killer_tier", killerId: killer.id, tier: "A+" },
    { type: "set_perk_tier", perkId: perk.id, tier: "S+" },
    { type: "save_build", buildId: null, name: "Premier build", killerId: killer.id, side: "killer", perkIds: [perk.id] },
    { type: "set_current_build", name: "Brouillon", killerId: survivor.id, side: "survivor", perkIds: [survivorPerk.id] }
  ];
  assert.deepEqual(parseAssistantResponse({ answer: "Proposition", actions }).actions, actions);
  for (const bad of [
    { type: "shell", command: "arbitrary command" },
    { ...actions[0], descriptionHtml: "<p> </p>" },
    { ...actions[0], filePath: "outside-workspace" },
    { ...actions[1], tier: "SSS" },
    { ...actions[3], perkIds: [null] }
  ]) assert.throws(() => parseAssistantResponse({ answer: "Test", actions: [bad] }), /invalide/);
  assert.throws(() => parseAssistantResponse({ answer: "Test", actions: Array(51).fill(actions[0]) }), /invalide/);
  const schema = JSON.parse(await readFile("src/data/assistant-response.schema.json", "utf8"));
  assert.deepEqual(schema.properties.actions.items.anyOf.map((entry: { properties: { type: { enum: string[] } } }) => entry.properties.type.enum[0]), actions.map(({ type }) => type));
});

test("un lot invalide ne modifie aucune donnée, même si ses premières actions sont valides", () => {
  let applied = 0;
  const targets = { updateDescription: () => { applied++; }, updateKillerTier: () => { applied++; }, updatePerkTier: () => { applied++; }, saveBuild: () => { applied++; }, setCurrentBuild: () => { applied++; } };
  const first: AssistantAction = { type: "update_perk_description", perkId: perk.id, descriptionHtml: "<p>Texte</p>" };
  for (const invalid of [
    { type: "set_killer_tier", killerId: "unknown", tier: "S+" },
    { type: "save_build", buildId: null, name: "Mauvais camp", side: "killer", killerId: killer.id, perkIds: [survivorPerk.id] },
    { type: "save_build", buildId: "unknown", name: "Absent", side: "killer", killerId: killer.id, perkIds: [] },
    { type: "set_current_build", name: "Doublons", side: "killer", killerId: killer.id, perkIds: [perk.id, perk.id] },
    { type: "set_current_build", name: "Trop de perks", side: "killer", killerId: killer.id, perkIds: ["a", "b", "c", "d", "e"] }
  ] as AssistantAction[]) assert.throws(() => applyAssistantActions([first, invalid], catalog, targets));
  assert.equal(applied, 0);
});

test("les actions créent plusieurs builds et rapportent les échecs sans annoncer un succès", () => {
  const builds = new LocalBuildRepository(new MemoryStorage());
  const actions: AssistantAction[] = [
    { type: "save_build", buildId: null, name: "Killer", side: "killer", killerId: killer.id, perkIds: [perk.id] },
    { type: "save_build", buildId: null, name: "Survivant", side: "survivor", killerId: survivor.id, perkIds: [survivorPerk.id] },
    { type: "update_perk_description", perkId: perk.id, descriptionHtml: "<p>Description</p>" }
  ];
  const targets = { updateDescription: () => { throw new Error("Stockage plein"); }, updateKillerTier: () => {}, updatePerkTier: () => {}, setCurrentBuild: () => {}, saveBuild: (action: Extract<AssistantAction, { type: "save_build" }>) => { builds.create(action); } };
  const report = applyAssistantActions(actions, catalog, targets);
  assert.equal(builds.list().length, 2);
  assert.match(report[0]!, /Build créé et sauvegardé \(tueur\) : Killer/);
  assert.match(report[2]!, /Échec.*Stockage plein/);
  const current = builds.list()[0]!;
  validateAssistantActions([{ ...actions[0] as Extract<AssistantAction, { type: "save_build" }>, buildId: current.id }], { ...catalog, builds: builds.list() });
});

test("les conversations sont séparées par connexion, reprises puis réellement supprimées", () => {
  const storage = new MemoryStorage();
  const repository = new LocalAssistantConversationRepository(storage);
  const codex = repository.create("codex");
  const api = repository.create("openai");
  repository.append(codex.id, "user", "Crée mon build");
  repository.append(codex.id, "assistant", "Build créé");
  repository.append(api.id, "user", "Question API");
  const reloaded = new LocalAssistantConversationRepository(storage);
  assert.equal(reloaded.list().find(({ id }) => id === codex.id)?.messages.length, 2);
  assert.equal(reloaded.list().find(({ id }) => id === codex.id)?.title, "Crée mon build");
  assert.equal(reloaded.list().find(({ id }) => id === api.id)?.provider, "openai");
  reloaded.delete(codex.id);
  assert.equal(repository.list().some(({ id }) => id === codex.id), false);
  assert.throws(() => repository.append(codex.id, "assistant", "Réponse tardive"), /supprimée/);
  assert.equal(repository.list().length, 1);
});

test("l’ancien historique est conservé et une suppression ne le fait pas réapparaître", () => {
  const storage = new MemoryStorage();
  const raw = JSON.stringify({ old: [{ id: "m", role: "user", content: "Ancienne question" }] });
  storage.setItem("dbd-build-tool.assistant-session", raw);
  storage.setItem("dbd-build-tool.assistant-provider", "openai");
  const repository = new LocalAssistantConversationRepository(storage);
  assert.equal(repository.list()[0]?.provider, "openai");
  repository.delete("legacy:old");
  assert.deepEqual(repository.list(), []);
  assert.equal(storage.getItem("dbd-build-tool.assistant-session"), null);
  storage.setItem(ASSISTANT_CONVERSATIONS_STORAGE_KEY, "invalid");
  assert.throws(() => repository.create("codex"), /illisible/);
  assert.equal(storage.getItem(ASSISTANT_CONVERSATIONS_STORAGE_KEY), "invalid");
});

test("les tiers restent cohérents après plusieurs modifications et un rechargement", () => {
  const storage = new MemoryStorage();
  const tiers = new LocalTierOverrideRepository(storage);
  tiers.update("killers", killer.id, "A+");
  tiers.update("perks", perk.id, "S+");
  tiers.update("perks", survivorPerk.id, "A-");
  const loaded = new LocalTierOverrideRepository(storage).list();
  assert.equal(loaded.killers[killer.id], "A+");
  assert.equal(loaded.perks[perk.id], "S+");
  const ranked = rankPerks([perk, survivorPerk], loaded.perks);
  assert.equal(ranked.filter((entry) => entry.perk?.id === perk.id).length, 1);
  assert.equal(ranked.find((entry) => entry.perk?.id === perk.id)?.tier, "S+");
  assert.equal(ranked.find((entry) => entry.perk?.id === survivorPerk.id)?.tier, "A-");
  assert.throws(() => tiers.update("killers", "__proto__", "D"));
  storage.setItem(TIER_OVERRIDES_STORAGE_KEY, "invalid");
  assert.throws(() => tiers.update("killers", killer.id, "D"));
  assert.equal(storage.getItem(TIER_OVERRIDES_STORAGE_KEY), "invalid");
});

test("le prompt contient les tiers actuels et l’historique complet, même sans build sélectionné", () => {
  const current = createCurrentBuildExport({ activeBuildId: null, buildName: "", side: "survivor", killer: null, perks: [], scenario: { conditions: {}, perkStates: {} }, calculation: null });
  const history = Array.from({ length: 24 }, (_, index) => ({ role: "user" as const, content: `Question ${index}` }));
  const prompt = buildNativeChatPrompt("Question générale", current, { ...catalog, savedBuilds: [], howToPlay: "Guide", constants: "Constantes", perkDescriptionOverrides: {}, killerPowerDescription: () => "Pouvoir", perkTierList: [{ perkId: perk.id, name: "Agitation", tier: "S+" }, { perkId: survivorPerk.id, name: "Adrénaline", tier: "A-" }] }, history);
  assert.ok(prompt.includes('"tier": "S+"'));
  const killerTiers = prompt.split("=== TIER LIST DES PERKS TUEURS ===")[1]!.split("=== TIER LIST DES PERKS SURVIVANTS ===")[0]!;
  const survivorTiers = prompt.split("=== TIER LIST DES PERKS SURVIVANTS ===")[1]!.split("=== 9.")[0]!;
  assert.ok(killerTiers.includes('"perkId": "agitation"') && !killerTiers.includes(survivorPerk.id));
  assert.ok(survivorTiers.includes(survivorPerk.id) && !survivorTiers.includes('"perkId": "agitation"'));
  assert.ok(prompt.includes("Utilisateur : Question 0\n"));
  assert.ok(prompt.includes("Utilisateur : Question 23"));
  assert.match(prompt, /BUILD ACTUEL ===\nCamp : survivant\nPersonnage : Non sélectionné/);
});

test("la clé API ne peut pas être envoyée à un serveur externe", async (t) => {
  let called = false;
  t.mock.method(globalThis, "fetch", async () => { called = true; return new Response(); });
  await assert.rejects(connectOpenAIProvider("https://example.com", "test-key", "gpt-5-mini"), /serveur local/);
  assert.equal(called, false);
});

test("une réponse en retard ne peut pas écraser un brouillon, une sauvegarde ou une description modifiés", () => {
  const currentBuild = createCurrentBuildExport({ activeBuildId: null, buildName: "Avant", killer, perks: [perk], scenario: { conditions: {}, perkStates: {} }, calculation: null });
  const builds = new LocalBuildRepository(new MemoryStorage());
  const saved = builds.create({ name: "Avant", side: "killer", killerId: killer.id, perkIds: [perk.id] });
  const before = { currentBuild, savedBuilds: [saved], perks: [perk], perkDescriptionOverrides: {} };
  const currentAction: AssistantAction = { type: "set_current_build", name: "Demandé", side: "killer", killerId: killer.id, perkIds: [] };
  assert.throws(() => validateAssistantSnapshot([currentAction], before, { ...before, currentBuild: { ...currentBuild, build: { ...currentBuild.build, name: "Modifié entre-temps" } } }), /build courant a changé/);
  const saveAction: AssistantAction = { ...currentAction, type: "save_build", buildId: saved.id };
  assert.throws(() => validateAssistantSnapshot([saveAction], before, { ...before, savedBuilds: [{ ...saved, name: "Autre modification" }] }), /sauvegarde a changé/);
  assert.throws(() => validateAssistantSnapshot([{ type: "update_perk_description", perkId: perk.id, descriptionHtml: "<p>Réponse tardive</p>" }], before, { ...before, perkDescriptionOverrides: { [perk.id]: "<p>Édition manuelle récente</p>" } }), /description a changé/);
  assert.doesNotThrow(() => validateAssistantSnapshot([currentAction, saveAction], before, before));
});

test("le mode API accepte une question sans build et refuse une action inconnue", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ answer: "Réponse générale", actions: [] })));
  assert.equal((await createAssistantProvider("openai", "http://localhost:8787").send({ message: "Bonjour", context: null, history: [] })).answer, "Réponse générale");
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ answer: "Non", actions: [{ type: "shell" }] })));
  await assert.rejects(createAssistantProvider("codex", "http://localhost:8787").send({ message: "Test", context: null, history: [] }), /invalide/);
});

test("un lien de connexion Codex ne peut pointer que vers l’authentification officielle", async (t) => {
  let loginUrl = "javascript:alert(1)";
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ provider: "codex", installed: true, connected: false, detail: "Connexion", loginPending: true, loginUrl, account: null, models: [], selectedModel: null, quotas: [] })));
  assert.equal((await getCodexProviderStatus("http://localhost:8787")).loginUrl, null);
  loginUrl = "https://auth.openai.com/oauth/authorize?test=1";
  assert.equal((await getCodexProviderStatus("http://localhost:8787")).loginUrl, loginUrl);
});

test("le statut Codex ne conserve que le compte, les modèles et les quotas affichables", async (t) => {
  const payload = {
    provider: "codex", installed: true, connected: true, detail: "Connecté", account: { email: "app@example.com", plan: "plus", accessToken: "secret-test" },
    models: [{ id: "available", name: "Modèle proposé", isDefault: true }, { id: 42 }], selectedModel: "not-in-catalog",
    quotas: [{ id: "codex", name: "Codex", windows: [{ remainingPercent: 75, durationMinutes: 300, resetsAt: 1_800_000_000 }, { remainingPercent: -2, durationMinutes: null, resetsAt: null }] }]
  };
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(payload)));
  const status = await getCodexProviderStatus("http://localhost:8787");
  assert.deepEqual(status.account, { email: "app@example.com", plan: "plus" });
  assert.equal(status.models.length, 1);
  assert.equal(status.selectedModel, null);
  assert.equal(status.quotas[0]!.windows[0]!.remainingPercent, 75);
  assert.equal(status.quotas[0]!.windows[1]!.remainingPercent, null);
  assert.ok(!JSON.stringify(status).includes("secret-test"));
  payload.connected = false;
  const disconnected = await getCodexProviderStatus("http://localhost:8787");
  assert.equal(disconnected.account, null);
  assert.deepEqual(disconnected.quotas, []);
});
