import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { isAllowedSender, validPairing, hashText } from "../extension/policy.mjs";
import { APP_URL } from "../extension/config.mjs";
import { createStatisticsParser, prioritizeMatchRetries } from "../shared/statistics-parser.mjs";
import { matchHistoryIdentity } from "../shared/match-history-identity.mjs";
import { buildMatchHistoryEntryId } from "./match-history-id.mjs";
import { readBehaviourIdentity } from "../extension/behaviour-session.mjs";
import { collectBehaviourStatistics, mapBehaviourMatches, mapBehaviourOverview, readBehaviourNickname, behaviourSharedMatchId } from "../extension/behaviour-api.mjs";
import { behaviourHistory, behaviourOverview, behaviourProfile, behaviourProviders, behaviourSession, behaviourToken, behaviourPlayer } from "../tests/fixtures/behaviour-api.mjs";
import { STATISTICS_EXTENSION_ID, statisticsBrowser, statisticsBrowsers, statisticsStoreUrl } from "../dist/src/services/statistics-extension.js";

globalThis.crypto ??= webcrypto;

test("l’installation distingue les navigateurs Chromium de bureau et les navigateurs incompatibles", () => {
  assert.equal(statisticsBrowser("Mozilla Chrome/140.0 Safari/537.36 Edg/140.0").name, "Edge");
  assert.equal(statisticsBrowser("Mozilla Chrome/140.0 Safari/537.36 OPR/124.0"), statisticsBrowsers.opera);
  assert.equal(statisticsBrowser("Mozilla Chrome/140.0 Vivaldi/7.6"), statisticsBrowsers.vivaldi);
  assert.equal(statisticsBrowser("Mozilla Chrome/140.0 Brave/1.82"), statisticsBrowsers.brave);
  assert.equal(statisticsBrowser("Mozilla Chromium/140.0"), statisticsBrowsers.chrome);
  assert.equal(statisticsBrowser("Mozilla Firefox/142.0"), statisticsBrowsers.firefox);
  assert.equal(statisticsBrowser("Mozilla Version/18.0 Safari/605.1.15"), statisticsBrowsers.safari);
  assert.equal(statisticsBrowser("unknown"), statisticsBrowsers.other);
  assert.equal(statisticsBrowser("Mozilla Chrome/140.0 Safari/537.36").supported, true);
  for (const ua of ["Mozilla Firefox/142.0", "Mozilla Version/18.0 Safari/605.1.15", "Mozilla Android Chrome/140.0 Mobile", "Mozilla iPad Version/18.0 Safari/605.1.15"]) assert.equal(statisticsBrowser(ua).supported, false);
});

test("le bouton d’installation accepte uniquement une fiche réelle du Chrome Web Store", () => {
  const url = "https://chromewebstore.google.com/detail/" + "a".repeat(32);
  assert.equal(statisticsStoreUrl(url), url);
  for (const value of [null, "", "https://example.com/detail/" + "a".repeat(32), url + "?redirect=evil", url.replace("https:", "http:"), url.replace("chromewebstore", "user:password@chromewebstore"), "https://chromewebstore.google.com/detail/inconnue"]) assert.equal(statisticsStoreUrl(value), null);
});

test("la passerelle refuse les autres fenêtres, origines, commandes et exemplaires de l’extension", async () => {
  let receive, calls = 0;
  const messages = [], origin = new URL(APP_URL).origin;
  const window = { postMessage: message => messages.push(message), addEventListener: (_type, listener) => { receive = listener; } };
  window.top = window;
  runInNewContext(await readFile(new URL("../extension/site.js", import.meta.url), "utf8"), {
    window, location: { origin }, chrome: { runtime: { id: "chosen-extension", sendMessage: async () => { calls++; return { ok: true }; } } },
  });
  assert.equal(messages[0].type, "READY");
  const request = { source: "DBD_BUILD_ANALYZER", id: "request", extensionId: "chosen-extension", request: { type: "DBD_EXTENSION_STATUS" } };
  for (const event of [
    { source: {}, origin, data: request },
    { source: window, origin: "https://evil.example", data: request },
    { source: window, origin, data: { ...request, extensionId: "another-extension" } },
    { source: window, origin, data: { ...request, request: { type: "EXECUTE_CODE" } } },
  ]) receive(event);
  assert.equal(calls, 0);
  receive({ source: window, origin, data: request });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(messages[1].reply.extensionId, "chosen-extension");
});

