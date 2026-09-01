import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { validateBuildPerkIds } from "../src/domain/build.js";
import { descriptionText, parseDescriptionSource } from "../src/import/description-parser.js";
import { parseLegacyEffects } from "../src/import/effect-parser.js";
import { importData } from "../src/import/import-data.js";
import { splitTopLevel } from "../src/import/normalize.js";

test("survivant_transport devient hook puis est dédupliqué", () => {
  const bundle = importData({
    sourceText: sourceFixture([
      "agitation;1;survivant_transport,hook,speed;null;null;null;+18%[speed];null"
    ]),
    descriptionText: "",
    iconFileNames: ["agitation.png"]
  });

  assert.deepEqual(bundle.perks[0]?.categories, ["hook", "speed"]);
  assert.equal(bundle.perks[0]?.icon?.endsWith("/agitation.png"), true);
  assert.equal(bundle.report.warnings.filter((entry) => entry.code === "category_renamed").length, 1);
  assert.equal(bundle.report.warnings.filter((entry) => entry.code === "category_duplicate_removed").length, 1);
});

test("une ligne invalide est mise en quarantaine sans arrêter l'import", () => {
  const sourceText = [
    "PERK:",
    "name;side;category;character;icon;description;effect;recharge",
    "invalide;1;speed;null;null;null;+5%[speed]",
    "valide;1;speed;null;null;null;+5%[speed];null",
    "CATEGORIE:",
    "KILLER:",
    "name;speed;terror_rayon;size;tierlist;difficulty",
    "le valide;4.6;32;normal;B+;normal",
    "la harpie;4.4;24;normal;C+;normal;nightmare"
  ].join("\n");
  const bundle = importData({ sourceText, descriptionText: "", iconFileNames: [] });

  assert.equal(bundle.perks.length, 1);
  assert.equal(bundle.killers.length, 1);
  assert.equal(bundle.report.sourceRows.perkCandidates, 2);
  assert.equal(bundle.report.sourceRows.killerCandidates, 2);
  assert.equal(bundle.report.errors.some((entry) => entry.code === "perk_column_count"), true);
  assert.equal(bundle.report.errors.some((entry) => entry.code === "killer_column_count"), true);
});

test("une ressemblance de nom ne déclenche pas un mapping d'icône dangereux", () => {
  const bundle = importData({
    sourceText: sourceFixture([
      "agitatio;1;speed;null;null;null;+5%[speed];null"
    ]),
    descriptionText: "",
    iconFileNames: ["agitation.png"]
  });

  assert.equal(bundle.perks[0]?.icon, null);
  assert.equal(bundle.perks[0]?.name.en, null);
  assert.equal(bundle.report.warnings.some((entry) => entry.code === "perk_alias_missing"), true);
  assert.equal(bundle.report.unresolvedIcons.length, 1);
});

test("le nom français de source.txt reste la référence affichée", () => {
  const bundle = importData({
    sourceText: sourceFixture([
      "force brute;1;destruction;null;null;null;+20%[destruction];null"
    ]),
    descriptionText: "",
    iconFileNames: ["brutalstrength.png"]
  });

  assert.equal(bundle.perks[0]?.name.fr, "force brute");
  assert.equal(bundle.perks[0]?.name.en, "Brutal Strength");
});

test("les effets simples deviennent des opérations structurées", () => {
  const parsed = parseLegacyEffects("+18%[speed],+12[terror_rayon]");

  assert.equal(parsed.unresolved.length, 0);
  assert.deepEqual(parsed.effects, [
    {
      stat: "killer.speed",
      operation: "multiply",
      interpretation: "inferred",
      value: 1.18,
      unit: "multiplier",
      source: { format: "legacy-effect", raw: "+18%[speed]" }
    },
    {
      stat: "killer.terror_radius",
      operation: "add",
      interpretation: "inferred",
      value: 12,
      unit: "meters",
      source: { format: "legacy-effect", raw: "+12[terror_rayon]" }
    }
  ]);
});

test("un build accepte au plus quatre perks uniques", () => {
  assert.deepEqual(validateBuildPerkIds(["a", "b", "c", "d"]), []);
  assert.deepEqual(validateBuildPerkIds(["a", "a", "b", "c", "d"]), [
    "too_many_perks",
    "duplicate_perks"
  ]);
});

