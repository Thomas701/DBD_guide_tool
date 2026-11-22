import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";
import { mapBehaviourMatches } from "../extension/behaviour-api.mjs";
import { behaviourHistory } from "../tests/fixtures/behaviour-api.mjs";

process.env.VITE_HOSTED_APP = "true";
process.env.VITE_EMAIL_AUTH_ENABLED = "true";
process.env.VITE_SUPABASE_URL = "https://dbd-test.supabase.co";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_browser_key";
const users = {
  alice: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "alice@example.test" },
  bob: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "bob@example.test" },
};
const workspaces = new Map();
const match = (await mapBehaviourMatches(behaviourHistory))[0];
const updatedAt = new Date().toISOString();
let refreshes = 0;
let offline = false;
const server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false }, logLevel: "error" });
let browser;
function session(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp: now + 3600, iat: now };
  return { access_token: `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.test-signature`, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: `refresh-${user.id}`, user: { ...user, aud: "authenticated", role: "authenticated", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} } };
}
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.audioTracks = [];
    window.Audio = new Proxy(window.Audio, { construct(Target, args) {
      const audio = new Target(...args); window.audioTracks.push(audio); return audio;
    } });
    HTMLMediaElement.prototype.play = async function () { this.dataset.plays = String(Number(this.dataset.plays ?? 0) + 1); };
  });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://dbd-test.supabase.co/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataJSON();
    const token = request.headers().authorization?.split(" ")[1];
    const payload = token?.split(".")[1];
    const userId = payload ? JSON.parse(Buffer.from(payload, "base64url")).sub : null;
    const reply = (data, status = 200) => route.fulfill({ status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" }, body: JSON.stringify(data) });
    if (request.method() === "OPTIONS") return reply({});
    if (url.pathname === "/rest/v1/rpc/is_admin") return reply(userId === users.alice.id);
    if (url.pathname === "/auth/v1/token") {
      let user;
      if (url.searchParams.get("grant_type") === "refresh_token") { refreshes++; user = Object.values(users).find(user => `refresh-${user.id}` === body.refresh_token); }
      else user = Object.values(users).find(user => user.email === body.email);
      return user ? reply(session(user)) : reply({ message: "Invalid credentials" }, 400);
    }
    if (url.pathname === "/auth/v1/logout") return reply({});
    if (url.pathname === "/auth/v1/user") return reply(Object.values(users).find(user => user.id === userId));
    if (url.pathname === "/rest/v1/user_workspaces") {
      assert.equal(url.searchParams.get("user_id"), `eq.${userId}`);
      return reply(workspaces.has(userId) ? [workspaces.get(userId)] : []);
    }
    if (url.pathname === "/rest/v1/rpc/save_workspace") {
      if (offline) return route.abort("internetdisconnected");
      const current = workspaces.get(userId) ?? { revision: 0 };
      if (current.revision !== body.expected_revision) return reply({ code: "40001", message: "Workspace changed" }, 409);
      workspaces.set(userId, { data: body.workspace_data, revision: current.revision + 1 });
      return reply(current.revision + 1);
    }
    if (url.pathname === "/rest/v1/rpc/statistics_collector_status") return reply({ connected: false, state: "waiting_for_login", message: "Connectez l’extension.", lastSeenAt: null });
    if (url.pathname === "/rest/v1/player_statistics") return reply([{ overview: null, updated_at: updatedAt, imported_count: 1, fetched_count: 1 }]);
    if (url.pathname === "/rest/v1/player_matches") return reply([{ match_id: match.id, entry: match, deleted: false }]);
    throw new Error(`Unexpected mocked endpoint: ${url.pathname}`);
  });
  async function signIn(user) {
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Mot de passe", { exact: true }).fill("Test-password-123");
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    await page.locator(".account-toolbar").getByText(user.email, { exact: true }).waitFor();
    await page.locator(".analyzer-topbar").waitFor();
    const admin = user.id === users.alice.id;
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    assert.equal(await nav.getByRole("button", { name: "Administration", exact: true }).count(), admin ? 1 : 0);
    if (admin) {
      await nav.getByRole("button", { name: "Administration", exact: true }).click();
      assert.equal(await page.getByRole("main", { name: "Administration", exact: true }).locator(":scope > *").count(), 0);
    }
    await nav.getByRole("button", { name: "Perks", exact: true }).click();
    await page.locator('.perk-card[data-perk-id="agitation"] .perk-card-details').click();
    const inspector = page.getByRole("region", { name: "Détails de la perk", exact: true });
    await inspector.waitFor();
    assert.equal(await inspector.getByRole("button", { name: "Modifier la description", exact: true }).count(), admin ? 1 : 0);
    assert.equal(await inspector.getByRole("button", { name: "Modifier les catégories", exact: true }).count(), admin ? 1 : 0);
    await nav.getByRole("button", { name: "Statistique", exact: true }).click();
    await page.getByRole("tab", { name: /^Historique/ }).click();
    await page.locator(".statistics-match-card").waitFor();
    assert.equal(await page.getByTitle("Modifier la partie", { exact: true }).count(), admin ? 1 : 0);
    assert.equal(await page.getByTitle("Supprimer la partie", { exact: true }).count(), admin ? 1 : 0);
    await nav.getByRole("button", { name: "Build", exact: true }).click();
    await page.locator(".analyzer-workspace.view-build").waitFor();
    await page.getByRole("status").filter({ hasText: "Données synchronisées" }).waitFor();
  }
  async function saveBuild(name) {
    await page.evaluate(async name => {
      const { appStorage } = await import("/src/services/account-storage.ts");
      const { LocalBuildRepository } = await import("/src/services/build-repository.ts");
      new LocalBuildRepository(appStorage).create({ name, killerId: "trapper", side: "killer", perkIds: [] });
      window.dispatchEvent(new StorageEvent("storage", { key: "dbd-build-tool.builds" }));
    }, name);
  }
  async function waitForSaved(userId, name) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !workspaces.get(userId)?.data["dbd-build-tool.builds"]?.includes(name)) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(workspaces.get(userId)?.data["dbd-build-tool.builds"]?.includes(name));
  }
  await page.goto(origin);
  await signIn(users.alice);
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await nav.getByRole("button", { name: "Killers", exact: true }).click();
  await page.locator(".killer-card").filter({ hasText: "The Doctor" }).click();
  await page.waitForFunction(() => window.audioTracks.some(audio => audio.dataset.plays && /doctor.*Theme_Music/i.test(audio.src)));
  assert.equal(await page.evaluate(() => window.audioTracks.find(audio => /doctor.*Theme_Music/i.test(audio.src)).loop), true);
  assert.equal(await page.evaluate(() => window.audioTracks.find(audio => /doctor.*Theme_Music/i.test(audio.src)).onended), null);
  await saveBuild("Build Alice");
  await waitForSaved(users.alice.id, "Build Alice");
  await page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
  await signIn(users.bob);
  assert.equal(await page.evaluate(async () => (await import("/src/services/account-storage.ts")).appStorage.getItem("dbd-build-tool.builds")), null);
  await saveBuild("Build Bob");
  await waitForSaved(users.bob.id, "Build Bob");
  await page.getByRole("status").filter({ hasText: "Données synchronisées" }).waitFor();
  const bobWorkspace = workspaces.get(users.bob.id);
  bobWorkspace.data["dbd-build-tool.current-session"] = JSON.stringify({ ...JSON.parse(bobWorkspace.data["dbd-build-tool.current-session"]), activeView: "administration" });
  await page.reload();
  await page.locator(".analyzer-topbar").waitFor();
  assert.equal(await page.getByRole("main", { name: "Administration", exact: true }).count(), 0, "A forged saved view must not open administration");
  await page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
  await signIn(users.alice);
  assert.ok((await page.evaluate(async () => (await import("/src/services/account-storage.ts")).appStorage.getItem("dbd-build-tool.builds"))).includes("Build Alice"));

  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith("sb-") && key.endsWith("-auth-token"));
    const saved = JSON.parse(localStorage.getItem(key)); saved.expires_at = Math.floor(Date.now() / 1000) - 60;
    const pieces = saved.access_token.split(".");
    const payload = JSON.parse(atob(pieces[1].replaceAll("-", "+").replaceAll("_", "/"))); payload.exp = saved.expires_at;
    pieces[1] = btoa(JSON.stringify(payload)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    saved.access_token = pieces.join("."); localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await page.locator(".analyzer-topbar").waitFor();
  assert.ok(refreshes > 0, "An expired session must refresh without asking for the password again.");

  offline = true;
  await saveBuild("Build hors ligne");
  await page.getByRole("alert").filter({ hasText: "Sauvegarde impossible" }).waitFor();
  for (const [width, height] of [[2537, 1000], [1366, 640], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    for (const view of ["Killers", "Perks"]) {
      await nav.getByRole("button", { name: view, exact: true }).click();
      await page.locator(`.analyzer-workspace.view-${view === "Killers" ? "killers" : "perks"}`).waitFor();
      await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {}))));
      const bounds = await page.locator(".analyzer-workspace").boundingBox();
      assert.ok(bounds.y + bounds.height <= height + 1, `${view} must fit below the account toolbar and error banner at ${width}x${height}`);
      const panel = page.locator(".workspace-catalog-panel");
      await panel.evaluate(element => { element.scrollTop = element.scrollHeight; });
      const card = page.locator(view === "Killers" ? ".killer-card" : ".perk-card").last();
      const [cardBounds, panelBounds] = await Promise.all([card.boundingBox(), panel.boundingBox()]);
      assert.ok(cardBounds.y + cardBounds.height <= panelBounds.y + panelBounds.height + 1, "The last card must be reachable without clipping");
    }
  }
  offline = false;
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await waitForSaved(users.alice.id, "Build hors ligne");
  assert.deepEqual(errors, []);
  console.log("Cloud browser checks passed: account isolation, admin permissions, empty administration, looping killer theme, viewport sizing with an error banner, persistence, session refresh and network recovery.");
} finally {
  await browser?.close();
  await server.close();
}