test("l’API conserve les identifiants historiques, les emblèmes et les détails des participants", async () => {
  const [match] = await mapBehaviourMatches(behaviourHistory, new Date("2026-11-22T12:00:00Z"), "Europe/Paris");
  assert.equal(match.playedAt, "2026-11-20T00:55:00.000Z");
  assert.equal(match.id, "d9e9a1d32434193e7a9289f0e0dd2371f70c975e");
  assert.equal(match.survivalTimeLabel, "11:41");
  assert.equal(match.durationLabel, "13:29");
  assert.equal(match.participants[0].name, "Meg Thomas");
  assert.equal(match.participants[1].name, "The Trapper");
  assert.equal(match.resultLabel, "Sacrificed");
  assert.match(match.emblemIconUrls[0], /Benevolent_3.png$/);
  assert.equal(mapBehaviourOverview(behaviourOverview).matchesPlayed, "1,832");
  await assert.rejects(mapBehaviourMatches([{}]), /invalide/);
  assert.throws(() => mapBehaviourOverview({}), /invalides/);
  const special = structuredClone(behaviourHistory); special[0].matchStat.gameType.id = "Firefly";
  const [lightsOut] = await mapBehaviourMatches(special);
  assert.equal(lightsOut.queueLabel, "Lights Out"); assert.deepEqual(lightsOut.perkIconUrls, []);
  assert.deepEqual(lightsOut.participants[0].perkIconUrls, []);
});

test("la session Behaviour expirée est renouvelée et persistée avant la lecture sans fuite dans le résultat", async () => {
  const session = behaviourSession(); session.authToken.expirationDate = 0;
  const calls = [], saved = [];
  const request = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/sso/token")) return Response.json({ access_token: behaviourToken("alice"), refresh_token: "rotated-private-refresh", expires_in: 3600, refresh_token_expire_date: new Date(Date.now() + 86400_000).toISOString() });
    assert.equal(saved.length, 1);
    if (url.endsWith("/players/me")) return Response.json(behaviourProfile);
    if (url.endsWith("/players/me/game-accounts/dbd")) return Response.json(behaviourProviders);
    return Response.json(url.includes("match-history") ? behaviourHistory : behaviourOverview);
  };
  const result = await collectBehaviourStatistics(session, async value => { saved.push(value); }, request);
  assert.equal(calls.length, 5);
  assert.equal(result.statistics.nickname, "Donoteet");
  assert.equal(saved[0].refreshToken.token, "rotated-private-refresh");
  assert.ok(!JSON.stringify(result).includes("refresh"));
  assert.ok(!JSON.stringify(result).includes("header."));
});

test("une partie commune garde la même empreinte depuis deux comptes et refuse les rapprochements incomplets", async () => {
  const first = structuredClone(behaviourHistory[0]);
  first.opponentStat.push(behaviourPlayer("VE_Camper", "Claudette Morel"), behaviourPlayer("VE_Camper", "Dwight Fairfield"));
  const second = structuredClone(first);
  [second.playerStat, second.opponentStat[1]] = [second.opponentStat[1], second.playerStat];
  second.opponentStat.reverse();
  const identity = await behaviourSharedMatchId(first);
  assert.match(identity, /^[a-f0-9]{64}$/);
  assert.equal(await behaviourSharedMatchId(second), identity);
  assert.equal((await mapBehaviourMatches([first], new Date(), "Europe/Paris"))[0].sharedMatchId,
    (await mapBehaviourMatches([second], new Date(), "America/New_York"))[0].sharedMatchId);
  second.matchStat.matchStartTime += 1;
  assert.notEqual(await behaviourSharedMatchId(second), identity);
  assert.equal(await behaviourSharedMatchId(behaviourHistory[0]), null);
});

