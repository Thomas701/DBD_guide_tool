import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isAllowedSender, validPairing, hashText } from "../extension/policy.mjs";
import { APP_URL } from "../extension/config.mjs";
import { createStatisticsParser, prioritizeMatchRetries } from "../shared/statistics-parser.mjs";
import { matchHistoryIdentity } from "../shared/match-history-identity.mjs";
import { buildMatchHistoryEntryId } from "./match-history-id.mjs";
import { readBehaviourIdentity } from "../extension/behaviour-session.mjs";
import { collectBehaviourStatistics, mapBehaviourMatches, mapBehaviourOverview } from "../extension/behaviour-api.mjs";
import { behaviourHistory, behaviourOverview, behaviourSession, behaviourToken } from "../tests/fixtures/behaviour-api.mjs";

globalThis.crypto ??= webcrypto;

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
    return Response.json(url.includes("match-history") ? behaviourHistory : behaviourOverview);
  };
  const result = await collectBehaviourStatistics(session, async value => { saved.push(value); }, request);
  assert.equal(calls.length, 3);
  assert.equal(saved[0].refreshToken.token, "rotated-private-refresh");
  assert.ok(!JSON.stringify(result).includes("refresh"));
  assert.ok(!JSON.stringify(result).includes("header."));
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
  assert.equal(refreshes, 1); assert.equal(requests, 3);
  session.authToken.expirationDate = 0;
  await assert.rejects(collectBehaviourStatistics(session, async () => {}, async () => new Response(null, { status: 400 })), /révoquée/);
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

test("l’identité publique de l’extension correspond à celle utilisée par le site", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const source = await readFile(new URL("../src/services/statistics-extension.ts", import.meta.url), "utf8");
  const extensionId = [...createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest().subarray(0,16)].flatMap(byte=>[byte>>4,byte&15]).map(value=>String.fromCharCode(97+value)).join("");
  assert.ok(source.includes(`"${extensionId}"`));
});
