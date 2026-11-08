import assert from "node:assert/strict";
import { constants } from "node:fs";
import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { extractMatchHistoryEntriesFromHtml } from "./dbd-statistics-provider.mjs";
import { buildMatchHistoryEntryId } from "./match-history-id.mjs";

// Correct only cards whose mode is explicitly present in the saved source page.
const path = ".data/dbd-statistics.json";
const original = await readFile(path, "utf8");
const snapshot = JSON.parse(original);
assert.ok(Array.isArray(snapshot.matchHistory), "Archive de matchs invalide");
const html = await readFile(".data/examples/match-history-page.example.html", "utf8");
const cards = extractMatchHistoryEntriesFromHtml(html, "https://stats.deadbydaylight.com/match-history/", new Date(snapshot.updatedAt));
const modes = new Map(cards.filter(card => card.queueLabel).map(card => [buildMatchHistoryEntryId(card), card.queueLabel]));
let corrected = 0;
const matchHistory = snapshot.matchHistory.map(entry => {
  const queueLabel = modes.get(buildMatchHistoryEntryId(entry));
  if (!queueLabel || queueLabel === entry.queueLabel) return entry;
  corrected++;
  return { ...entry, queueLabel };
});
assert.deepEqual(matchHistory.map(entry => entry.id), snapshot.matchHistory.map(entry => entry.id), "Les identifiants et l’ordre doivent rester inchangés");
if (corrected) {
  const backup = `${path}.before-mode-fix-${Date.now()}.json`;
  await copyFile(path, backup, constants.COPYFILE_EXCL);
  assert.equal(await readFile(path, "utf8"), original, "L’archive a changé pendant la correction ; relancez le script");
  const temporary = `${path}.mode-fix.tmp`;
  await writeFile(temporary, `${JSON.stringify({ ...snapshot, matchHistory }, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, path);
  console.log(`${corrected} modes corrigés sur ${matchHistory.length} matchs. Sauvegarde : ${backup}`);
} else {
  console.log("Aucun mode à corriger dans les cartes de la source archivée.");
}
