import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PERK_CATEGORIES, type PerkCategory } from "../domain/category.js";
import { importData } from "./import-data.js";
import type { ImportBundle } from "./types.js";

const SOURCE_FILE = "source.txt";
const DESCRIPTION_FILE = "description_categories.txt";
const ICON_DIRECTORY = "DBDImages-main/DBDImages-main/images/perks/killer";
const PORTRAIT_DIRECTORY = "DBDImages-main/DBDImages-main/images/characters/killer";
const OUTPUT_DIRECTORY = "src/data/generated";
const NATIVE_OVERRIDES_FILE = "src/data/perk-native-overrides.json";

async function main(): Promise<void> {
  const workspace = process.cwd();
  const checkOnly = process.argv.includes("--check");
  const [sourceText, descriptionText, nativeOverridesText, iconEntries, portraitEntries] = await Promise.all([
    readFile(resolve(workspace, SOURCE_FILE), "utf8"),
    readFile(resolve(workspace, DESCRIPTION_FILE), "utf8"),
    readFile(resolve(workspace, NATIVE_OVERRIDES_FILE), "utf8").catch(() => "{}"),
    readdir(resolve(workspace, ICON_DIRECTORY), { withFileTypes: true }),
    readdir(resolve(workspace, PORTRAIT_DIRECTORY), { withFileTypes: true })
  ]);
  const iconFileNames = iconEntries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const portraitFileNames = portraitEntries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const bundle = importData({
    sourceText,
    descriptionText,
    iconFileNames,
    portraitFileNames,
    sourceFile: SOURCE_FILE,
    descriptionFile: DESCRIPTION_FILE,
    iconDirectory: ICON_DIRECTORY,
    portraitDirectory: PORTRAIT_DIRECTORY
  });
  applyNativeOverrides(bundle.perks, JSON.parse(nativeOverridesText) as unknown);
  const outputs = new Map<string, string>([
    ["categories.json", serialize(PERK_CATEGORIES)],
    ["perks.json", serialize(bundle.perks)],
    ["killers.json", serialize(bundle.killers)],
    ["descriptions.json", serialize(bundle.descriptions)],
    ["import-report.json", serialize(bundle.report)]
  ]);
  const outputDirectory = resolve(workspace, OUTPUT_DIRECTORY);

  if (checkOnly) {
    const stale: string[] = [];
    for (const [fileName, expected] of outputs) {
      try {
        const current = await readFile(resolve(outputDirectory, fileName), "utf8");
        if (current !== expected) stale.push(fileName);
      } catch {
        stale.push(fileName);
      }
    }
    if (stale.length > 0) {
      throw new Error(`données générées absentes ou obsolètes: ${stale.join(", ")}`);
    }
  } else {
    await mkdir(outputDirectory, { recursive: true });
    await Promise.all(
      [...outputs].map(([fileName, content]) => writeFile(resolve(outputDirectory, fileName), content, "utf8"))
    );
  }

  const { report } = bundle;
  console.log(
    `${checkOnly ? "Vérifié" : "Importé"}: ${report.imported.perks} perks, `
    + `${report.imported.killers} killers, ${report.imported.descriptions} descriptions; `
    + `${report.warnings.length} avertissements, ${report.errors.length} erreurs.`
  );
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function applyNativeOverrides(perks: ImportBundle["perks"], value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  for (const perk of perks) {
    const override = (value as Record<string, unknown>)[perk.id];
    if (typeof override !== "object" || override === null || Array.isArray(override)) continue;
    const nativeDescriptionHtml = (override as Record<string, unknown>).nativeDescriptionHtml;
    const categories = (override as Record<string, unknown>).categories;
    if (typeof nativeDescriptionHtml === "string" && nativeDescriptionHtml.trim()) perk.nativeDescriptionHtml = nativeDescriptionHtml.trim();
    if (Array.isArray(categories) && categories.every((category) => typeof category === "string" && PERK_CATEGORIES.includes(category as PerkCategory))) {
      perk.categories = [...new Set(categories)] as PerkCategory[];
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
