import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const readJson = async path => JSON.parse(await readFile(path, "utf8"));
const survivorPerks = (await readJson("src/data/generated/survivor-perks.json")).filter(perk => ["Bond", "Kindred", "Hope", "Sprint Burst"].includes(perk.name.en));
const killerPerks = (await readJson("src/data/generated/perks.json")).slice(0, 4);
assert.equal(survivorPerks.length, 4);
const date = "2026-11-08T10:00:00.000Z";
const builds = [
  { id: "stats-survivor", name: "Build évasion", side: "survivor", killerId: "jake", perkIds: survivorPerks.map(perk => perk.id), createdAt: date, updatedAt: date },
  { id: "stats-empty", name: "Build jamais joué", side: "survivor", killerId: "jake", perkIds: ["survivor-lithe"], createdAt: date, updatedAt: date },
  { id: "stats-killer", name: "Build tueur", side: "killer", killerId: "trapper", perkIds: killerPerks.map(perk => perk.id), createdAt: date, updatedAt: date },
];
const participant = resultLabel => ({ name: "Meg Thomas", role: "survivor", imageUrl: null, score: 10000, valueLabel: "10,000", resultLabel, survivalTimeLabel: "8:00" });
const entry = (id, role, perks, changes = {}) => ({
  id, role, characterName: role === "killer" ? "The Trapper" : "Jake Park", resultLabel: "Escaped", score: 25000,
  characterImageUrl: null, perkIconUrls: perks.map(perk => `https://assets.example/perks/${perk.name.en.replace(/[^a-z0-9]/gi, "")}.png`), perkIconLabels: perks.map(perk => perk.name.en), equipmentIconUrls: [], equipmentIconLabels: [],
  participants: [participant("Sacrificed"), participant("Sacrificed"), participant("Escaped"), participant("Escaped")].slice(0, role === "killer" ? 4 : 3),
  mapName: "The Game", mapImageUrl: null, playedAt: date, playedAtLabel: null, durationLabel: "10:00", survivalTimeLabel: "9:00", queueLabel: null,
  sourceUrl: "https://stats.deadbydaylight.com/match-history/", importedAt: date, ...changes,
});
const snapshot = { updatedAt: date, statistics: null, importedCount: 0, fetchedCount: 0, matchHistory: [
  entry("escape", "survivor", survivorPerks), entry("dead", "survivor", [...survivorPerks].reverse(), { resultLabel: "Sacrificed" }),
  entry("unknown", "survivor", survivorPerks, { resultLabel: null, score: null, durationLabel: null, survivalTimeLabel: null }),
  entry("modifier", "survivor", survivorPerks, { queueLabel: "Lights Out" }),
  entry("other-character", "survivor", survivorPerks, { characterName: "Meg Thomas" }),
  entry("three-kills", "killer", killerPerks, { participants: [participant("Sacrificed"), participant("Sacrificed"), participant("Sacrificed"), participant("Escaped")] }),
  entry("one-kill", "killer", [...killerPerks].reverse(), { participants: [participant("Sacrificed"), participant("Escaped"), participant("Escaped"), participant("Escaped")] }),
] };
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const context = await browser.newContext({ viewport: { width: 1680, height: 1100 } });
try {
  await context.addInitScript(({ builds }) => {
    localStorage.setItem("dbd-build-tool.builds", JSON.stringify(builds));
    localStorage.setItem("dbd-build-tool.current-session", JSON.stringify({ activeView: "build", side: "survivor", selectedKillerId: "jake", activeBuildId: builds[0].id, equippedPerkIds: builds[0].perkIds, soundEnabled: false }));
  }, { builds });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/statistics/**", route => route.fulfill({ json: route.request().url().endsWith("/status") ? { busy: false, phase: "idle", message: "Prêt", logs: [] } : snapshot }));
  await page.route("**/api/local-data/**", route => route.fulfill({ json: { success: true } }));
  await page.goto("http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
  const tab = page.getByRole("tab", { name: "Statistique", exact: true });
  await tab.click();
  const panel = page.locator(".build-statistics");
  await panel.locator(".bs-kpis").waitFor();
  assert.equal(await page.getByRole("tab", { name: "Graphique" }).count(), 0);
  assert.equal(await panel.locator(".bs-metric > strong").first().innerText(), "4");
  assert.match(await panel.locator(".bs-metric.accent > strong").innerText(), /66,7/);
  assert.match(await panel.locator(".bs-metric").nth(2).innerText(), /3 scores connus/);
  await panel.getByLabel("Mode de jeu").selectOption("1v4");
  assert.equal(await panel.locator(".bs-metric > strong").first().innerText(), "3");
  assert.match(await panel.locator(".bs-metric.accent > strong").innerText(), /50/);
  await page.waitForFunction(() => [...document.querySelectorAll(".bs-perks img")].every(image => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: ".tmp-build-statistics-survivor.png", fullPage: true });
  const launcher = page.getByRole("combobox", { name: "Ouvrir un build", exact: true });
  await launcher.selectOption("stats-empty");
  await panel.getByText("Aucune partie enregistrée avec ce build.", { exact: true }).waitFor();
  assert.equal(await panel.locator(".bs-metric.accent > strong").innerText(), "—");
  await page.getByRole("button", { name: "Passer au mode Tueur", exact: true }).click();
  await launcher.selectOption("stats-killer");
  await page.getByRole("tab", { name: "Statistique", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".bs-metric > strong")?.textContent === "2");
  assert.match(await panel.locator(".bs-metric.accent").innerText(), /Taux de kill/);
  assert.match(await panel.locator(".bs-metric.accent > strong").innerText(), /50/);
  assert.equal(await panel.getByText("Temps de survie moyen", { exact: true }).count(), 0);
  await page.screenshot({ path: ".tmp-build-statistics-killer.png", fullPage: true });
  await page.getByRole("tab", { name: "Liste", exact: true }).click();
  assert.equal(await page.locator(".build-statistics").count(), 0);
  await page.getByRole("tab", { name: "Statistique", exact: true }).click();
  await panel.locator(".bs-kpis").waitFor();
  for (const width of [1000, 600, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `Débordement des statistiques à ${width}px`);
  }
  await page.setViewportSize({ width: 1680, height: 1100 });
  assert.deepEqual(errors, []);
  console.log("Statistiques du build : camp, personnage, compétences exactes, inconnues, modes, changement de build et retour à la liste vérifiés.");
} finally {
  await context.close();
}
process.exit(0);
