import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { preview } from "vite";

const reservations = [createServer(), createServer()];
const ports = [];
try {
  for (const server of reservations) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    ports.push(server.address().port);
  }
} finally {
  await Promise.all(reservations.filter(server => server.listening).map(server => new Promise(resolve => server.close(resolve))));
}

const site = await preview({ logLevel: "silent", preview: { host: "127.0.0.1", port: 0 } });
const origin = `http://127.0.0.1:${site.httpServer.address().port}`;
const base = `${origin}${site.config.base}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent("<h1>Installation prête</h1>");
  assert.equal(await page.locator("h1").innerText(), "Installation prête");
  await page.close();
  const storeUrl = "https://chromewebstore.google.com/detail/" + "a".repeat(32);
  for (const [userAgent, name, address, label, brave] of [
    ["Mozilla Chrome/140.0 Safari/537.36", "Chrome / Chromium", "chrome://extensions", "Charger l’extension non empaquetée"],
    ["Mozilla Chrome/140.0 Safari/537.36 Edg/140.0", "Edge", "edge://extensions", "Charger l’extension décompressée"],
    ["Mozilla Chrome/140.0 Safari/537.36 OPR/124.0", "Opera / Opera GX", "opera://extensions", "Charger une extension non empaquetée"],
    ["Mozilla Chrome/140.0 Vivaldi/7.6", "Vivaldi", "vivaldi://extensions", "Charger l’extension non empaquetée"],
    ["Mozilla Chrome/140.0 Safari/537.36", "Brave", "brave://extensions", "Charger l’extension non empaquetée", true],
    ["Mozilla Firefox/142.0", "Firefox", ""],
    ["Mozilla Version/18.0 Safari/605.1.15", "Safari", ""],
    ["Mozilla Android Chrome/140.0 Mobile", "Navigateur mobile", ""],
    ["Unknown browser", "Autre navigateur", ""],
  ]) {
    const context = await browser.newContext({ userAgent });
    try {
      await context.addInitScript(brave => {
        if (brave) Object.defineProperty(navigator, "brave", { value: { isBrave: async () => true } });
        Object.defineProperty(navigator, "clipboard", { value: { writeText: async text => { window.copiedAddress = text; } } });
      }, brave);
      await context.route("**/extension-store.json", route => route.fulfill({ json: { chromeWebStoreUrl: storeUrl } }));
      const guide = await context.newPage(), errors = [];
      guide.on("pageerror", error => errors.push(error.message));
      await guide.goto(`${base}extension-installation.html`);
      await guide.waitForFunction(name => document.querySelector("#browser").value === name, name);
      await guide.waitForFunction(url => document.querySelector("#store").getAttribute("href") === url, storeUrl);
      await guide.locator("#manual").evaluate(details => { details.open = true; });
      assert.equal(await guide.locator("#extensions-url").textContent(), address, name);
      assert.equal(await guide.locator("#manual-steps").isVisible(), Boolean(address), name);
      assert.equal(await guide.locator("#manual-unsupported").isVisible(), !address, name);
      assert.equal(await guide.locator("#store").isVisible(), Boolean(address), name);
      if (address) {
        assert.equal(await guide.locator("#load-label").textContent(), label, name);
        await guide.locator("#copy").click();
        await guide.waitForFunction(address => window.copiedAddress === address, address);
      } else assert.match(await guide.locator("#manual-unsupported").textContent(), /même compte Build Analyzer/);
      // A masked user agent can still use the right guide; copying follows the current selection.
      await guide.locator("#browser").selectOption("Opera / Opera GX");
      await guide.locator("#copy").click();
      await guide.waitForFunction(() => window.copiedAddress === "opera://extensions");
      await guide.locator("#browser").selectOption("Firefox");
      assert.equal(await guide.locator("#store").isVisible(), false);
      assert.equal(await guide.locator("#manual-steps").isVisible(), false);
      // A failed store request must leave the manual guide usable.
      await context.route("**/extension-store.json", route => route.abort());
      await guide.reload();
      await guide.waitForFunction(() => document.querySelector("#status").textContent.includes("ci-dessous"));
      assert.equal(await guide.locator("#store").isVisible(), false);
      assert.equal(await guide.locator("#manual").getAttribute("open"), "");
      assert.deepEqual(errors, [], name);
    } finally { await context.close(); }
  }
  console.log("Guide d’installation vérifié : Chrome, Edge, Opera / GX, Brave, Vivaldi, Firefox, Safari, mobile et navigateur inconnu ; sélection et copie de l’adresse, boutique indisponible.");
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => site.httpServer.close(error => error ? reject(error) : resolve()));
}

const child = spawn(process.execPath, ["scripts/start-app.mjs"], {
  env: { ...process.env, DBD_WEBAPP_SMOKE_TEST: "1", DBD_APP_URL: `http://127.0.0.1:${ports[0]}`, DBD_ASSISTANT_SERVER_URL: `http://127.0.0.1:${ports[1]}` },
  windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
child.stderr.setEncoding("utf8").on("data", chunk => { output += chunk; });
const [code] = await once(child, "close");
assert.equal(code, 0, output);
assert.match(output, /Vérification de démarrage terminée/);
console.log("Installation vérifiée : navigateur opérationnel, interface et serveur local démarrés puis arrêtés proprement sur des ports isolés.");
