import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { APP_URL } from "../extension/config.mjs";
import { behaviourSession } from "../tests/fixtures/behaviour-api.mjs";

const root = process.cwd(), profile = await mkdtemp(join(root, ".tmp-extension-browser-"));
const extension = resolve(".tmp-statistics-extension"), id = "cljdeckobhfikpiecnpjlhmlbaeoalgh";
const channel = process.env.STATISTICS_BROWSER_CHANNEL ?? "chromium";
const pairing = { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", supabaseUrl: "https://test-project.supabase.co", publishableKey: "sb_publishable_test_1234567890", collectorToken: "a".repeat(64) };
let context, onboardingProfile;
try {
  async function launch() {
    context = await chromium.launchPersistentContext(profile, { channel, headless: true, args: ["--enable-unsafe-extension-debugging", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
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

  await context.close();
  onboardingProfile = await mkdtemp(join(root, ".tmp-extension-browser-"));
  context = await chromium.launchPersistentContext(onboardingProfile, { channel, headless: true, ignoreDefaultArgs: ["--disable-extensions"], args: ["--enable-unsafe-extension-debugging"] });
  // Also exercise installation through the content script when the page has no external messaging API.
  await context.addInitScript(() => {
    Object.defineProperty(globalThis, "chrome", { value: undefined, configurable: true });
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const fixture = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {StatisticsConnection} from './src/features/statistics/StatisticsConnection.tsx'; import {statisticsExtensionMessage} from './src/services/statistics-extension.ts'; window.testExtensionMessage=statisticsExtensionMessage; createRoot(document.getElementById('root')).render(React.createElement(StatisticsConnection));`, resolveDir: root, loader: "tsx" },
    bundle: true, write: false, format: "iife", jsx: "automatic", define: {
      "import.meta.env.BASE_URL": JSON.stringify(new URL(APP_URL).pathname),
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(pairing.supabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(pairing.publishableKey),
    }, plugins: [{ name: "isolated-account", setup(builder) {
      builder.onResolve({ filter: /app\/cloud\.js$/ }, () => ({ path: "test-cloud", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const supabase = window.testCloud;" }));
    } }],
  });
  const styles = await readFile(join(root, "src/features/account/account.css"), "utf8");
  const guideSource = await readFile(join(root, "extension-installation.html"), "utf8");
  const guideScript = guideSource.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const guideBundle = await build({
    stdin: { contents: guideScript, resolveDir: root, loader: "js" }, bundle: true, write: false, format: "iife",
    define: { __APP_BUILD_ID__: JSON.stringify("test-build") },
  });
  const guideHtml = guideSource.replace(/<script type="module">[\s\S]*?<\/script>/, () => `<script>${guideBundle.outputFiles[0].text}</script>`);
  const html = `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Build Analyzer — association</title><style>${styles}button{font:inherit;padding:.7rem 1rem;border-radius:.4rem;border:1px solid #626975;cursor:pointer}.primary-button{background:#e4b25b;color:#111}.secondary-button{background:transparent;color:#eee}a{color:#e4b25b}.error{color:#ef9a9a}</style><body style="background:#0b0c0e;color:#f3f4f6;font:18px/1.6 system-ui;padding:48px"><h1>DBD Build Analyzer</h1><input aria-label="Brouillon" value="Brouillon à conserver"><div id="root"></div><script>
    window.remote = false; window.createdCollectors = 0;
    window.testCloud = {auth:{getSession:async()=>({data:{session:{user:{id:${JSON.stringify(pairing.userId)}}}}})},rpc:async(name)=>{
      if(name==='statistics_collector_status') return {data:{remote:window.remote,state:window.remote?'success':'waiting_for_login'},error:null};
      if(name==='create_statistics_collector') {window.createdCollectors++;if(window.holdAssociation) await new Promise(resolve=>window.releaseAssociation=resolve);return {data:${JSON.stringify(pairing.collectorToken)},error:null};}
      if(name==='revoke_statistics_collector') {window.remote=false;return {data:null,error:null};}
      throw Error('Unexpected RPC');
    }};
  </script><script>${fixture.outputFiles[0].text}</script></body></html>`;
  await context.route(`${APP_URL}extension-store.json`, route => route.fulfill({ json: { chromeWebStoreUrl: null } }));
  await context.route("https://stats.deadbydaylight.com/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Behaviour login test</title>" }));
  await context.route(`${APP_URL}extension-installation.html*`, route => route.fulfill({ contentType: "text/html", body: guideHtml }));
  await context.route("https://account-backend.bhvr.com/**", route => route.fulfill({ body: "<!doctype html><title>Official login test</title>" }));
  await context.route(APP_URL, route => route.fulfill({ contentType: "text/html", body: html }));
  const app = await context.newPage(); await app.goto(APP_URL);
  const install = app.getByRole("button", { name: "Installer l’extension et connecter Behaviour" });
  await install.waitFor();
  assert.equal(await app.getByRole("button", { name: "Désactiver la synchronisation", exact: true }).count(), 0);
  await app.evaluate(() => { window.remote = true; window.dispatchEvent(new Event("focus")); });
  await app.getByRole("button", { name: "Désactiver la synchronisation", exact: true }).waitFor();
  assert.equal(await app.getByRole("button", { name: "Reconnecter Behaviour" }).count(), 0);
  assert.equal(await install.count(), 0, "An account already synchronized on the server does not need to install the extension again");
  await app.evaluate(() => { window.remote = false; window.dispatchEvent(new Event("focus")); });
  await install.waitFor();
  assert.equal(await app.getByRole("button", { name: "Désactiver la synchronisation", exact: true }).count(), 0);
  await app.setViewportSize({ width: 1280, height: 800 });
  await app.getByLabel("Brouillon").evaluate(input => { input.style.visibility = "hidden"; });
  await app.screenshot({ path: join(root, ".tmp-extension-store-installation.png") });
  await app.getByLabel("Brouillon").evaluate(input => { input.style.visibility = "visible"; });
  await app.getByLabel("Brouillon").fill("Changements conservés pendant l’installation");
  const guideOpened = context.waitForEvent("page");
  await install.click();
  const guide = await guideOpened;
  await guide.waitForLoadState("domcontentloaded");
  await guide.goto(`${APP_URL}extension-installation.html?diagnostic=1`);
  await guide.getByText(/Résultat : Extension non détectée/).waitFor();
  const diagnostic = await guide.locator("#diagnostic-result").textContent();
  assert.ok(diagnostic.includes("test-build") && diagnostic.includes("API de communication Chrome"));
  assert.ok(!diagnostic.includes(pairing.collectorToken) && !diagnostic.includes(pairing.userId), "The diagnostic contains no account or collector credentials");
  const pagesBeforeRetry = context.pages().length;
  await app.getByRole("button", { name: "Vérifier l’extension installée", exact: true }).click();
  await app.getByRole("alert").waitFor();
  assert.ok((await app.getByRole("alert").textContent()).includes("API de communication Chrome"));
  assert.equal(context.pages().length, pagesBeforeRetry, "Retrying detection must not reopen installation");
  assert.equal(await app.evaluate(() => window.createdCollectors), 0, "Installation must not create an unpaired collector");
  let navigations = 0; app.on("framenavigated", frame => { if (frame === app.mainFrame()) navigations++; });
  await app.evaluate(() => { window.holdAssociation = true; });
  const installedEvent = context.waitForEvent("serviceworker");
  await cdp.send("Extensions.loadUnpacked", { path: extension });
  worker = await installedEvent;
  await worker.evaluate(() => {
    globalThis.calls = [];
    globalThis.fetch = async (_url, init) => { globalThis.calls.push(JSON.parse(init.body)); return Response.json({ ok: true, processed: 1 }); };
    globalThis.pendingTabs = []; globalThis.tabReady = {};
    const create = chrome.tabs.create.bind(chrome.tabs);
    chrome.tabs.create = async options => {
      const marker = `about:blank#dbd-test-${crypto.randomUUID()}`;
      const tab = await create({ ...options, url: marker });
      const navigation = new Promise(resolve => { globalThis.tabReady[tab.id] = resolve; });
      globalThis.pendingTabs.push({ id: tab.id, url: options.url, marker });
      await navigation;
      return chrome.tabs.get(tab.id);
    };
  });
  // Chrome-created tabs can navigate before Playwright attaches; defer navigation so every request stays mocked.
  const navigationErrors = [];
  context.on("page", opened => { void (async () => {
    let target;
    for (let attempt = 0; attempt < 50 && !target; attempt++) {
      target = await worker.evaluate(marker => {
        const index = globalThis.pendingTabs.findIndex(tab => tab.marker === marker);
        return index < 0 ? null : globalThis.pendingTabs.splice(index, 1)[0];
      }, opened.url());
      if (!target) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(target, "Expected an extension-created tab");
    await opened.goto(target.url);
    await worker.evaluate(id => { globalThis.tabReady[id](); delete globalThis.tabReady[id]; }, target.id);
  })().catch(error => navigationErrors.push(error)); });
  await app.evaluate(() => { window.holdAssociation = false; window.releaseAssociation?.(); });
  try { await app.getByRole("button", { name: "Rouvrir la connexion Behaviour" }).waitFor(); }
  catch (error) {
    console.log("Setup diagnostics", { errors: await app.getByRole("alert").allTextContents(), navigationErrors: navigationErrors.map(error => error.message), pages: context.pages().map(page => page.url().split("?")[0]) });
    throw error;
  }
  assert.equal(navigations, 0, "Installing the extension must not reload the application");
  assert.equal(await app.getByLabel("Brouillon").inputValue(), "Changements conservés pendant l’installation");
  assert.equal(await app.evaluate(() => window.createdCollectors), 1, "Association resumes automatically, exactly once");
  let authorizationPage;
  for (let attempt = 0; attempt < 80 && !authorizationPage; attempt++) {
    authorizationPage = context.pages().find(p => p.url().startsWith("https://account-backend.bhvr.com/"));
    if (!authorizationPage) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(authorizationPage, "The official sign-in opens automatically, without clicking Sign in");
  const authorizeUrl = new URL(authorizationPage.url());
  assert.equal(authorizeUrl.searchParams.get("redirect_uri"), "https://stats.deadbydaylight.com");
  assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
  assert.match(authorizeUrl.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  const statsPage = context.pages().find(p => p.url().startsWith("https://stats.deadbydaylight.com/"));
  assert.ok(statsPage);
  const verifier = await statsPage.evaluate(() => JSON.parse(localStorage.getItem("auth-store")).state.authCodeVerifier);
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(createHash("sha256").update(verifier).digest("base64url"), authorizeUrl.searchParams.get("code_challenge"));
  const count = context.pages().length;
  await app.getByRole("button", { name: "Rouvrir la connexion Behaviour" }).click();
  assert.equal(context.pages().length, count, "Reopening sign-in must not duplicate its tabs");
  await statsPage.evaluate(session => { localStorage.setItem("auth-store", JSON.stringify({ state: session })); window.dispatchEvent(new StorageEvent("storage", { key: "auth-store" })); }, behaviourSession());
  await waitFor(async () => (await chrome.storage.local.get("pairing")).pairing?.cloudConnected === true);
  assert.equal(await app.getByText("✓ Synchronisation distante active.").count(), 0, "The UI waits for the server confirmation");
  await app.evaluate(() => { window.remote = true; });
  await app.getByText("✓ Synchronisation distante active.").waitFor();
  await app.getByLabel("Brouillon").evaluate(input => { input.style.visibility = "hidden"; });
  await app.screenshot({ path: join(root, ".tmp-extension-store-connected.png") });
  if (!statsPage.isClosed()) await statsPage.waitForEvent("close", { timeout: 10_000 });
  assert.equal(context.pages().some(p => p.url().startsWith("https://stats.deadbydaylight.com/")), false, "Only the extension's own statistics tab is closed after transfer");
  assert.equal(await app.evaluate(() => sessionStorage.getItem("dbd-statistics-setup")), null);
  const connectedPages = context.pages().length;
  const lateLogin = await app.evaluate(userId => window.testExtensionMessage({ type: "DBD_EXTENSION_LOGIN", userId }), pairing.userId);
  assert.equal(lateLogin.loginRequired, false, "A late login request after successful transfer must not restart authorization");
  assert.equal(context.pages().length, connectedPages);
  assert.equal(navigations, 0);
  assert.deepEqual(navigationErrors, []);
  console.log("Onboarding checked: live installation without reloading or losing drafts, automatic association and PKCE login, no duplicate tabs, server confirmation required.");
  console.log("Extension checked: secure initial transfer, retry without data loss, credentials removed after registration, no local collector or opened tabs, server-only sync, restart and disconnection.");
} finally {
  await context?.close();
  for (const path of [profile, onboardingProfile].filter(Boolean)) {
    if (!resolve(path).startsWith(`${resolve(root)}\\.tmp-extension-browser-`) && !resolve(path).startsWith(`${resolve(root)}/.tmp-extension-browser-`)) throw new Error("Unexpected browser profile path.");
    await rm(path, { recursive: true, force: true });
  }
}
