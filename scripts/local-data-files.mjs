import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const KNOWLEDGE_FILE = resolve(process.cwd(), ".data/dbd-knowledge.json");
export const CURRENT_BUILD_FILE = resolve(process.cwd(), ".data/current-build.json");
export const PERKS_FILE = resolve(process.cwd(), "src/data/generated/perks.json");
const CATEGORIES_FILE = resolve(process.cwd(), "src/data/generated/categories.json");
const NATIVE_PERK_OVERRIDES_FILE = resolve(process.cwd(), "src/data/perk-native-overrides.json");

export async function generateDbdKnowledge() {
  const [killers, perks, categories, gameFlow, killerPowers, fixedStatistics] = await Promise.all([
    readJson("src/data/generated/killers.json"),
    readJson("src/data/generated/perks.json"),
    readJson("src/data/generated/categories.json"),
    readText("partie_dbd.txt"),
    readText("killers.txt"),
    readText("statistiques_fixe.txt")
  ]);
  const mechanicsModule = await import(`${pathToFileURL(resolve(process.cwd(), "dist/src/data/global-mechanics.js")).href}?v=${Date.now()}`);
  const knowledge = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    counts: { killers: killers.length, perks: perks.length, categories: categories.length },
    catalog: { killers, perks, categories },
    mechanics: {
      global: mechanicsModule.GLOBAL_MECHANICS,
      analyzableStats: mechanicsModule.ANALYZABLE_STATS,
      themes: mechanicsModule.ANALYSIS_THEMES
    },
    documents: { gameFlow, killerPowers, fixedStatistics }
  };
  await writeJson(KNOWLEDGE_FILE, knowledge);
  if (!await exists(CURRENT_BUILD_FILE)) {
    await writeJson(CURRENT_BUILD_FILE, { schemaVersion: 1, updatedAt: null, build: null, scenario: null, assistantContext: null });
  }
  return { file: KNOWLEDGE_FILE, counts: knowledge.counts };
}

export async function writeCurrentBuild(currentBuild) {
  if (!isRecord(currentBuild)) throw new TypeError("Build courant invalide.");
  await writeJson(CURRENT_BUILD_FILE, currentBuild);
}

export async function updateNativePerk(perkId, changes) {
  if (typeof perkId !== "string" || !perkId.trim() || !isRecord(changes)) {
    throw new TypeError("Modification native de perk invalide.");
  }
  const [perks, allowedCategories, overrides] = await Promise.all([
    readJson(PERKS_FILE),
    readJson(CATEGORIES_FILE),
    readJson(NATIVE_PERK_OVERRIDES_FILE)
  ]);
  if (!Array.isArray(perks) || !Array.isArray(allowedCategories) || !isRecord(overrides)) throw new TypeError("Catalogue de perks invalide.");
  const index = perks.findIndex((perk) => isRecord(perk) && perk.id === perkId);
  if (index < 0) throw new TypeError("Perk native introuvable.");

  const next = { ...perks[index] };
  if ("descriptionHtml" in changes) {
    if (typeof changes.descriptionHtml !== "string" || !changes.descriptionHtml.trim() || changes.descriptionHtml.length > 200_000) {
      throw new TypeError("Description native invalide.");
    }
    next.nativeDescriptionHtml = changes.descriptionHtml.trim();
  }
  if ("categories" in changes) {
    const allowed = new Set(allowedCategories);
    if (!Array.isArray(changes.categories) || changes.categories.some((category) => typeof category !== "string" || !allowed.has(category))) {
      throw new TypeError("Catégories natives invalides.");
    }
    next.categories = [...new Set(changes.categories)];
  }
  if (!("descriptionHtml" in changes) && !("categories" in changes)) throw new TypeError("Aucune modification native fournie.");

  perks[index] = next;
  const previousOverride = isRecord(overrides[perkId]) ? overrides[perkId] : {};
  overrides[perkId] = {
    ...previousOverride,
    ...(changes.descriptionHtml === undefined ? {} : { nativeDescriptionHtml: next.nativeDescriptionHtml }),
    ...(changes.categories === undefined ? {} : { categories: next.categories })
  };
  await Promise.all([writeJson(PERKS_FILE, perks), writeJson(NATIVE_PERK_OVERRIDES_FILE, overrides)]);
  return next;
}

export async function createNativeChatPrompt(question, currentBuild) {
  if (typeof question !== "string" || !question.trim()) throw new TypeError("Question vide.");
  if (question.length > 20_000) throw new TypeError("Question trop longue.");
  await writeCurrentBuild(currentBuild);
  if (!await exists(KNOWLEDGE_FILE)) await generateDbdKnowledge();
  const [knowledge, savedBuild] = await Promise.all([readFile(KNOWLEDGE_FILE, "utf8"), readFile(CURRENT_BUILD_FILE, "utf8")]);
  return [
    "Tu es un expert de Dead by Daylight. Réponds à la question en utilisant en priorité les deux fichiers fournis. Signale clairement toute information inconnue ou non vérifiée.",
    "",
    "=== FICHIER 1 · CONNAISSANCES DBD ===",
    JSON.stringify(JSON.parse(knowledge)),
    "",
    "=== FICHIER 2 · BUILD ACTUEL ===",
    JSON.stringify(JSON.parse(savedBuild)),
    "",
    "=== QUESTION ===",
    question.trim()
  ].join("\n");
}

async function readJson(path) {
  return JSON.parse(await readText(path));
}

function readText(path) {
  return readFile(resolve(process.cwd(), path), "utf8");
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
