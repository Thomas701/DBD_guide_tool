import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { host: "127.0.0.1", port: 5189, strictPort: false }, logLevel: "error" });
let browser;
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  const icon = new URL("icons/favicon-32.png", base).href;
  const now = new Date().toISOString();
  const snapshot = {
    updatedAt: now,
    statistics: { hoursPlayed: "120", matchesPlayed: "42", bloodpointsEarned: "100000", sourceUrl: "https://stats.deadbydaylight.com/" },
    matchHistory: [4, 8].map(count => ({
      id: `mobile-${count}`, characterName: "The Trapper", role: "killer", resultLabel: "Victory", score: 32000,
      characterImageUrl: icon, perkIconUrls: Array(4).fill(icon), perkIconLabels: ["Agitation", "Brutal Strength", "Unnerving Presence", "Iron Grasp"],
      equipmentIconUrls: [icon, icon], equipmentIconLabels: ["Accessoire", "Offrande"],
      participants: Array.from({ length: count }, (_, index) => ({ name: `Survivant ${index + 1}`, role: "survivor", score: 12000 + index * 1000, resultLabel: index ? "Sacrificed" : "Escaped", imageUrl: icon, survivalTimeLabel: "5:00" })),
      mapName: "MacMillan Estate", mapImageUrl: icon, playedAt: now, playedAtLabel: "Aujourd’hui", importedAt: now,
      durationLabel: "10:00", queueLabel: count === 8 ? "2v8" : "1v4", sourceUrl: "https://stats.deadbydaylight.com/",
    })),
  };
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    if (!localStorage.getItem("dbd-build-tool.current-session")) localStorage.setItem("dbd-build-tool.current-session", JSON.stringify({ activeView: "killers", side: "killer", soundEnabled: false }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => route.fulfill({ json: route.request().url().includes("/statistics/cache") ? snapshot : { connected: false, busy: false, nextSyncAt: null } }));
  await page.goto(base);
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  async function navigate(name) {
    const button = nav.getByRole("button", { name, exact: true });
    await button.click();
    await button.and(nav.locator('[aria-current="page"]')).waitFor();
  }
  async function noOverflow(label) {
    const size = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(size.content <= size.viewport + 1, `${label}: page overflows (${size.content}/${size.viewport})`);
  }

  // The primary touch journey: character, perk details, equipment, save, reload.
  await page.locator(".killer-card").first().tap();
  await page.locator(".view-perks").waitFor();
  const search = page.getByRole("searchbox", { name: "Recherche", exact: true });
  await search.fill("agitation");
  const card = page.locator('.perk-card[data-perk-id="agitation"]');
  const detailsButton = card.locator(".perk-card-details");
  await detailsButton.click();
  const dialog = page.getByRole("dialog", { name: "Détails de la perk", exact: true });
  await dialog.waitFor();
  if (process.env.DBD_MOBILE_SCREENSHOTS) await page.screenshot({ path: ".tmp-mobile-final-Inspector.png" });
  assert.equal(await dialog.evaluate(element => element.matches(":modal")), true);
  await page.keyboard.press("Tab");
  assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
  await dialog.getByRole("button", { name: "Fermer les détails de la perk", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(await detailsButton.evaluate(element => element === document.activeElement), true);
  await detailsButton.click();
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await card.getByRole("button", { name: "Ajouter au build", exact: true }).tap();
  await search.fill("");
  for (let index = 0; index < 3; index++) await page.locator(".perk-card").getByRole("button", { name: "Ajouter au build", exact: true }).first().click();
  assert.ok(await page.getByRole("button", { name: "Build complet", exact: true }).first().isDisabled());
  await page.getByRole("button", { name: "Mon build · 4/4 perks · Enregistrer", exact: true }).tap();
  await page.getByRole("textbox", { name: "Build Name", exact: true }).fill("Build téléphone");
  await page.getByRole("button", { name: "Sauvegarder", exact: true }).click();
  await page.reload();
  await page.getByRole("textbox", { name: "Build Name", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Build Name", exact: true }).inputValue(), "Build téléphone");
  assert.equal(await page.locator(".compact-perk-slot.filled").count(), 4);

  await navigate("Perks");
  const filters = page.getByRole("button", { name: "Filtres avancés", exact: true });
  await filters.click();
  await page.getByRole("combobox", { name: "Cooldown", exact: true }).selectOption("with");
  await page.getByRole("button", { name: "Filtres avancés (1)", exact: true }).click();
  assert.equal(await page.getByRole("combobox", { name: "Cooldown", exact: true }).isVisible(), false);

  await navigate("Tiers List");
  await page.getByRole("button", { name: "Détails de le piégeur", exact: true }).click();
  const tierDialog = page.getByRole("dialog", { name: "Détails du tueur", exact: true });
  await tierDialog.getByRole("combobox", { name: "Tier de la sélection", exact: true }).selectOption("D");
  await tierDialog.getByRole("button", { name: "Fermer les détails", exact: true }).click();
  assert.equal(await page.locator('.tier-list-row[data-tier="D"]').getByRole("button", { name: "Détails de le piégeur", exact: true }).count(), 1);

  for (const width of [320, 390, 430, 768, 900]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of ["Build", "Killers", "Perks", "Tiers List", "BlindTest", "Constantes", "Statistique", "Classement", "Administration"]) {
      await navigate(name);
      await noOverflow(`${width}px / ${name}`);
      if (width === 390 && process.env.DBD_MOBILE_SCREENSHOTS) await page.screenshot({ path: `.tmp-mobile-final-${name.replaceAll(" ", "-")}.png` });
      if (name === "Statistique") {
        await page.getByRole("button", { name: "Filtres des statistiques", exact: true }).click();
        await noOverflow(`${width}px / statistics filters`);
        await page.getByRole("button", { name: "Filtres des statistiques", exact: true }).click();
        await page.getByRole("tab", { name: /^Historique/ }).click();
        await page.locator(".statistics-match-card").first().waitFor();
        await noOverflow(`${width}px / match history`);
        const participants = page.locator(".statistics-match-participants").last();
        assert.equal(await participants.locator(".statistics-participant-card").count(), 8);
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Passer au mode Survivant", exact: true }).click();
  await page.locator(".killer-card").first().click();
  await page.locator(".view-perks").waitFor();
  assert.equal(await page.locator(".compact-perk-icon.empty").count(), 4);
  await page.getByRole("button", { name: "Passer au mode Tueur", exact: true }).click();
  await navigate("Build");
  assert.equal(await page.getByRole("textbox", { name: "Build Name", exact: true }).inputValue(), "Build téléphone");
  await page.getByRole("button", { name: "Paramètres", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Paramètres", exact: true });
  await settings.getByRole("checkbox", { name: "Activer le son", exact: true }).check();
  await settings.getByRole("button", { name: "Fermer", exact: true }).click();
  await navigate("BlindTest");
  await page.getByRole("button", { name: "▶ Play", exact: true }).click();
  await page.locator(".blind-test-game").waitFor();
  await page.setViewportSize({ width: 320, height: 720 });
  await noOverflow("320px / BlindTest game");
  await page.getByRole("button", { name: "Abandonner", exact: true }).click();
  // A sheet becomes the original sidebar when rotating/resizing to desktop.
  await navigate("Perks");
  await page.getByRole("button", { name: "Réinitialiser", exact: true }).click();
  await page.locator(".perk-card-details").first().click();
  await page.locator("dialog.mobile-inspector:modal").waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("dialog.mobile-inspector").waitFor({ state: "detached" });
  await page.locator(".right-sidebar .perk-inspector-panel").waitFor();
  assert.equal(await page.locator(".mobile-filter-toggle").first().isVisible(), false);
  await noOverflow("Desktop / perks");
  await page.locator(".right-sidebar").getByRole("button", { name: "Fermer les détails de la perk", exact: true }).click();
  await navigate("Build");
  await noOverflow("Desktop / build");
  assert.equal(await page.getByRole("separator", { name: "Redimensionner la sidebar gauche", exact: true }).isVisible(), true);
  assert.deepEqual(errors, []);
  console.log("Mobile verified: 320–900px, touch build/save/reload, filters, modal focus/Escape, tier placement, 1v4/2v8 history, and desktop layout.");
} finally {
  await browser?.close();
  await server.close();
}
