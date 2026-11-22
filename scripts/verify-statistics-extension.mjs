import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { APP_URL } from "../extension/config.mjs";
import { behaviourSession } from "../tests/fixtures/behaviour-api.mjs";

const root = process.cwd(), profile = await mkdtemp(join(root, ".tmp-extension-browser-"));
const extension = resolve(".tmp-statistics-extension"), id = "kiefmoeclpffgabjgaadfnmnfnocpffm";
const pairing = { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", supabaseUrl: "https://test-project.supabase.co", publishableKey: "sb_publishable_test_1234567890", collectorToken: "a".repeat(64) };
let context;
try {
  async function launch() {
    context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    assert.equal(new URL(worker.url()).host, id);
    await worker.evaluate(() => {
      globalThis.calls = []; globalThis.fail = false; globalThis.tabsCreated = 0;
      chrome.tabs.create = async () => { globalThis.tabsCreated++; throw new Error("No tabs during collection"); };
      globalThis.fetch = async (url, init) => {
        if (!url.endsWith("/functions/v1/sync-statistics")) throw new Error("Behaviour must only be contacted by the server");
        globalThis.calls.push(JSON.parse(init.body));
        return Response.json({ ok: !globalThis.fail, processed: 1 }, { status: globalThis.fail ? 503 : 200 });
      };
    });
    await context.route(APP_URL, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Build Analyzer test</title>" }));
    await context.route("https://stats.deadbydaylight.com/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Behaviour login test</title>" }));
    return worker;
  }
  let worker = await launch();
  const page = await context.newPage(); await page.goto(APP_URL);
  const send = request => page.evaluate(({ id, request }) => new Promise(resolve => chrome.runtime.sendMessage(id, request, resolve)), { id, request });
  assert.equal((await send({ type: "DBD_EXTENSION_STATUS" })).remoteSupported, true);
  assert.deepEqual(await send({ type: "DBD_EXTENSION_PAIR", pairing }), { ok: true, loginRequired: true });
  await context.addInitScript(session => { localStorage.setItem("auth-store", JSON.stringify({ state: session })); localStorage.setItem("providers-store", JSON.stringify({ state: { selectedProvider: "egs" } })); }, behaviourSession());
  await worker.evaluate(() => { globalThis.fail = true; });
  const login = await context.newPage(); await login.goto("https://stats.deadbydaylight.com/statistics/");
  async function waitFor(check) {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await worker.evaluate(check)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Extension operation timed out");
  }
  await waitFor(async () => (await chrome.storage.local.get("status")).status?.includes("indisponible"));
  assert.equal(await worker.evaluate(async () => Boolean((await chrome.storage.local.get("behaviourSession")).behaviourSession)), true, "A failed transfer retains the session for retry");
  await login.close(); await worker.evaluate(() => { globalThis.fail = false; });
  await send({ type: "DBD_EXTENSION_SYNC", userId: pairing.userId });
  await waitFor(async () => (await chrome.storage.local.get("pairing")).pairing?.cloudConnected === true);
  assert.equal(await worker.evaluate(async () => Boolean((await chrome.storage.local.get("behaviourSession")).behaviourSession)), false, "After registration credentials belong only to the encrypted server store");
  assert.equal(await worker.evaluate(async () => Boolean(await chrome.alarms.get("dbd-statistics-sync"))), false);
  assert.equal(await worker.evaluate(() => globalThis.tabsCreated), 0);
  assert.equal(context.pages().some(p => p.url().includes("stats.deadbydaylight.com")), false);
  await send({ type: "DBD_EXTENSION_SYNC", userId: pairing.userId });
  await waitFor(() => globalThis.calls.some(call => call.action === "sync"));
  const syncRequest = await worker.evaluate(() => globalThis.calls.find(call => call.action === "sync"));
  assert.equal(syncRequest.session, undefined);
  await context.close(); worker = await launch();
  const nextPage = await context.newPage(); await nextPage.goto(APP_URL);
  const status = await nextPage.evaluate(id => new Promise(resolve => chrome.runtime.sendMessage(id, { type: "DBD_EXTENSION_STATUS" }, resolve)), id);
  assert.equal(status.userId, pairing.userId);
  assert.equal(await worker.evaluate(async () => Boolean((await chrome.storage.local.get("behaviourSession")).behaviourSession)), false);
  await nextPage.evaluate(({ id, userId }) => new Promise(resolve => chrome.runtime.sendMessage(id, { type: "DBD_EXTENSION_DISCONNECT", userId }, resolve)), { id, userId: pairing.userId });
  assert.equal(await worker.evaluate(async () => Boolean((await chrome.storage.local.get("pairing")).pairing)), false);
  console.log("Extension checked: secure initial transfer, retry without data loss, credentials removed after registration, no local collector or opened tabs, server-only sync, restart and disconnection.");
} finally {
  await context?.close();
  if (!resolve(profile).startsWith(`${resolve(root)}\\.tmp-extension-browser-`) && !resolve(profile).startsWith(`${resolve(root)}/.tmp-extension-browser-`)) throw new Error("Unexpected browser profile path.");
  await rm(profile, { recursive: true, force: true });
}