test("le tokenizer respecte les virgules imbriquées et refuse x", () => {
  assert.deepEqual(
    splitTopLevel("+90[care(hemorragie,estropiement)],-25%[care]"),
    ["+90[care(hemorragie,estropiement)]", "-25%[care]"]
  );
  const nested = parseLegacyEffects("+90[care(hemorragie,estropiement)],-25%[care]");
  assert.equal(nested.effects.length, 3);
  assert.equal(nested.unresolved.length, 0);

  const unknown = parseLegacyEffects("+x[sound]");
  assert.equal(unknown.effects.length, 0);
  assert.equal(unknown.unresolved[0]?.reason, "valeur d'effet inconnue");

  const survivorSpeed = parseLegacyEffects("-5%[speed(survivant)]");
  assert.equal(survivorSpeed.effects[0]?.stat, "survivor.speed");
  assert.equal(survivorSpeed.effects[0]?.target, "survivor");
});

test("les descriptions restent des blocs contrôlés et non une fausse traduction EN", () => {
  const parsed = parseDescriptionSource([
    "Agitation\tAgitation\tPremière ligne",
    "IconHelp terrorRadius.png",
    "",
    "« Une citation. »\tTrappeur",
    "K01 Le portrait du trappeur.png"
  ].join("\n"));

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0]?.alternateNameRaw, "Agitation");
  assert.equal(parsed.records[0]?.characterRaw, "Trappeur");
  assert.equal(parsed.records[0]?.portraitRaw, "K01 Le portrait du trappeur.png");
  assert.deepEqual(parsed.records[0]?.description.blocks.map((block) => block.type), ["list"]);
  assert.equal(parsed.records[0]?.description.blocks.some((block) =>
    block.type === "list" && block.items.flat().some((node) => node.type === "icon")
  ), false);
  assert.equal(parsed.records[0]?.description.blocks.some((block) => block.type === "quote"), false);
  assert.equal(descriptionText(parsed.records[0]?.description ?? { version: 1, blocks: [] }), "Première ligne.");
  assert.equal("en" in (parsed.records[0] ?? {}), false);
});

test("les citations et icônes d'une description restent dans leur contexte", () => {
  const parsed = parseDescriptionSource([
    "Force brutale\tForce brutale\t« Citation d'introduction. »",
    "Lors de la destruction de murs",
    "IconHelp mur cassable.png",
    ", palettes",
    "IconHelp pullDown.png",
    ", ou générateurs, la perk s'active :",
    "",
    "Augmente la vitesse d'action de 10 / 15 / 20 %.",
    "« Citation finale. »\tTrappeur",
    "K01 Le portrait du trappeur.png"
  ].join("\n"));

  const blocks = parsed.records[0]?.description.blocks ?? [];
  const text = descriptionText(parsed.records[0]?.description ?? { version: 1, blocks: [] });

  assert.deepEqual(blocks.map((block) => block.type), ["list"]);
  assert.equal(text.includes("Citation"), false);
  assert.equal(text.includes(".png"), false);
  assert.equal(text.includes("murs, palettes, ou générateurs"), true);
  assert.equal(text.includes("Augmente la vitesse d'action de 10 / 15 / 20 %."), true);
});

test("les références d'icônes collées au texte deviennent des nœuds sémantiques", () => {
  const parsed = parseDescriptionSource([
    "Piles incluses\tPiles incluses\tConfère +5 % à la hâteEffets d'état de l'icône : hâte.png Effet de statut.",
    "Bon gars",
    "K34 Portrait de TheGoodGuy.png"
  ].join("\n"));
  const text = descriptionText(parsed.records[0]?.description ?? { version: 1, blocks: [] });

  assert.equal(text, "Vous gagnez +5 % de vitesse.");
  assert.equal(text.includes(".png"), false);
});

test("les formulations de hâte, exposition et aura sont simplifiées dans les lignes brutes", () => {
  const haste = parseDescriptionSource([
    "Perk\tPerk\tConfère un bonus de hâte de 2/3/4 % Effets d'état de l'icône : hâte.png Effet de statut .",
    "Tous",
    "K00 Portrait.png"
  ].join("\n"));
  const exposure = parseDescriptionSource([
    "Perk\tPerk\tProvoque les souffrances de tous les survivants dues à l' exposition.Effets d'état de l'icône exposés.png Effet de statut .",
    "Tous",
    "K00 Portrait.png"
  ].join("\n"));
  const aura = parseDescriptionSource([
    "Perk\tPerk\tAu début de l'épreuve, les auras",
    "IcôneAide auras.png",
    "de tous les survivants",
    "Aide à l'icône Chargement du survivant.png",
    "vous sont révélés pendant 7 / 8 / 9 secondes .",
    "Tous",
    "K00 Portrait.png"
  ].join("\n"));
  const auraExtension = parseDescriptionSource([
    "Perk\tPerk\tProlonge de +2 secondes la durée de toutes les occurrences d'une aura de survivant qui vous est révélée .",
    "Tous",
    "K00 Portrait.png"
  ].join("\n"));

  assert.equal(descriptionText(haste.records[0]?.description ?? { version: 1, blocks: [] }), "Vous gagnez 2/3/4 % de vitesse.");
  assert.equal(descriptionText(exposure.records[0]?.description ?? { version: 1, blocks: [] }), "Tous les survivants deviennent exposés.");
  assert.equal(
    descriptionText(aura.records[0]?.description ?? { version: 1, blocks: [] }),
    "Au début de l'épreuve, vous voyez les auras de tous les survivants pendant 7 / 8 / 9 secondes."
  );
  assert.equal(
    descriptionText(auraExtension.records[0]?.description ?? { version: 1, blocks: [] }),
    "Prolonge de +2 secondes la durée de toutes les révélations d'aura de survivant."
  );
});

