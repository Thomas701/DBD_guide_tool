import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { setTimeout as delay } from "node:timers/promises";
import { extractMatchHistoryEntriesFromHtml } from "./dbd-statistics-provider.mjs";

// Run with the app on localhost:5173 and the statistics Chrome session on port 9333.
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
try {
  const page = await context.newPage();
  await page.clock.install();
  let syncRequests = 0;
  const snapshot = JSON.parse(await readFile(".data/dbd-statistics.json", "utf8"));
  snapshot.matchHistory = extractMatchHistoryEntriesFromHtml(await readFile("html_history_match_example.txt", "utf8"), "https://stats.deadbydaylight.com/match-history/", new Date("2026-09-17T21:00:00Z"));
  // Use a different participant loadout to catch accidentally showing the main player's perks.
  snapshot.matchHistory[0].participants[0].perkIconUrls = [snapshot.matchHistory[0].perkIconUrls.at(-1)];
  snapshot.matchHistory[0].participants[0].equipmentIconUrls = [];
  snapshot.matchHistory = [
    ...snapshot.matchHistory,
    ...snapshot.matchHistory.map(match => ({ ...match, id: `${match.id}-copy` })),
    { ...snapshot.matchHistory[0], id: "extra" },
  ];
  await page.route("**/api/statistics/**", route => {
    if (route.request().method() === "POST") syncRequests++;
    return route.fulfill({ json: route.request().url().endsWith("/status")
    ? { busy: false, phase: "idle", logs: [] }
    : snapshot });
  });
  await page.goto("http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Statistique", exact: true }).click();
  const timer = page.getByRole("timer", { name: "Prochaine synchronisation automatique" });
  await timer.locator("strong").waitFor();
  const seconds = text => text.split(":").reduce((minutes, value) => minutes * 60 + Number(value), 0);
  const before = seconds(await timer.locator("strong").innerText());
  await page.clock.fastForward(1_000);
  assert.equal(seconds(await timer.locator("strong").innerText()), before - 1, "Countdown advances every second");
  await page.getByRole("tab", { name: /Historique/ }).click();
  const cards = page.locator(".statistics-match-card");
  await cards.first().waitFor();
  assert.equal(await cards.count(), 30);
  const groups = await cards.first().locator(".statistics-loadout-group-card").evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.firstElementChild.textContent, node.querySelectorAll(".statistics-loadout-icon").length])));
  assert.deepEqual(groups, { Perks: 4, Pouvoir: 1, Accessoires: 2, Offrande: 1 });
  assert.ok(await page.locator('.statistics-participant-status img[alt="Sacrificed"]').count() > 0);
  assert.ok(await page.locator('.statistics-participant-status img[alt="Escaped"]').count() > 0);
  assert.equal(await page.locator(".statistics-chip.muted").count(), 0);
  await cards.first().locator(".statistics-match-identity").click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.equal(await dialog.locator(".statistics-loadout-icon.perk").count(), 4);
  await page.getByRole("button", { name: "Fermer les détails" }).click();
  await cards.first().locator(".statistics-participant-card").first().click();
  await dialog.waitFor();
  const participant = snapshot.matchHistory[0].participants[0];
  assert.equal(await dialog.locator(".statistics-loadout-icon.perk").count(), 1);
  assert.deepEqual(await dialog.locator(".statistics-loadout-icon.perk img").evaluateAll(nodes => nodes.map(node => node.getAttribute("src"))), participant.perkIconUrls);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.getByRole("button", { name: "Page suivante", exact: true }).first().click();
  assert.equal(await cards.count(), 30);
  await page.getByRole("button", { name: "Page suivante", exact: true }).first().click();
  assert.equal(await cards.count(), 1);
  const filters = page.locator(".statistics-filter-field select");
  await filters.nth(0).selectOption("2v8");
  assert.ok(await cards.count() > 0);
  assert.equal(await page.locator(".statistics-match-loadout").getByText("Perks", { exact: true }).count(), 0);
  assert.ok(await page.locator(".statistics-match-loadout").getByText("Rôles", { exact: true }).count() > 0);
  await filters.nth(1).selectOption("survivor");
  await filters.nth(2).selectOption("Mount Ormond Resort");
  assert.ok(await cards.count() > 0);
  for (let i = 0; i < 3; i++) await filters.nth(i).selectOption("all");
  for (const width of [1600, 1300, 1000, 600]) {
    await page.setViewportSize({ width, height: 1000 });
    const sizes = await cards.evaluateAll(nodes => nodes.map(node => ({ height: node.getBoundingClientRect().height, width: node.clientWidth, scroll: node.scrollWidth })));
    assert.equal(new Set(sizes.map(size => size.height)).size, 1, `Equal heights at ${width}px`);
    if (width >= 1300) assert.ok(sizes[0].height <= 200, `Compact cards at ${width}px: ${sizes[0].height}`);
    assert.ok(sizes.every(size => size.scroll <= size.width), `No clipped columns at ${width}px: ${JSON.stringify(sizes[0])}`);
    console.log(`${width}px: equal card heights, no clipped columns`);
  }
  console.log("Pagination (30/30/1), combined filters and 2v8 roles: OK");
  const initialSyncs = syncRequests;
  await page.clock.fastForward(5 * 60_000);
  for (let i = 0; i < 30 && syncRequests === initialSyncs; i++) await delay(100);
  assert.equal(syncRequests, initialSyncs + 1, "One automatic sync every five minutes");
  assert.ok(seconds(await timer.locator("strong").innerText()) > 280, "Countdown resets for the next sync");
  await page.getByRole("button", { name: "Killers", exact: true }).click();
  const previousSyncs = syncRequests;
  await page.clock.fastForward(5 * 60_000);
  for (let i = 0; i < 30 && syncRequests === previousSyncs; i++) await delay(100);
  assert.equal(syncRequests, previousSyncs + 1, "Automatic sync outside the statistics view");
  console.log("Five minute sync in statistics and another view: OK");
} finally {
  await context.close();
}
process.exit(0);
