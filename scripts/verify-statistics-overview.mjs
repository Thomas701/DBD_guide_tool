import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
try {
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.clock.install();
  const snapshot = JSON.parse(await readFile(".data/dbd-statistics.json", "utf8"));
  let logs = Array.from({ length: 35 }, (_, index) => ({ at: new Date(Date.UTC(2026, 10, 8, 0, 0, index)).toISOString(), message: "Message de synchronisation " + index }));
  await page.route("**/api/statistics/**", route => route.fulfill({ json: route.request().url().endsWith("/status")
    ? { busy: false, phase: "idle", message: "Prêt", logs } : snapshot }));
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Statistique", exact: true }).click();
  await page.locator(".stats-dashboard").waitFor();
  const count = text => Number(text.replace(/[^0-9]/g, ""));
  const globalRole = page.getByRole("group", { name: "Camp analysé" });
  assert.equal(count(await page.locator(".sd-lifetime strong").nth(1).innerText()), snapshot.matchHistory.length);
  assert.equal(await page.getByText("Conservées localement", { exact: true }).count(), 0);
  assert.equal(await page.locator(".sd-world-controls").count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Trouver votre rythme.", exact: true }).count(), 0);
  assert.equal(await page.locator(".sd-encounter-grid .sd-pie-breakdown").count(), 4);
  assert.equal(await page.locator(".sd-ranking-panel").count(), 10);
  assert.ok((await page.locator(".sd-ranking-list").evaluateAll(lists => lists.map(list => list.children.length))).every(length => length <= 3));
  assert.ok(await page.locator(".sd-ranking-panel .sd-asset-icon.perk").count() >= 4);
  const perkLabels = await page.locator(".sd-ranking-panel .sd-asset-name").allTextContents();
  assert.ok(perkLabels.every(label => !/^[ks]\d+p\d+$/i.test(label)), "Unresolved perk labels: " + perkLabels.join(", "));

  await page.locator(".statistics-sync-log").evaluate(node => { node.scrollTop = 0; });
  logs = [...logs, ...Array.from({ length: 10 }, (_, index) => ({ at: new Date(Date.UTC(2026, 10, 8, 0, 1, index)).toISOString(), message: "Nouveau message " + index }))];
  await page.clock.fastForward(5_100);
  await page.waitForFunction(() => {
    const list = document.querySelector(".statistics-sync-log");
    return list?.children.length === 45 && list.scrollTop + list.clientHeight >= list.scrollHeight - 2;
  });
  console.log("Database counters, rankings, asset icons and automatic console scrolling: OK");

  await globalRole.getByRole("button", { name: "Tueur", exact: true }).click();
  assert.equal(count(await page.locator(".sd-lifetime strong").nth(1).innerText()), snapshot.matchHistory.filter(match => match.role === "killer").length);
  assert.equal(await page.locator(".sd-kill-panel").count(), 1);
  assert.equal(await page.locator(".sd-survival-panel").count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Survivants préférés", exact: true }).count(), 0);
  await globalRole.getByRole("button", { name: "Survivant", exact: true }).click();
  assert.equal(await page.locator(".sd-survival-panel").count(), 1);
  assert.equal(await page.locator(".sd-kill-panel").count(), 0);
  await globalRole.getByRole("button", { name: "Tous les camps", exact: true }).click();
  await page.getByRole("group", { name: "Camp des résultats détaillés" }).getByRole("button", { name: /^Tueur/ }).click();
  assert.equal(await page.locator(".sd-kill-panel").count(), 1);

  await page.getByRole("group", { name: "Période analysée" }).getByRole("button", { name: "7 jours", exact: true }).click();
  const cutoff = await page.evaluate(() => Date.now() - 7 * 86_400_000);
  const recent = snapshot.matchHistory.filter(match => match.playedAt && Date.parse(match.playedAt) >= cutoff).length;
  assert.equal(count(await page.locator(".sd-lifetime strong").nth(1).innerText()), recent);
  assert.ok((await page.locator(".sd-streak-panel > .sd-panel-header").innerText()).includes(String(recent)));
  await page.getByRole("button", { name: "Réinitialiser", exact: true }).click();
  assert.equal(count(await page.locator(".sd-lifetime strong").nth(1).innerText()), snapshot.matchHistory.length);

  const comparison = page.locator(".sd-explorer");
  const dimension = comparison.getByLabel("Comparer par", { exact: true });
  await dimension.selectOption("map");
  assert.equal(await comparison.locator(".sd-table tbody tr").count(), 10);
  await comparison.getByRole("button", { name: "Suivante →", exact: true }).click();
  assert.ok((await comparison.locator(".sd-pagination").innerText()).includes("Page 2"));
  assert.equal(await comparison.getByRole("columnheader", { name: "Taux de kill", exact: true }).count(), 0);
  await comparison.locator(".sd-row-open").first().click();
  const details = comparison.locator(".sd-row-details");
  await details.waitFor();
  assert.ok((await details.locator(".sd-result-line > strong").allTextContents()).every(value => value !== "—"));
  assert.equal(await details.getByText("Kills par partie", { exact: true }).count(), 0);
  await comparison.locator(".sd-row-open").first().click();
  await dimension.selectOption("build");
  assert.ok((await comparison.locator(".sd-pagination").innerText()).includes("Page 1"));
  assert.ok(await comparison.locator(".sd-table .sd-asset-icon.perk").count() >= 4);
  await comparison.getByLabel("Camp des comparaisons", { exact: true }).selectOption("killer");
  assert.equal(await comparison.getByRole("columnheader", { name: "Taux d’évasion", exact: true }).count(), 0);
  assert.equal(await comparison.getByRole("columnheader", { name: "Taux de kill", exact: true }).count(), 1);
  console.log("Period-dependent records, camp-dependent results, meaningful details and pages of ten: OK");

  await page.locator(".sd-ranking-panel").first().evaluate(node => node.scrollIntoView({ block: "center" }));
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".sd-ranking-panel img")).filter(image => image.getBoundingClientRect().top > 60 && image.getBoundingClientRect().bottom < innerHeight && image.src.startsWith(location.origin)).every(image => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: ".tmp-statistics-overview.png", animations: "disabled" });
  for (const width of [1440, 1000, 600, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.locator(".stats-dashboard").evaluate(node => node.scrollWidth > node.clientWidth + 1), false, "Dashboard overflow at " + width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("tab", { name: /Historique/ }).click();
  await page.locator(".statistics-match-card").first().waitFor();
  const heights = await page.locator(".statistics-match-card").evaluateAll(cards => cards.map(card => card.getBoundingClientRect().height));
  assert.equal(new Set(heights).size, 1, "All history cards have the same height");
  await page.locator(".statistics-filter-field select").first().selectOption("Lights Out");
  const cards = page.locator(".statistics-match-card");
  assert.ok(await cards.count() > 0);
  assert.equal(await page.locator(".statistics-match-mmr").count(), await cards.count());
  assert.equal(await page.getByText(/Hors MMR/).count(), 0);
  await cards.first().getByRole("button", { name: "Modifier", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Fermer", exact: true }).click();
  await cards.first().evaluate(node => node.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: ".tmp-statistics-history.png", animations: "disabled" });
  await page.getByRole("tab", { name: "MMR", exact: true }).click();
  await page.getByLabel("Mode de jeu", { exact: true }).selectOption("lights-out-survivor");
  assert.ok((await page.locator(".statistics-mmr-current").innerText()).includes("Lights Out"));
  await page.getByLabel("Mode de jeu", { exact: true }).selectOption("lights-out-killer");
  assert.ok((await page.locator(".statistics-mmr-current").innerText()).includes("départ 600"));
  assert.deepEqual(errors, []);
  console.log("Responsive layouts, equal history cards, action buttons and isolated Lights Out MMR: OK");
} finally {
  await context.close();
}
process.exit(0);
