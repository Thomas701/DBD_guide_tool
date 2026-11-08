import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = await mkdtemp(join(tmpdir(), "dbd-build-workspace-"));
const profile = join(root, ".dbd-build-tool", "codex");
await mkdir(profile, { recursive: true });
await writeFile(join(profile, "mock-account.json"), JSON.stringify({ type: "chatgpt", email: "workspace@example.com", planType: "plus" }));
const cli = fileURLToPath(new URL("./fixtures/codex-mock.mjs", import.meta.url));
const prelude = `
  import {Server} from "node:http";
  import childProcess from "node:child_process";
  import os from "node:os";
  import {syncBuiltinESMExports} from "node:module";
  const listen=Server.prototype.listen;
  Server.prototype.listen=function(...args){this.once("listening",()=>process.send({port:this.address().port}));return listen.apply(this,args);};
  const spawn=childProcess.spawn;
  childProcess.spawn=(command,args,options)=>command==="__mock_codex__"?spawn(process.execPath,[${JSON.stringify(cli)},...args],options):spawn(command,args,options);
  os.homedir=()=>${JSON.stringify(root)};
  syncBuiltinESMExports();
`;
const proxy = fork(new URL("./openai-assistant-proxy.mjs", import.meta.url), [], {
  execArgv: ["--import", `data:text/javascript,${encodeURIComponent(prelude)}`],
  env: { ...process.env, OPENAI_ASSISTANT_PORT: "0", CODEX_CLI_PATH: "__mock_codex__", CODEX_ASSISTANT_MODEL: "", DBD_CODEX_MOCK_ROOT: root },
  silent: true, windowsHide: true
});
const portReady = once(proxy, "message");
const reservation = createHttpServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const testPort = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const server = await createServer({ server: { host: "127.0.0.1", port: testPort, strictPort: true } });
let browser;
let page;
try {
  await server.listen();
  const [{ port }] = await portReady;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1680, height: 1100 } });
  const date = new Date().toISOString();
  const builds = [
    { id: "killer-existing", name: "Build tueur existant", side: "killer", killerId: "trapper", perkIds: ["agitation"], createdAt: date, updatedAt: date },
    { id: "survivor-existing", name: "Build survivant existant", side: "survivor", killerId: "jake", perkIds: ["survivor-lithe"], createdAt: date, updatedAt: date }
  ];
  await context.addInitScript(({ base, builds }) => {
    if (localStorage.getItem("workspace-test-ready")) return;
    localStorage.setItem("workspace-test-ready", "1");
    localStorage.setItem("dbd-build-tool.builds", JSON.stringify(builds));
    localStorage.setItem("dbd-build-tool.current-session", JSON.stringify({ activeView: "build", side: "survivor", selectedKillerId: "jake", buildName: "Jake", soundEnabled: false }));
    localStorage.setItem("dbd-build-tool.assistant-provider", "codex");
    localStorage.setItem("dbd-build-tool.openai-assistant-endpoint", base);
    localStorage.setItem("dbd-build-tool.perk-description-overrides", JSON.stringify({ "survivor-flow-state": "<p>Description de test personnalisée.</p>", "survivor-lithe": "<p>Épuisement, Brisé, État critique et Insaisissable.</p>" }));
  }, { base: `http://127.0.0.1:${port}`, builds });
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/local-data/**", (route) => route.fulfill({ json: { success: true } }));
  await page.route("**/api/statistics/**", (route) => route.fulfill({ json: { connected: false, nextSyncAt: null } }));
  await page.goto(server.resolvedUrls.local[0]);
  const launcher = page.getByRole("combobox", { name: "Ouvrir un build", exact: true });
  await launcher.locator('option[value="survivor-existing"]').waitFor({ state: "attached" });
  assert.equal(await launcher.locator('option[value="killer-existing"]').count(), 0);

  const assistant = page.locator(".build-assistant");
  await assistant.getByText("workspace@example.com", { exact: true }).waitFor();
  const question = "Je ne joue qu'avec Jake park, créer moi:\n- le meilleur build possible pour faire les générateurs rapidement\n- le meilleur build possible pour tenir une chase face à un tueur";
  await assistant.getByRole("textbox", { name: "Question ou demande de modification" }).fill(question);
  await assistant.getByRole("button", { name: "Envoyer", exact: true }).click();
  await assistant.locator(".chat-history").getByText("Voici les deux builds pour Jake Park.", { exact: false }).waitFor();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("dbd-build-tool.builds")));
  const created = saved.filter((build) => !build.id.endsWith("existing"));
  assert.equal(created.length, 2);
  assert.ok(created.every((build) => build.side === "survivor" && build.killerId === "jake" && build.perkIds.length === 4 && build.perkIds.every((id) => id.startsWith("survivor-"))));
  assert.equal(await launcher.locator("option").count(), 4);
  for (const build of created) {
    await launcher.selectOption(build.id);
    await page.waitForFunction((id) => JSON.parse(localStorage.getItem("dbd-build-tool.current-session"))?.activeBuildId === id, build.id);
    assert.equal(await launcher.inputValue(), build.id);
  }
  const draftName = `${created.at(-1).name} (brouillon)`;
  await page.getByRole("textbox", { name: "Build Name", exact: true }).fill(draftName);
  await page.getByRole("button", { name: "Passer au mode Tueur", exact: true }).click();
  await launcher.locator('option[value="killer-existing"]').waitFor({ state: "attached" });
  assert.equal(await launcher.locator("option").count(), 2);
  await launcher.selectOption("killer-existing");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("dbd-build-tool.current-session"))?.activeBuildId === "killer-existing");
  await page.reload();
  await launcher.locator('option[value="killer-existing"]').waitFor({ state: "attached" });
  assert.equal(await launcher.inputValue(), "killer-existing");
  await page.getByRole("button", { name: "Passer au mode Survivant", exact: true }).click();
  await launcher.locator('option[value="survivor-existing"]').waitFor({ state: "attached" });
  assert.equal(await launcher.locator("option").count(), 4);
  assert.equal(await launcher.inputValue(), created.at(-1).id);
  assert.equal(await page.getByRole("textbox", { name: "Build Name", exact: true }).inputValue(), draftName);
  await page.waitForFunction((id) => JSON.parse(localStorage.getItem("dbd-build-tool.current-session"))?.activeBuildId === id, created.at(-1).id);
  await page.reload();
  await launcher.locator('option[value="survivor-existing"]').waitFor({ state: "attached" });
  assert.equal(await launcher.inputValue(), created.at(-1).id);
  assert.equal(await page.getByRole("textbox", { name: "Build Name", exact: true }).inputValue(), draftName);
  await page.getByRole("button", { name: "Passer au mode Tueur", exact: true }).click();
  await launcher.locator('option[value="killer-existing"]').waitFor({ state: "attached" });
  assert.equal(await launcher.inputValue(), "killer-existing");
  await page.getByRole("button", { name: "Passer au mode Survivant", exact: true }).click();
  await launcher.locator('option[value="survivor-existing"]').waitFor({ state: "attached" });
  await launcher.selectOption("survivor-existing");
  await page.getByRole("button", { name: "Sélectionner Souple", exact: true }).click();
  const inspector = page.getByRole("region", { name: "Détails de la perk", exact: true });
  const glossary = inspector.getByRole("region", { name: "Définition des termes de la perk" });
  await glossary.getByText("Insaisissable", { exact: true }).waitFor();
  assert.equal(await glossary.locator("dt").count(), 4);
  assert.equal(await glossary.getByRole("heading").count(), 0);
  assert.equal(await inspector.locator(".description-surface .perk-status-definitions").count(), 0);
  if (process.env.DBD_WORKSPACE_SCREENSHOT) {
    await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map((animation) => animation.finished.catch(() => {}))));
    await page.screenshot({ path: process.env.DBD_WORKSPACE_SCREENSHOT.replace(/\.png$/, "-definitions.png") });
  }
  await page.getByRole("button", { name: "Fermer les détails de la perk", exact: true }).click();
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: "Perks", exact: true }).click();
  const cooldown = page.getByLabel("Cooldown", { exact: true });
  await cooldown.selectOption("with");
  await page.locator('.perk-card[data-perk-id="survivor-finesse"]').waitFor();
  assert.equal(await page.locator('.perk-card[data-perk-id="survivor-built-to-last"]').count(), 0);
  await cooldown.selectOption("without");
  await page.locator('.perk-card[data-perk-id="survivor-built-to-last"]').waitFor();
  assert.equal(await page.locator('.perk-card[data-perk-id="survivor-finesse"]').count(), 0);
  await cooldown.selectOption("any");

  const navigation = page.getByRole("navigation", { name: "Navigation principale" });
  await navigation.getByRole("button", { name: "Tiers List", exact: true }).click();
  const tierPage = page.locator(".tier-list-page");
  const killerCard = tierPage.getByRole("button", { name: "Détails de le piégeur", exact: true });
  await killerCard.click();
  await page.getByRole("complementary", { name: "Détails du tueur" }).getByRole("heading", { name: "Pouvoir", exact: true }).waitFor();
  await page.setViewportSize({ width: 1680, height: 640 });
  const assertScroll = async () => {
    const panel = page.locator(".tier-list-inspector");
    assert.equal(await panel.evaluate((element) => getComputedStyle(element).overflowY), "auto");
    assert.ok(await panel.evaluate((element) => element.scrollHeight > element.clientHeight));
    await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.pseudoElement?.includes("view-transition")).map((animation) => animation.finished.catch(() => {}))));
    await panel.click({ position: { x: 8, y: 8 } });
    await page.mouse.wheel(0, 1800);
    await page.waitForFunction(() => document.querySelector(".tier-list-inspector").scrollTop > 0, undefined, { timeout: 5000 });
    await panel.evaluate((element) => { element.scrollTop = 0; });
  };
  await assertScroll();
  await page.setViewportSize({ width: 1680, height: 1100 });
  const target = tierPage.locator('.tier-list-row[data-tier="S+"]');
  await killerCard.dragTo(target);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("dbd-build-tool.tier-overrides"))?.killers.trapper === "S+");
  await tierPage.getByRole("button", { name: "Perk killer", exact: true }).click();
  assert.equal(await tierPage.getByRole("listitem").count(), 145);
  await tierPage.getByRole("button", { name: "Détails de agitation", exact: true }).click();
  const perkDetails = page.getByRole("complementary", { name: "Détails de la perk" });
  await perkDetails.getByRole("heading", { name: "Catégories", exact: true }).waitFor();
  await perkDetails.getByLabel("Tier de la sélection").selectOption("D");
  await tierPage.getByRole("button", { name: "Perk survivor", exact: true }).click();
  assert.equal(await tierPage.getByRole("listitem").count(), 176);
  await tierPage.getByRole("button", { name: "Détails de Souple", exact: true }).click();
  await perkDetails.getByRole("region", { name: "Définition des termes de la perk" }).getByText("Insaisissable", { exact: true }).waitFor();
  await page.setViewportSize({ width: 1680, height: 640 });
  await assertScroll();
  await page.setViewportSize({ width: 1680, height: 1100 });
  const survivorCard = tierPage.getByRole("button", { name: "Détails de État de flux", exact: true });
  await survivorCard.click();
  await perkDetails.getByText("Description de test personnalisée.", { exact: true }).waitFor();
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await survivorCard.dispatchEvent("dragstart", { dataTransfer: transfer });
  await target.dispatchEvent("dragover", { dataTransfer: transfer });
  await target.dispatchEvent("drop", { dataTransfer: transfer });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("dbd-build-tool.tier-overrides"))?.perks["survivor-flow-state"] === "S+");
  await page.reload();
  await tierPage.getByRole("button", { name: "Perk killer", exact: true }).click();
  assert.equal(await tierPage.locator('.tier-list-row[data-tier="D"]').getByRole("button", { name: "Détails de agitation", exact: true }).count(), 1);
  await tierPage.getByRole("button", { name: "Perk survivor", exact: true }).click();
  assert.equal(await target.getByRole("button", { name: "Détails de État de flux", exact: true }).count(), 1);
  await tierPage.getByRole("button", { name: "Détails de État de flux", exact: true }).click();
  const killerScenario = {
    activeView: "build", side: "killer", selectedKillerId: "trapper", buildName: "Vérification des reworks", soundEnabled: false,
    equippedPerkIds: ["unrelenting", "undone", "scourge-hook-monstrous-shrine", "help-wanted"],
    scenario: { conditions: { generator_damaged: true, perk_triggered: true, survivor_hooked: true, scourge_hook: true, far_from_hook: true }, perkStates: { "help-wanted": "active" } }
  };
  await page.evaluate((session) => localStorage.setItem("dbd-build-tool.current-session", JSON.stringify(session)), killerScenario);
  await page.reload();
  const impact = page.getByRole("region", { name: "Impact Analysis", exact: true });
  await impact.getByText("Charges retirées instantanément au générateur", { exact: true }).waitFor();
  await impact.getByText("27 charges", { exact: false }).first().waitFor();
  assert.equal(await impact.getByText("Durée d’une phase de crochet", { exact: true }).count(), 0);
  assert.equal(await impact.getByText("Récupération après attaque ratée", { exact: true }).count(), 1);
  const survivorScenario = {
    activeView: "build", side: "survivor", selectedKillerId: "jake", buildName: "Vérification de l’analyse survivant", soundEnabled: false,
    equippedPerkIds: ["survivor-lithe", "survivor-botany-knowledge", "survivor-resilience", "survivor-finesse"],
    scenario: { conditions: { after_survivor_vault: true, perk_triggered: true }, perkStates: {} }
  };
  await page.evaluate((session) => localStorage.setItem("dbd-build-tool.current-session", JSON.stringify(session)), survivorScenario);
  await page.reload();
  const speedRow = impact.locator(".stat-impact-row").filter({ has: page.getByText("Vitesse de course des survivants", { exact: true }) });
  const healRow = impact.locator(".stat-impact-row").filter({ has: page.getByText("Soin d’un survivant", { exact: true }) });
  await speedRow.locator(".modified").getByText("6 m/s", { exact: true }).waitFor();
  assert.ok((await speedRow.getAttribute("class")).includes("positive"));
  assert.equal(await healRow.locator(".modified").innerText(), "10,667 s");
  assert.equal(await impact.getByText("Aucun effet structuré.", { exact: false }).count(), 0);
  await page.getByRole("button", { name: "Afficher les conditions de Souple", exact: true }).click();
  await page.getByRole("checkbox", { name: "Survivant épuisé", exact: true }).check();
  await speedRow.locator(".modified").getByText("4 m/s", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Afficher les conditions de Résistance", exact: true }).click();
  await page.getByRole("checkbox", { name: "Un survivant est blessé", exact: true }).check();
  await page.getByRole("button", { name: "Afficher les conditions de Finesse", exact: true }).click();
  assert.equal(await page.getByRole("checkbox", { name: "Survivant en bonne santé", exact: true }).isChecked(), false);
  await page.getByRole("checkbox", { name: "Survivant en bonne santé", exact: true }).check();
  assert.equal(await page.getByRole("checkbox", { name: "Un survivant est blessé", exact: true }).isChecked(), false);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("dbd-build-tool.current-session"))?.scenario.conditions.survivor_healthy === true);
  await page.reload();
  assert.equal(await speedRow.locator(".modified").innerText(), "4 m/s");
  await page.evaluate((session) => localStorage.setItem("dbd-build-tool.current-session", JSON.stringify(session)), {
    ...survivorScenario, equippedPerkIds: ["survivor-eyes-of-belmont", "survivor-alert", "survivor-bond", "survivor-open-handed"],
    scenario: { conditions: { generator_completed: true, perk_triggered: true }, perkStates: {} }
  });
  await page.reload();
  await impact.getByText("Portée d’aura : 52 m", { exact: true }).waitFor();
  await impact.getByText("révélation pendant 7 s", { exact: false }).waitFor();
  assert.ok(await impact.locator(".qualitative-impact-row strong, .qualitative-impact-row .effect-detail").evaluateAll((elements) => elements.every((element) => getComputedStyle(element).whiteSpace === "normal" && element.scrollWidth <= element.clientWidth)));
  assert.deepEqual(errors, []);
  console.log("Validé : builds Jake sauvegardés, reprise des camps, glossaire, filtres, analyses tueur et survivant, santé/Épuisement, synergies d’auras, détails défilants et tiers persistants.");
} finally {
  if (process.env.DBD_WORKSPACE_SCREENSHOT && page && !page.isClosed()) await page.screenshot({ path: process.env.DBD_WORKSPACE_SCREENSHOT });
  await browser?.close();
  await server.close();
  if (proxy.exitCode === null && proxy.signalCode === null) { const stopped = once(proxy, "exit"); proxy.kill(); await stopped; }
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