test("un refus 401 renouvelle une fois et une révocation ne provoque aucune ouverture de page", async () => {
  let requests = 0, refreshes = 0;
  const session = behaviourSession();
  const request = async url => {
    if (url.endsWith("/sso/token")) { refreshes++; return Response.json({ access_token: behaviourToken("alice"), refresh_token: "next", expires_in: 3600, refresh_token_expire_date: new Date(Date.now() + 86400_000).toISOString() }); }
    requests++; if (requests === 1) return new Response(null, { status: 401 });
    return Response.json(url.includes("match-history") ? behaviourHistory : behaviourOverview);
  };
  await collectBehaviourStatistics(session, async () => {}, request);
  assert.equal(refreshes, 1); assert.equal(requests, 5);
  session.authToken.expirationDate = 0;
  await assert.rejects(collectBehaviourStatistics(session, async () => {}, async () => new Response(null, { status: 400 })), /révoquée/);
});

test("un aperçu Behaviour absent ne bloque pas l’historique et les autres erreurs restent signalées", async () => {
  const request = (status, code) => async url => {
    if (url.includes("/player-stats/games/")) return Response.json({ code, message: "No stats found" }, { status });
    if (url.endsWith("/players/me")) return Response.json(behaviourProfile);
    if (url.endsWith("/players/me/game-accounts/dbd")) return Response.json(behaviourProviders);
    return Response.json(behaviourHistory);
  };
  const result = await collectBehaviourStatistics(behaviourSession(), async () => {}, request(404, "StatNotFound"));
  assert.equal(result.statistics, null);
  assert.equal(result.nickname, "Donoteet");
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].characterName, "Jake Park");
  for (const [status, code] of [[404, "ProviderNotFound"], [503, "StatNotFound"]]) {
    await assert.rejects(collectBehaviourStatistics(behaviourSession(), async () => {}, request(status, code)), /ne peut pas fournir/);
  }
  await assert.rejects(collectBehaviourStatistics(behaviourSession(), async () => {}, async url => url.includes("/player-stats/games/")
    ? Response.json(null) : request(404, "StatNotFound")(url)), /Statistiques Behaviour invalides/);
});

test("le pseudo correspond au bloc officiel, à la plateforme sélectionnée et à la progression partagée", async () => {
  const html = await readFile(new URL("../html_history_match_example.txt", import.meta.url), "utf8");
  const header = html.match(/<span\b[^>]*data-cy="nav-user-nickname"[^>]*>([^<]+)<\/span>/)?.[1];
  assert.equal(header, "Donoteet");
  assert.equal(readBehaviourNickname(behaviourProfile, behaviourProviders, "egs"), header);
  assert.equal(readBehaviourNickname(behaviourProfile, behaviourProviders, "steam"), "Steam Player");
  assert.equal(readBehaviourNickname(behaviourProfile, [{ provider: "egs", status: "synced" }], "egs"), "Compte Behaviour");
  assert.equal(readBehaviourNickname({ nickName: "  Nom exact#1234  " }, [], "bhvr"), "Nom exact#1234");
  for (const profile of [null, {}, { nickName: 42 }, { nickName: " " }, { nickName: "a".repeat(41) }, { nickName: "Invalid\nName" }, { accounts: {}, nickName: null }]) {
    assert.equal(readBehaviourNickname(profile, behaviourProviders, "egs"), null);
  }
  const result = await collectBehaviourStatistics(behaviourSession(), async () => {}, async url => {
    if (url.includes("/players/me")) return new Response(null, { status: 503 });
    return Response.json(url.includes("match-history") ? behaviourHistory : behaviourOverview);
  });
  assert.equal(result.statistics.nickname, undefined, "A missing nickname must not block statistics or erase an existing profile");
});

