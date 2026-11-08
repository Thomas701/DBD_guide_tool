import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { chromium } from "playwright";

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

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent("<h1>Installation prête</h1>");
  assert.equal(await page.locator("h1").innerText(), "Installation prête");
} finally {
  await browser.close();
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