test("les citations multiligne et les citations ajoutées après un effet sont retirées", () => {
  const parsed = parseDescriptionSource([
    "Perk\tPerk\t« Une citation sur",
    "IconHelp entity.png",
    "plusieurs lignes. »",
    "Lorsque la condition est remplie :",
    "Augmente la vitesse de 10 %. « Une autre citation. » — Auteur\tTrappeur",
    "K01 Le portrait du trappeur.png"
  ].join("\n"));
  const text = descriptionText(parsed.records[0]?.description ?? { version: 1, blocks: [] });

  assert.equal(text.includes("citation"), false);
  assert.equal(text.includes("Lorsque la condition est remplie"), true);
  assert.equal(text.includes("Augmente la vitesse de 10 %"), true);
});

test("l'import complet produit les métriques auditées sans perdre les lignes suivantes", async () => {
  const [sourceText, descriptionText, iconEntries, portraitEntries] = await Promise.all([
    readFile("source.txt", "utf8"),
    readFile("description_categories.txt", "utf8"),
    readdir("DBDImages-main/DBDImages-main/images/perks/killer", { withFileTypes: true }),
    readdir("DBDImages-main/DBDImages-main/images/characters/killer", { withFileTypes: true })
  ]);
  const bundle = importData({
    sourceText,
    descriptionText,
    iconFileNames: iconEntries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    portraitFileNames: portraitEntries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  });

  assert.deepEqual(bundle.report.sourceRows, { perkCandidates: 145, killerCandidates: 42 });
  assert.deepEqual(bundle.report.imported, { perks: 145, killers: 42, descriptions: 151 });
  assert.equal(bundle.report.errors.filter((entry) => entry.code === "perk_column_count").length, 0);
  assert.equal(bundle.report.errors.filter((entry) => entry.code === "killer_column_count").length, 0);
  assert.equal(bundle.perks.some((perk) => perk.categories.includes("survivant_transport" as never)), false);
  assert.equal(bundle.perks.every((perk) => new Set(perk.categories).size === perk.categories.length), true);
  assert.equal(new Set(bundle.perks.map((perk) => perk.id)).size, bundle.perks.length);
  assert.equal(bundle.killers.every((killer) =>
    bundle.perks.filter((perk) => perk.characterId === killer.id).length === 3
  ), true);
  assert.equal(bundle.perks.filter((perk) => perk.icon !== null).length, 145);
  assert.equal(bundle.perks.filter((perk) => perk.description.fr !== null).length, 136);
  assert.equal(bundle.killers.filter((killer) => killer.portrait !== null).length, 42);
  assert.equal(bundle.report.unresolvedIcons.length, 0);
  assert.equal(bundle.report.unusedIcons.length, 0);
  assert.equal(bundle.report.unresolvedKillerPortraits.length, 0);
  assert.equal(bundle.report.unusedKillerPortraits.length, 2);
  assert.equal(bundle.report.incompleteTranslations.perkNamesEn, 0);
  assert.equal(bundle.report.incompleteTranslations.killerNamesEn, 0);
  assert.equal(bundle.report.unparsedEffects.some((entry) => entry.token.includes("+x")), true);

  const madGrit = bundle.perks.find((perk) => perk.id === "mad-grit");
  assert.equal(madGrit?.effects[0]?.stat, "killer.missed_attack_recovery_time");
  assert.equal(madGrit?.effects[0]?.operation, "set");
  assert.equal(madGrit?.effects[1]?.stat, "hook.wiggle_paused");
});

function sourceFixture(perkLines: string[]): string {
  return [
    "PERK:",
    "name;side;category;character;icon;description;effect;recharge",
    ...perkLines,
    "CATEGORIE:",
    "KILLER:",
    "name;speed;terror_rayon;size;tierlist;difficulty"
  ].join("\n");
}
