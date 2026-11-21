import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

process.env.VITE_HOSTED_APP = "true";
process.env.VITE_EMAIL_AUTH_ENABLED = "true";
process.env.VITE_SUPABASE_URL = "https://dbd-test.supabase.co";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_browser_key";
const users = {
  alice: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "alice@example.test" },
  bob: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "bob@example.test" },
};
const workspaces = new Map();
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
    if (["/rest/v1/player_statistics", "/rest/v1/player_matches"].includes(url.pathname)) return reply([]);
    throw new Error(`Unexpected mocked endpoint: ${url.pathname}`);
  });
  async function signIn(user) {
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Mot de passe", { exact: true }).fill("Test-password-123");
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    await page.locator(".account-toolbar").getByText(user.email, { exact: true }).waitFor();
    await page.locator(".analyzer-topbar").waitFor();
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
  await saveBuild("Build Alice");
  await waitForSaved(users.alice.id, "Build Alice");
  await page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
  await signIn(users.bob);
  assert.equal(await page.evaluate(async () => (await import("/src/services/account-storage.ts")).appStorage.getItem("dbd-build-tool.builds")), null);
  await saveBuild("Build Bob");
  await waitForSaved(users.bob.id, "Build Bob");
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
  offline = false;
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await waitForSaved(users.alice.id, "Build hors ligne");
  assert.deepEqual(errors, []);
  console.log("Cloud browser checks passed: account isolation, cloud persistence, automatic session refresh and recovery after a network failure.");
} finally {
  await browser?.close();
  await server.close();
}
