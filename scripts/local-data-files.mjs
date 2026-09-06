import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const CURRENT_BUILD_FILE = resolve(process.cwd(), ".data/current-build.json");
export const PERKS_FILE = resolve(process.cwd(), "src/data/generated/perks.json");
const CATEGORIES_FILE = resolve(process.cwd(), "src/data/generated/categories.json");
const NATIVE_PERK_OVERRIDES_FILE = resolve(process.cwd(), "src/data/perk-native-overrides.json");

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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
