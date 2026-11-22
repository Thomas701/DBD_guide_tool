import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { APP_URL } from "../extension/config.mjs";
import { behaviourHistory, behaviourOverview, behaviourSession, behaviourToken } from "../tests/fixtures/behaviour-api.mjs";

const root = process.cwd(), profile = await mkdtemp(join(root, ".tmp-extension-browser-"));
const extension = resolve(".tmp-statistics-extension"), id = "kiefmoeclpffgabjgaadfnmnfnocpffm";
let context;
try {
  context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  let worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  assert.equal(new URL(worker.url()).host, id);
  async function mockNetwork() {
    await worker.evaluate(({ history, overview, token }) => {
      globalThis.uploads = []; globalThis.refreshes = 0; globalThis.tabsCreated = 0;
      chrome.tabs.create = async () => { globalThis.tabsCreated++; throw new Error("Background sync must not open tabs"); };
      globalThis.fetch = async (url, init) => {
        if (url.includes("supabase.co/")) { globalThis.uploads.push(JSON.parse(init.body)); return Response.json({ importedCount: 1 }); }
        if (url.endsWith("/sso/token")) { globalThis.refreshes++; return Response.json({ access_token: token, refresh_token: "rotated-private-refresh", expires_in: 3600, refresh_token_expire_date: new Date(Date.now() + 86400_000).toISOString() }); }
        if (url.includes("match-history")) return Response.json(history);
        if (url.includes("/player-stats/")) return Response.json(overview);
        throw new Error("Unexpected request");
      };
    }, { history: behaviourHistory, overview: behaviourOverview, token: behaviourToken("alice") });
  }
  await mockNetwork();
  await context.route(APP_URL, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Build Analyzer test</title>" }));
  await context.route("https://stats.deadbydaylight.com/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Behaviour login test</title>" }));
  let page = await context.newPage(); await page.goto(APP_URL);
  const send = request => page.evaluate(({ id, request }) => new Promise(resolve => chrome.runtime.sendMessage(id, request, resolve)), { id, request });
  const pairing = { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", supabaseUrl: "https://test-project.supabase.co", publishableKey: "sb_publishable_test_1234567890", collectorToken: "a".repeat(64) };
  assert.deepEqual(await send({ type: "DBD_EXTENSION_PAIR", pairing }), { ok: true, loginRequired: true });
  assert.equal(context.pages().some(p => p.url().includes("stats.deadbydaylight.com")), false);
  const session = behaviourSession();
  await context.addInitScript(session => { localStorage.setItem("auth-store", JSON.stringify({ state: session })); localStorage.setItem("providers-store", JSON.stringify({ state: { selectedProvider: "egs" } })); }, session);
  const login = await context.newPage(); await login.goto("https://stats.deadbydaylight.com/statistics/");
  async function waitForUpload(minimum) {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await worker.evaluate(minimum => globalThis.uploads.filter(item => item.collector_state === "success").length >= minimum, minimum)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Upload missing: ${await worker.evaluate(async () => JSON.stringify({ uploads: globalThis.uploads, status: (await chrome.storage.local.get("status")).status }))}`);
  }
  await waitForUpload(1); await login.close();
  await worker.evaluate(async () => { const { behaviourSession } = await chrome.storage.local.get("behaviourSession"); behaviourSession.authToken.expirationDate = 0; await chrome.storage.local.set({ behaviourSession }); });
  await send({ type: "DBD_EXTENSION_SYNC", userId: pairing.userId }); await waitForUpload(2);
  assert.deepEqual(await worker.evaluate(() => ({ refreshes: globalThis.refreshes, tabsCreated: globalThis.tabsCreated })), { refreshes: 1, tabsCreated: 0 });
  assert.equal(context.pages().some(p => p.url().includes("stats.deadbydaylight.com")), false);
  const uploads = await worker.evaluate(() => globalThis.uploads);
  assert.equal(uploads[1].matches[0].participants.length, 2);
  assert.ok(!JSON.stringify(uploads).includes("private-refresh")); assert.ok(!JSON.stringify(uploads).includes("header."));
  await context.close();
  context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await mockNetwork();
  await context.route(APP_URL, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Build Analyzer test</title>" }));
  page = await context.newPage(); await page.goto(APP_URL);
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get("behaviourSession")).behaviourSession.refreshToken.token === "rotated-private-refresh"), true);
  await send({ type: "DBD_EXTENSION_SYNC", userId: pairing.userId }); await waitForUpload(1);
  assert.equal(await worker.evaluate(() => globalThis.tabsCreated), 0);
  await send({ type: "DBD_EXTENSION_DISCONNECT", userId: pairing.userId });
  assert.equal(await worker.evaluate(async () => Boolean((await chrome.storage.local.get("behaviourSession")).behaviourSession)), false);
  console.log("Extension checked: real content bridge, API sync with Behaviour tabs closed, token renewal, worker restart, no tabs created and no Behaviour credentials uploaded.");
} finally {
  await context?.close();
  if (!resolve(profile).startsWith(`${resolve(root)}\\.tmp-extension-browser-`) && !resolve(profile).startsWith(`${resolve(root)}/.tmp-extension-browser-`)) throw new Error("Unexpected browser profile path.");
  await rm(profile, { recursive: true, force: true });
}