test("des détails temporairement indisponibles ne bloquent pas l’import des autres parties", () => {
  const candidates = ["retry-newest", "unseen", "retry-oldest"].map(id => ({ entry: { id } }));
  assert.deepEqual(prioritizeMatchRetries(candidates, ["retry-oldest", "retry-newest"]).map(({ entry }) => entry.id), ["unseen", "retry-oldest", "retry-newest"]);
});

test("l’identité Behaviour reste stable après renouvellement et distingue les joueurs", () => {
  const store = (sub, nonce) => JSON.stringify({ state: { authToken: { token: `header.${Buffer.from(JSON.stringify({ sub, nonce })).toString("base64url")}.signature` }, refreshToken: { token: "must-stay-in-browser" } } });
  assert.equal(readBehaviourIdentity(store("alice", 1)), "alice");
  assert.equal(readBehaviourIdentity(store("alice", 2)), "alice");
  assert.equal(readBehaviourIdentity(store("bob", 1)), "bob");
  for (const value of [null, "{}", "invalid", JSON.stringify({ state: { authToken: { token: "opaque" } } })]) assert.equal(readBehaviourIdentity(value), null);
});

test("l’extension refuse les autres sites, y compris les autres projets GitHub Pages", () => {
  assert.equal(isAllowedSender(APP_URL, APP_URL), true);
  assert.equal(isAllowedSender(`${APP_URL}?code=oauth`, APP_URL), true);
  assert.equal(isAllowedSender("http://127.0.0.1:5173/", APP_URL), false);
  assert.equal(isAllowedSender("http://127.0.0.1:5173/", "http://127.0.0.1:5173/"), true);
  assert.equal(isAllowedSender("http://127.0.0.1:9999/", "http://127.0.0.1:5173/"), false);
  assert.equal(isAllowedSender("https://thomas701.github.io/autre-site/", APP_URL), false);
  assert.equal(isAllowedSender("https://thomas701.github.io.evil.example/DBD_guide_tool/", APP_URL), false);
  assert.equal(isAllowedSender("https://example.com/", APP_URL), false);
  assert.equal(isAllowedSender("https://user:password@thomas701.github.io/DBD_guide_tool/", APP_URL), false);
});

