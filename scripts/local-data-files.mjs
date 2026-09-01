import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const KNOWLEDGE_FILE = resolve(process.cwd(), ".data/dbd-knowledge.json");
export const CURRENT_BUILD_FILE = resolve(process.cwd(), ".data/current-build.json");

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
