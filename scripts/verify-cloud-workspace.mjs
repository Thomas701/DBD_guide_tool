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
const killerMatch = { ...match, id: "2".repeat(40), role: "killer", characterName: "The Trapper", score: 17123, participants: [
  { name: "Jake Park", role: "survivor", score: 10000, resultLabel: "Escaped", imageUrl: null },
  { name: "Kate Denson", role: "survivor", score: 8000, resultLabel: null, imageUrl: null },
  ...match.participants.filter(player => player.role === "survivor"),
] };
const profiles = new Map(Object.values(users).map(user => [user.id, `Joueur ${user.id.slice(0, 8)}`]));
const sharedDescriptions = new Map();
const sharedNames = new Map();
const consultants = new Set();
const mmrAdjustments = new Map();
let previewRequests = 0;
const leaderboardRequests = [];
let leaderboardUnavailable = false;
const rankedPlayers = Array.from({ length: 51 }, (_, index) => ({ rank: index + 1, user_id: index === 0 ? users.bob.id : `player-${index}`, nickname: `Joueur ${index + 1}`, mmr: 900 - index * 9, wins: 60 - index, losses: index }));
const updatedAt = new Date().toISOString();
let refreshes = 0;
let offline = false;
let bobNeedsPlatform = false;
const server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false }, logLevel: "error" });
let browser;
let page;
function session(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp: now + 3600, iat: now };
  return { access_token: `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.test-signature`, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: `refresh-${user.id}`, user: { ...user, aud: "authenticated", role: "authenticated", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} } };
}
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
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
    if (url.pathname === "/rest/v1/rpc/is_admin") return reply(userId === users.alice.id || consultants.has(userId));
    if (url.pathname === "/rest/v1/rpc/can_manage_accounts") return reply(userId === users.alice.id);
    if (url.pathname === "/rest/v1/rpc/player_match_accounts") return reply([{ matchId: match.id, player: { user_id: users.bob.id, nickname: "Bob Behaviour" }, participants: [{ index: 0, player: { user_id: users.alice.id, nickname: "Alice Behaviour" } }] }]);
    if (url.pathname === "/rest/v1/rpc/player_statistics_page") {
      assert.ok(Object.values(users).some(user => user.id === body.target_user));
      return reply({ nickname: body.target_user === users.bob.id ? "Bob Behaviour" : "Alice Behaviour", updatedAt, statistics: null, matchHistory: [match, killerMatch], nextCursor: null, importedCount: 2, fetchedCount: 2, mmrAdjustments: mmrAdjustments.get(body.target_user) });
    }
    if (url.pathname === "/rest/v1/rpc/admin_set_player_mmr") {
      assert.equal(userId, users.alice.id);
      assert.deepEqual(body, { target_user: users.bob.id, selected_mode: "1v4-survivor", selected_killer: "", rating: 825 });
      const adjustments = { "1v4-survivor": { matchId: match.id, at: match.playedAt, rating: body.rating } };
      mmrAdjustments.set(body.target_user, adjustments);
      return reply(adjustments);
    }
    if (url.pathname === "/rest/v1/rpc/admin_promote_consultant") {
      assert.equal(userId, users.alice.id); consultants.add(body.target_user); return reply(null);
    }
    if (url.pathname === "/rest/v1/player_profiles") {
      assert.equal(url.searchParams.get("user_id"), `eq.${userId}`);
      assert.equal(request.method(), "GET");
      return reply([{ nickname: profiles.get(userId) }]);
    }
    if (url.pathname === "/rest/v1/shared_perk_descriptions") return reply([...sharedDescriptions].map(([perk_id, description_html]) => ({ perk_id, description_html })));
    if (url.pathname === "/rest/v1/shared_perk_names") return reply([...sharedNames].map(([perk_id, name_fr]) => ({ perk_id, name_fr })));
    if (url.pathname === "/rest/v1/rpc/save_shared_perk_name") {
      assert.ok(userId === users.alice.id || consultants.has(userId));
      if (body.new_name === null) sharedNames.delete(body.target_perk);
      else sharedNames.set(body.target_perk, body.new_name);
      return reply(null);
    }
    if (url.pathname === "/rest/v1/rpc/save_shared_perk_description") {
      assert.equal(userId, users.alice.id);
      sharedDescriptions.set(body.target_perk, body.html);
      return reply(null);
    }
    if (url.pathname === "/rest/v1/rpc/admin_users") {
      assert.ok(userId === users.alice.id || consultants.has(userId));
      return reply({ total: 2, users: Object.values(users).map(user => ({ ...user, created_at: updatedAt, last_sign_in_at: null, administrator: user.id === users.alice.id, consultant: consultants.has(user.id), behaviour_synced: user.id === users.bob.id })) });
    }
    if (url.pathname === "/rest/v1/rpc/admin_user_workspace") {
      previewRequests++;
      assert.equal(userId, users.alice.id);
      return reply(Object.fromEntries(Object.entries(workspaces.get(body.target_user)?.data ?? {}).filter(([key]) => !key.includes("assistant"))));
    }
    if (url.pathname === "/rest/v1/rpc/admin_statistics_status") {
      assert.equal(userId, users.alice.id);
      assert.equal(body.target_user, users.bob.id);
      return reply({ state: "success", message: "Statistiques de Bob", lastSeenAt: updatedAt });
    }
    if (url.pathname === "/rest/v1/rpc/player_leaderboard") {
      leaderboardRequests.push(body);
      if (leaderboardUnavailable) return reply({ message: "Classement temporairement indisponible" }, 503);
      const players = body.selected_mode.endsWith("-killer") && !body.selected_killer ? [] : rankedPlayers;
      return reply({ total: players.length, players: players.slice(body.page_index * 50, (body.page_index + 1) * 50), killers: body.selected_mode.endsWith("-killer") ? ["The Trapper"] : [] });
    }
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
    if (url.pathname === "/rest/v1/rpc/statistics_collector_status") return reply(userId === users.bob.id
      ? { remote: true, state: bobNeedsPlatform ? "error" : "success", lastSeenAt: updatedAt,
          message: bobNeedsPlatform ? "Behaviour ne trouve aucune plateforme Dead by Daylight pour ce compte." : null }
      : { remote: false, state: "waiting_for_login", lastSeenAt: null });
    if (url.pathname === "/rest/v1/player_statistics" || url.pathname === "/rest/v1/player_matches") {
      assert.ok(url.searchParams.get("user_id") === `eq.${userId}` || userId === users.alice.id);
      if (url.pathname.endsWith("player_statistics")) return reply([{ overview: null, updated_at: updatedAt, imported_count: 2, fetched_count: 2, mmr_adjustments: mmrAdjustments.get(url.searchParams.get("user_id").slice(3)) }]);
      return reply([match, killerMatch].map(entry => ({ match_id: entry.id, entry, deleted: false })));
    }
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
      const administration = page.getByRole("main", { name: "Administration", exact: true });
      await administration.getByText(users.bob.email, { exact: true }).waitFor();
      assert.equal(await administration.locator("tbody tr").count(), 2);
      assert.equal(await administration.getByRole("columnheader").count(), 7);
      await administration.getByRole("row").filter({ hasText: users.bob.email }).getByRole("button", { name: "Modifier le MMR" }).click();
      const mmrDialog = page.getByRole("dialog", { name: "Statistiques de Bob Behaviour" });
      await mmrDialog.getByLabel("MMR après le dernier match").fill("825");
      await mmrDialog.getByRole("button", { name: "Enregistrer le MMR" }).click();
      await mmrDialog.getByRole("status").filter({ hasText: "MMR enregistré." }).waitFor();
      await mmrDialog.locator(".statistics-mmr-current strong").filter({ hasText: /^825$/ }).waitFor();
      await mmrDialog.getByRole("button", { name: "Fermer les statistiques du joueur" }).click();
    }
    await nav.getByRole("button", { name: "Perks", exact: true }).click();
    await page.locator('.perk-card[data-perk-id="agitation"] .perk-card-details').click();
    const inspector = page.getByRole("region", { name: "Détails de la perk", exact: true });
    await inspector.waitFor();
    assert.equal(await inspector.getByRole("button", { name: "Modifier le nom", exact: true }).count(), admin ? 1 : 0);
    assert.equal(await inspector.getByRole("button", { name: "Modifier la description", exact: true }).count(), admin ? 1 : 0);
    assert.equal(await inspector.getByRole("button", { name: "Modifier les catégories", exact: true }).count(), admin ? 1 : 0);
    await nav.getByRole("button", { name: "Statistique", exact: true }).click();
    await page.locator(".statistics-header h1").waitFor();
    assert.equal(await page.getByRole("button", { name: "Synchroniser", exact: true }).count(), admin ? 1 : 0);
    await page.getByRole("tab", { name: /^Historique/ }).click();
    await page.locator(".statistics-match-card").first().waitFor();
    await page.locator(".statistics-participant-status").getByText("Résultat inconnu", { exact: true }).waitFor();
    assert.equal(await page.getByTitle("Modifier la partie", { exact: true }).count(), admin ? 2 : 0);
    assert.equal(await page.getByTitle("Supprimer la partie", { exact: true }).count(), admin ? 2 : 0);
    if (!admin && mmrAdjustments.has(user.id)) {
      await page.getByRole("tab", { name: "MMR", exact: true }).click();
      await page.locator(".statistics-mmr-current strong").filter({ hasText: /^825$/ }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Enregistrer le MMR" }).count(), 0);
    }
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
  await nav.getByRole("button", { name: "Perks", exact: true }).click();
  await page.locator('.perk-card[data-perk-id="agitation"] .perk-card-details').click();
  const inspector = page.getByRole("region", { name: "Détails de la perk", exact: true });
  await inspector.getByRole("button", { name: "Modifier la description", exact: true }).click();
  await inspector.locator("[contenteditable=true]").fill("Description commune de test");
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/rpc/save_shared_perk_description")),
    inspector.getByRole("button", { name: "Enregistrer", exact: true }).click(),
  ]);
  await inspector.locator("[contenteditable=true]").waitFor({ state: "hidden" });
  await inspector.getByText("Description commune de test", { exact: true }).waitFor();
  assert.match(sharedDescriptions.get("agitation"), /Description commune de test/);
  await inspector.getByRole("button", { name: "Modifier le nom", exact: true }).click();
  await inspector.getByLabel("Nom français").fill("Agitation renommée");
  await inspector.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await inspector.getByRole("heading", { name: "Agitation renommée", exact: true }).waitFor();
  assert.equal(sharedNames.get("agitation"), "Agitation renommée");

  await nav.getByRole("button", { name: "Tiers List", exact: true }).click();
  await page.getByRole("button", { name: "Détails de le piégeur", exact: true }).click();
  await page.getByLabel("Tier de la sélection", { exact: true }).selectOption("unranked");
  await page.locator('.tier-list-row[data-tier="unranked"] .tier-list-killer').waitFor();
  await page.reload();
  await page.locator('.tier-list-row[data-tier="unranked"] .tier-list-killer').waitFor();
  await page.getByRole("button", { name: "Perk killer", exact: true }).click();
  await page.getByRole("button", { name: "Détails de Agitation renommée", exact: true }).click();
  await page.getByLabel("Tier de la sélection", { exact: true }).selectOption("unranked");
  await page.locator('.tier-list-row[data-tier="unranked"] .tier-list-perk').waitFor();
  await page.getByRole("button", { name: "Perk survivor", exact: true }).click();
  await page.locator(".tier-list-perk button").first().click();
  await page.getByLabel("Tier de la sélection", { exact: true }).selectOption("unranked");
  await page.locator('.tier-list-row[data-tier="unranked"] .tier-list-perk').waitFor();
  await page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
  await signIn(users.bob);
  assert.equal(await page.evaluate(async () => (await import("/src/services/account-storage.ts")).appStorage.getItem("dbd-build-tool.builds")), null);
  await saveBuild("Build Bob");
  await waitForSaved(users.bob.id, "Build Bob");
  profiles.set(users.bob.id, "Bob Behaviour");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByText("Pseudo Behaviour : Bob Behaviour", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Enregistrer le pseudo", exact: true }).count(), 0);
  await nav.getByRole("button", { name: "Perks", exact: true }).click();
  await page.locator('.perk-card[data-perk-id="agitation"] .perk-card-details').click();
  await inspector.getByText("Description commune de test", { exact: true }).waitFor();
  await inspector.getByRole("heading", { name: "Agitation renommée", exact: true }).waitFor();
  await nav.getByRole("button", { name: "Tiers List", exact: true }).click();
  assert.equal(await page.locator('.tier-list-row[data-tier="unranked"] .tier-list-killer').count(), 0, "Bob must keep his own tier list");

  await nav.getByRole("button", { name: "Statistique", exact: true }).click();
  await page.locator(".statistics-player-banner").getByText("Bob Behaviour", { exact: true }).waitFor();
  await page.locator(".statistics-player-banner img").waitFor();
  await page.locator(".statistics-connection-linked").getByRole("button", { name: "Désactiver la synchronisation", exact: true }).waitFor();
  bobNeedsPlatform = true;
  const behaviourLink = page.getByRole("link", { name: "Ouvrir mon compte Behaviour" });
  await behaviourLink.waitFor();
  assert.equal(await behaviourLink.getAttribute("href"), "https://account.bhvr.com/");
  bobNeedsPlatform = false;
  await behaviourLink.waitFor({ state: "hidden" });
  assert.equal(await page.locator(".statistics-header .eyebrow, .statistics-chip").count(), 0);
  assert.equal(await page.locator(".statistics-tabs-row .impact-tabs").evaluate(tabs => getComputedStyle(tabs).borderTopWidth), "0px");
  const overview = page.locator(".sd-filter-top");
  assert.equal(await page.locator(".sd-filter-scope, .sd-filter-caption, .sd-kicker, .sd-hero-meta").count(), 0);
  await page.locator(".sd-hero-copy").getByRole("heading", { name: "Vos parties, en perspective", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".sd-hero .sd-kpis .sd-kpi svg").length === 4);
  assert.ok(await page.locator(".sd-hero .sd-kpis").evaluate(kpis => {
    const [first, second] = kpis.children;
    return kpis.getBoundingClientRect().top === kpis.previousElementSibling.getBoundingClientRect().bottom
      && second.getBoundingClientRect().left - first.getBoundingClientRect().right === 12;
  }), "KPI cards are flush with the summary and retain their horizontal gap");
  assert.ok(await overview.evaluate(row => {
    const camps = row.querySelector(".sd-segments").getBoundingClientRect();
    const range = row.querySelector(".sd-range").getBoundingClientRect();
    return range.left - camps.right === 12 && Math.abs(range.top - camps.top) < 1;
  }), "The range is next to the camp filter");

  async function checkFilterDock(scope, scroller) {
    const dock = scope.locator(".sd-filter-dock");
    const bar = dock.locator(".sd-filterbar");
    for (const fraction of [0.45, 0.95]) {
      await scroller.evaluate((element, position) => {
        element.scrollTop = (element.scrollHeight - element.clientHeight) * position;
      }, fraction);
      await scope.locator(".sd-filter-dock[data-hidden]").waitFor();
      assert.equal(await bar.evaluate(element => getComputedStyle(element).pointerEvents), "none");
      if (fraction === 0.45) {
        const point = await dock.evaluate(element => {
          const bounds = element.getBoundingClientRect();
          const button = document.createElement("button");
          button.type = "button";
          button.className = "sd-click-probe";
          button.textContent = "Vérifier le clic";
          button.style.cssText = `position:fixed;z-index:1;left:${bounds.left + 30}px;top:${bounds.top + 18}px;`;
          button.addEventListener("click", () => { button.dataset.clicked = "true"; });
          element.after(button);
          const rect = button.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        });
        await page.mouse.click(point.x, point.y);
        const button = scope.locator(".sd-click-probe");
        assert.equal(await button.getAttribute("data-clicked"), "true", "The hidden filter dock must let clicks reach the page below");
        await button.evaluate(element => element.remove());
      }
      await scroller.evaluate(element => { element.scrollTop -= 26; });
      await scope.locator(".sd-filter-dock:not([data-hidden])").waitFor();
      assert.ok(await bar.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const dialog = element.closest("dialog");
        const top = dialog ? dialog.getBoundingClientRect().top + dialog.clientTop + parseFloat(getComputedStyle(dialog).paddingTop)
          : element.closest(".app-shell").querySelector(".analyzer-topbar").getBoundingClientRect().bottom;
        return bounds.top >= top - 9 && bounds.top <= top + 2 && bounds.bottom <= innerHeight;
      }), "Scrolling up reveals filters at the top of the scrolling area");
    }
    await scroller.evaluate(element => { element.scrollTop = 0; });
  }
  await checkFilterDock(page, page.locator(".app-shell"));
  await page.setViewportSize({ width: 390, height: 720 });
  await checkFilterDock(page, page.locator("html"));
  await page.setViewportSize({ width: 1280, height: 720 });
  const results = page.locator(".sd-results-grid");
  const streaks = page.locator(".sd-streak-camps");
  const campPanels = page.locator(".sd-camp-panels");
  const scores = campPanels.getByRole("table", { name: "Scores par camp" });
  const scoreRow = scores.getByRole("row", { name: /^Score moyen par partie/ });
  assert.deepEqual(await scoreRow.getByRole("cell").allTextContents(), [match.score, killerMatch.score].map(value => new Intl.NumberFormat("fr-FR").format(value)));
  assert.ok(await campPanels.evaluate(row => {
    const panels = [...row.children].map(child => child.getBoundingClientRect());
    return panels.length === 3 && panels.every(panel => Math.abs(panel.top - panels[0].top) < 1);
  }), "Score, survival and kills occupy the same row on desktop");
  assert.equal(await results.locator(".sd-stat-pair").count(), 0);
  assert.ok(await results.locator(".sd-result-stats .sd-metric").evaluateAll(rows => rows.length === 12 && rows.every(row => {
    const [label, value] = row.children;
    return label.getBoundingClientRect().right <= value.getBoundingClientRect().left
      && Math.abs(label.getBoundingClientRect().top - value.getBoundingClientRect().top) < 5;
  })), "Result labels and values share a line");
  await results.getByText("Échappés / équipe", { exact: true }).waitFor();
  await results.getByText("Premier kill", { exact: true }).waitFor();
  await overview.getByRole("button", { name: "Tueur", exact: true }).click();
  for (const [grid, card] of [[results, ".sd-panel"], [streaks, ".sd-streak-camp"]]) {
    assert.equal(await grid.locator(`${card}.sd-tone-teal`).count(), 0);
    assert.ok(await grid.evaluate((element, selector) => Math.abs(element.clientWidth - element.querySelector(selector).getBoundingClientRect().width) < 2, `${card}.sd-tone-red`));
  }
  assert.equal(await campPanels.locator(".sd-survival-panel").count(), 0);
  assert.deepEqual(await scores.getByRole("columnheader").allTextContents(), ["Tueur"]);
  assert.deepEqual(await page.getByLabel("Mon personnage", { exact: true }).locator("option").allTextContents(), ["Tous les personnages", "The Trapper"]);
  assert.ok(!(await page.getByLabel("Adversaire", { exact: true }).locator("option").allTextContents()).includes("The Trapper"));
  await page.getByLabel("Mon personnage", { exact: true }).selectOption("killer:The Trapper");
  await overview.getByRole("button", { name: "Survivant", exact: true }).click();
  for (const [grid, card] of [[results, ".sd-panel"], [streaks, ".sd-streak-camp"]]) {
    assert.equal(await grid.locator(`${card}.sd-tone-red`).count(), 0);
    assert.ok(await grid.evaluate((element, selector) => Math.abs(element.clientWidth - element.querySelector(selector).getBoundingClientRect().width) < 2, `${card}.sd-tone-teal`));
  }
  assert.equal(await campPanels.locator(".sd-kill-panel").count(), 0);
  assert.deepEqual(await scores.getByRole("columnheader").allTextContents(), ["Survivant"]);
  await campPanels.getByRole("heading", { name: "Survie", exact: true }).waitFor();
  await campPanels.getByRole("heading", { name: "Régularité et classements entre survivants", exact: true }).waitFor();
  assert.equal(await campPanels.locator(".sd-survival-panel :is(.sd-segments, .sd-details, .sd-footnote)").count(), 0);
  assert.equal(await page.getByLabel("Mon personnage", { exact: true }).inputValue(), "all");
  assert.deepEqual(await page.getByLabel("Mon personnage", { exact: true }).locator("option").allTextContents(), ["Tous les personnages", "Jake Park"]);
  assert.deepEqual(await page.getByLabel("Adversaire", { exact: true }).locator("option").allTextContents(), ["Tous les adversaires", "The Trapper"]);
  await page.getByRole("tab", { name: /^Historique/ }).click();
  await page.locator(".statistics-participant-name").getByText("Alice Behaviour", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Voir l’équipement de Meg Thomas", exact: true }).first().click();
  const participantDialog = page.locator(".statistics-player-content");
  await participantDialog.getByRole("heading", { name: "Alice Behaviour", exact: true }).waitFor();
  const privateBeforeParticipant = previewRequests;
  await participantDialog.getByRole("button", { name: "Voir les statistiques de Alice Behaviour", exact: true }).click();
  await page.locator(".public-player-dialog").getByRole("heading", { name: "Statistiques de Alice Behaviour", exact: true }).waitFor();
  assert.equal(previewRequests, privateBeforeParticipant);
  await page.getByRole("button", { name: "Fermer les statistiques du joueur", exact: true }).click();

  await nav.getByRole("button", { name: "Classement", exact: true }).click();
  await page.locator(".community-page tbody tr").nth(49).waitFor();
  assert.equal(await page.locator(".community-page tbody tr").count(), 50);
  await page.getByRole("button", { name: "Suivant", exact: true }).click();
  await page.getByText("Page 2 / 2 · 51 joueurs", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".community-page tbody tr").length === 1);
  assert.equal(await page.locator(".community-page tbody tr").count(), 1);
  assert.equal(await page.getByRole("button", { name: "Suivant", exact: true }).isDisabled(), true);
  await page.getByLabel("Mode de jeu", { exact: true }).selectOption("1v4-killer");
  await page.locator(".community-killer-required").waitFor();
  await page.getByLabel("Tueur", { exact: true }).selectOption("The Trapper");
  await page.locator(".community-page tbody tr").nth(49).waitFor();
  assert.equal(leaderboardRequests.at(-1).page_index, 0);
  assert.equal(leaderboardRequests.at(-1).selected_killer, "The Trapper");
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/rpc/player_leaderboard") && response.request().postDataJSON()?.selected_mode === "2v8-survivor"),
    page.getByLabel("Mode de jeu", { exact: true }).selectOption("2v8-survivor"),
  ]);
  await page.locator(".community-page tbody tr").nth(49).waitFor();
  assert.equal(leaderboardRequests.at(-1).selected_killer, "");
  assert.equal(await page.getByLabel("Tueur", { exact: true }).count(), 0);
  const requestsBeforeReturn = leaderboardRequests.length;
  await nav.getByRole("button", { name: "Build", exact: true }).click();
  await nav.getByRole("button", { name: "Classement", exact: true }).click();
  await page.locator(".community-page tbody tr").nth(49).waitFor();
  assert.equal(await page.getByLabel("Mode de jeu", { exact: true }).inputValue(), "2v8-survivor");
  assert.equal(leaderboardRequests.length, requestsBeforeReturn, "Fresh rankings must reuse the cached page");
  const privateRequestsBeforeProfile = previewRequests;
  await page.getByRole("button", { name: "Voir les statistiques de Joueur 1", exact: true }).click();
  const publicProfile = page.locator(".public-player-dialog");
  await publicProfile.getByText("Statistiques de Bob Behaviour", { exact: true }).waitFor();
  await publicProfile.locator(".sd-filter-dock").waitFor();
  await checkFilterDock(publicProfile, publicProfile);
  await publicProfile.getByRole("tab", { name: /^Historique/ }).click();
  await publicProfile.locator(".statistics-match-card").first().waitFor();
  assert.equal(await publicProfile.getByRole("button", { name: "Synchroniser", exact: true }).count(), 0);
  assert.equal(await publicProfile.getByTitle("Modifier la partie", { exact: true }).count(), 0);
  assert.equal(previewRequests, privateRequestsBeforeProfile, "Public profiles must never load private workspaces");
  await publicProfile.getByRole("button", { name: "Fermer les statistiques du joueur", exact: true }).click();
  leaderboardUnavailable = true;
  await page.getByLabel("Mode de jeu", { exact: true }).selectOption("lights-out-survivor");
  await page.getByRole("alert").filter({ hasText: "Classement temporairement indisponible" }).waitFor();
  assert.equal(await page.locator(".community-page tbody tr").count(), 0, "A failed uncached mode must not display players from another mode");
  leaderboardUnavailable = false;
  await page.getByLabel("Mode de jeu", { exact: true }).selectOption("2v8-survivor");
  await page.locator(".community-page tbody tr").nth(49).waitFor();
  for (const width of [1366, 1024, 390]) {
    await page.setViewportSize({ width, height: 768 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `The leaderboard must fit at ${width}px`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: ".tmp-community-leaderboard.png", fullPage: true });

  await page.getByRole("button", { name: "Passer au mode Survivant", exact: true }).click();
  await page.locator(".killer-card").filter({ hasText: "Jake Park" }).click();
  await page.waitForFunction(() => window.audioTracks.some(audio => audio.dataset.plays && /Original_Survivor_Theme/i.test(audio.src)));
  assert.equal(await page.evaluate(() => window.audioTracks.find(audio => /Original_Survivor_Theme/i.test(audio.src)).loop), true);
  const survivorPlays = await page.evaluate(() => Number(window.audioTracks.find(audio => /Original_Survivor_Theme/i.test(audio.src)).dataset.plays));
  await page.locator(".killer-card").filter({ hasText: "Jake Park" }).click();
  await page.waitForFunction(previous => Number(window.audioTracks.find(audio => /Original_Survivor_Theme/i.test(audio.src)).dataset.plays) > previous, survivorPlays);
  await page.getByRole("status").filter({ hasText: "Données synchronisées" }).waitFor();
  const bobWorkspace = workspaces.get(users.bob.id);
  bobWorkspace.data["dbd-build-tool.current-session"] = JSON.stringify({ ...JSON.parse(bobWorkspace.data["dbd-build-tool.current-session"]), activeView: "administration" });
  await page.reload();
  await page.locator(".analyzer-topbar").waitFor();
  assert.equal(await page.getByRole("main", { name: "Administration", exact: true }).count(), 0, "A forged saved view must not open administration");
  await page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
  await signIn(users.alice);
  assert.ok((await page.evaluate(async () => (await import("/src/services/account-storage.ts")).appStorage.getItem("dbd-build-tool.builds"))).includes("Build Alice"));

  await nav.getByRole("button", { name: "Administration", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.account-toolbar [role="status"]')?.textContent === "Données synchronisées");
  const bobBeforePreview = JSON.stringify(workspaces.get(users.bob.id));
  await page.getByRole("button", { name: `Visualiser ${users.bob.email} en lecture seule`, exact: true }).click();
  await page.locator(".account-preview-banner").waitFor();
  assert.equal(JSON.stringify(workspaces.get(users.bob.id)), bobBeforePreview);
  const beforePreview = JSON.stringify([...workspaces]);
  assert.equal(await nav.getByRole("button", { name: "Administration", exact: true }).count(), 0);
  await nav.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("button", { name: "Passer au mode Tueur", exact: true }).click();
  await page.getByRole("combobox", { name: "Ouvrir un build", exact: true }).selectOption({ label: "Build Bob" });
  assert.equal(await page.getByRole("button", { name: "Sauvegarder", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Supprimer le build sélectionné", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("textbox", { name: "Build Name", exact: true }).isDisabled(), true);
  await page.keyboard.press("Control+s");
  await nav.getByRole("button", { name: "Tiers List", exact: true }).click();
  await page.getByRole("button", { name: "Détails de le piégeur", exact: true }).click();
  assert.equal(await page.getByLabel("Tier de la sélection", { exact: true }).isDisabled(), true);
  await nav.getByRole("button", { name: "Statistique", exact: true }).click();
  await page.getByRole("tab", { name: /^Historique/ }).click();
  await page.locator(".statistics-match-card").first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Synchroniser", exact: true }).count(), 0);
  assert.equal(await page.locator(".statistics-connection").count(), 0);
  assert.equal(await page.getByTitle("Modifier la partie", { exact: true }).count(), 0);
  assert.equal(await page.getByTitle("Supprimer la partie", { exact: true }).count(), 0);
  assert.equal(JSON.stringify([...workspaces]), beforePreview, "Inspecting Bob must not save either workspace");
  await page.getByRole("button", { name: "Quitter la visualisation", exact: true }).click();
  await page.getByRole("main", { name: "Administration", exact: true }).waitFor();
  await page.getByText(users.bob.email, { exact: true }).waitFor();
  await page.screenshot({ path: ".tmp-community-administration.png", fullPage: true });

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
  await nav.getByRole("button", { name: "Administration", exact: true }).click();
  await page.getByRole("button", { name: "Promouvoir consultant", exact: true }).click();
  await page.getByText("Consultant", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(users.bob.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill("Test-password-123");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await nav.getByRole("button", { name: "Administration", exact: true }).click();
  await page.getByText(users.bob.email, { exact: true }).last().waitFor();
  assert.equal(await page.getByRole("button", { name: "Promouvoir consultant", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Supprimer le compte", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Passer au mode Tueur", exact: true }).click();
  await nav.getByRole("button", { name: "Perks", exact: true }).click();
  await page.locator('.perk-card[data-perk-id="agitation"] .perk-card-details').click();
  await inspector.getByRole("button", { name: "Modifier le nom", exact: true }).click();
  await inspector.getByRole("button", { name: "Rétablir le nom natif", exact: true }).click();
  await inspector.getByLabel("Nom français").waitFor({ state: "hidden" });
  assert.equal(sharedNames.has("agitation"), false);
  assert.deepEqual(errors, []);
  console.log("Cloud browser checks passed: shared perk names and descriptions, private tiers and unranked blocks, public nickname, leaderboard pagination and filters, role filters, looping themes, admin read-only preview, account isolation, session refresh and network recovery.");
} catch (error) {
  await page?.screenshot({ path: ".tmp-community-browser-failure.png", fullPage: true }).catch(() => undefined);
  console.error((await page?.getByRole("main").innerText().catch(() => "Page indisponible"))?.slice(0, 1800));
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