test("l’association ne permet pas un serveur arbitraire ou un jeton invalide", () => {
  const pairing = { supabaseUrl: "https://test-project.supabase.co", publishableKey: "sb_publishable_test_key_12345", collectorToken: "a".repeat(64), userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
  assert.equal(validPairing(pairing), true);
  for (const url of ["https://evil.example", "http://test-project.supabase.co", "https://test-project.supabase.co.evil.example", "https://test-project.supabase.co/other", "https://test-project.supabase.co/?target=evil"]) {
    assert.equal(validPairing({ ...pairing, supabaseUrl: url }), false);
  }
  assert.equal(validPairing({ ...pairing, collectorToken: "expired" }), false);
});

test("le navigateur et le collecteur local calculent les mêmes identifiants", async () => {
  const html = await readFile(new URL("../html_history_match_example.txt", import.meta.url), "utf8");
  const parser = createStatisticsParser(matchHistoryIdentity);
  const entries = parser.extractMatchHistoryEntriesFromHtml(html, "https://stats.deadbydaylight.com/match-history/", new Date("2026-11-21T12:00:00Z"));
  assert.ok(entries.length > 0);
  for (const entry of entries) assert.equal(await hashText(entry.id, "SHA-1"), buildMatchHistoryEntryId(entry));
});

test("le site contacte l’extension réellement distribuée par le Chrome Web Store", async () => {
  const store = JSON.parse(await readFile(new URL("../public/extension-store.json", import.meta.url), "utf8"));
  assert.equal(STATISTICS_EXTENSION_ID, new URL(store.chromeWebStoreUrl).pathname.split("/").at(-1));
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const developmentId = [...createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest().subarray(0, 16)]
    .flatMap(byte => [byte >> 4, byte & 15]).map(value => String.fromCharCode(97 + value)).join("");
  assert.equal(developmentId, STATISTICS_EXTENSION_ID, "Les tests dans Chrome doivent utiliser la même identité que le Store.");
});

test("sans passerelle injectée, Chrome détecte l’extension du Store et peut lui demander la connexion", async () => {
  const source = await readFile(new URL("../dist/src/services/statistics-extension.js", import.meta.url), "utf8");
  const calls = [], storeId = "cljdeckobhfikpiecnpjlhmlbaeoalgh";
  const runtime = { sendMessage(id, request, reply) {
    calls.push({ id, request });
    if (id === storeId) reply({ ok: true, guidedSetupSupported: true, loginRequired: request.type === "DBD_EXTENSION_LOGIN" });
    else reply(undefined);
  } };
  const send = runInNewContext(source.replace(/^export /gm, "") + ";statisticsExtensionMessage", {
    crypto, chrome: { runtime },
    window: { location: { origin: new URL(APP_URL).origin }, addEventListener() {}, removeEventListener() {}, postMessage() { throw new Error("La connexion au Store doit fonctionner sans passerelle."); } },
    setTimeout: (callback, duration) => setTimeout(callback, duration === 600 ? 0 : duration), clearTimeout,
  });
  assert.equal((await send({ type: "DBD_EXTENSION_STATUS" })).guidedSetupSupported, true);
  assert.equal((await send({ type: "DBD_EXTENSION_LOGIN", userId: "current-user" })).loginRequired, true);
  assert.deepEqual(calls.map(call => call.id), [storeId, storeId, storeId]);
  assert.deepEqual(calls.map(call => call.request.type), ["DBD_EXTENSION_STATUS", "DBD_EXTENSION_STATUS", "DBD_EXTENSION_LOGIN"]);
});

test("une détection impossible conserve le refus exact de Chrome pour le diagnostic", async () => {
  const source = await readFile(new URL("../dist/src/services/statistics-extension.js", import.meta.url), "utf8");
  const runtime = { lastError: { message: "Could not establish connection. Receiving end does not exist." }, sendMessage(_id, _request, reply) { reply(undefined); } };
  const send = runInNewContext(source.replace(/^export /gm, "") + ";statisticsExtensionMessage", {
    crypto, chrome: { runtime },
    window: { location: { origin: new URL(APP_URL).origin }, addEventListener() {}, removeEventListener() {}, postMessage() {} },
    setTimeout: (callback, duration) => setTimeout(callback, duration === 600 ? 0 : duration), clearTimeout,
  });
  await assert.rejects(send({ type: "DBD_EXTENSION_STATUS" }), /Receiving end does not exist/);
});

test("Chrome 126 démarre et répond en utilisant le stockage de session privé", async () => {
  const source = await readFile(new URL("../extension/background.mjs", import.meta.url), "utf8");
  let external, internal, protectedAccess, reads = 0;
  const session = {
    async setAccessLevel(options) { protectedAccess = options.accessLevel; },
    async get() { reads++; return {}; },
  };
  runInNewContext(source.replace(/^\uFEFF/, "").replace(/^import .*\r?\n/gm, ""), {
    APP_URL, isAllowedSender,
    chrome: {
      storage: { local: {}, session },
      runtime: { id: STATISTICS_EXTENSION_ID, onInstalled: { addListener() {} }, onStartup: { addListener() {} },
        onMessageExternal: { addListener(listener) { external = listener; } }, onMessage: { addListener(listener) { internal = listener; } } },
      alarms: { onAlarm: { addListener() {} } }, action: { onClicked: { addListener() {} } },
    },
  });
  const direct = await new Promise(resolve => external({ type: "DBD_EXTENSION_STATUS" }, { url: APP_URL }, resolve));
  const bridge = await new Promise(resolve => internal({ type: "DBD_EXTENSION_STATUS" }, { id: STATISTICS_EXTENSION_ID, tab: {}, frameId: 0, url: APP_URL }, resolve));
  assert.equal(direct.guidedSetupSupported, true);
  assert.equal(bridge.guidedSetupSupported, true);
  assert.equal(protectedAccess, "TRUSTED_CONTEXTS");
  assert.equal(reads, 2);
});
