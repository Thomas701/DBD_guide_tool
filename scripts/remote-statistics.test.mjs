import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { statisticsHandler } from "../supabase/functions/sync-statistics/handler.mjs";
import { hashText } from "../extension/policy.mjs";
import { behaviourHistory, behaviourOverview, behaviourProfile, behaviourProviders, behaviourSession, behaviourToken } from "../tests/fixtures/behaviour-api.mjs";

globalThis.crypto ??= webcrypto;
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const url = "https://test-project.supabase.co", collector = "c".repeat(64);
const session = behaviourSession(); session.authToken.expirationDate = 0;
const credentials = { session, fingerprint: await hashText("alice"), timeZone: "Europe/Paris" };
const job = { userId: owner, lease: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", credentials };
const req = (body, headers = {}) => new Request(`${url}/functions/v1/sync-statistics`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("le serveur renouvelle et synchronise plusieurs joueurs sans navigateur, en préservant leur fuseau", async () => {
  const saved = [], finished = [], order = [];
  const handler = statisticsHandler({ url, serviceKey: "server-private-key", request: async (target, init) => {
    if (target.includes("/rpc/")) {
      assert.equal(init.headers.apikey, "server-private-key");
      const name = target.split("/").at(-1), body = JSON.parse(init.body); order.push(name);
      if (name === "authorize_statistics_cron") return Response.json(true);
      if (name === "claim_remote_statistics") { assert.equal(body.target_user,null); return Response.json([job, { ...job, userId: other, lease: "other-lease" }]); }
      if (name === "save_remote_statistics_session") { saved.push(body); return Response.json(null); }
      if (name === "save_remote_statistics_profile") { assert.equal(body.nickname, "Donoteet"); return Response.json(null); }
      if (name === "finish_remote_statistics") { finished.push(body); return Response.json(null); }
    }
    if (target.endsWith("/sso/token")) return Response.json({ access_token: behaviourToken("alice"), refresh_token: "rotated-private-refresh", expires_in: 3600, refresh_token_expire_date: new Date(Date.now()+86400_000).toISOString() });
    assert.ok(saved.length > 0, "Persist renewal before further API requests");
    if (target.endsWith("/players/me")) return Response.json(behaviourProfile);
    if (target.endsWith("/players/me/game-accounts/dbd")) return Response.json(behaviourProviders);
    return Response.json(target.includes("match-history") ? behaviourHistory : behaviourOverview);
  } });
  const response = await handler(req({ action: "cron" }, { "x-dbd-cron-token": "a".repeat(64) }));
  assert.equal(response.status,200); assert.equal((await response.json()).processed,2);
  assert.equal(saved.length,2); assert.equal(finished.length,2);
  assert.equal(finished[0].matches[0].id,"d9e9a1d32434193e7a9289f0e0dd2371f70c975e");
  assert.equal(finished[0].statistics.nickname, "Donoteet");
  assert.deepEqual(new Set(finished.map(item=>item.owner_id)),new Set([owner,other]));
  assert.ok(!JSON.stringify(finished).includes("private-refresh"));
  assert.ok(!JSON.stringify(finished).includes("header."));
});

test("aucun utilisateur ne peut lancer un autre compte ni usurper le cron", async () => {
  const targets = [];
  const handler = statisticsHandler({ url, serviceKey: "server-private-key", request: async (target, init) => {
    if (target.endsWith("/auth/v1/user")) return Response.json({ id: owner });
    const body = JSON.parse(init.body);
    if (target.endsWith("authorize_statistics_cron")) return Response.json(false);
    if (target.endsWith("claim_remote_statistics")) { targets.push(body.target_user); return Response.json([]); }
    if (target.endsWith("remote_statistics_owner")) return Response.json(null);
    throw new Error("Unexpected request");
  } });
  assert.equal((await handler(req({ action: "cron" }, { "x-dbd-cron-token": "a".repeat(64) }))).status,401);
  assert.equal((await handler(req({ action: "sync", userId: other }, { Authorization: "Bearer valid-user-jwt" }))).status,200);
  assert.deepEqual(targets,[owner]);
  assert.equal((await handler(req({ action: "connect", collector_token: collector, session: behaviourSession(), timeZone: "Europe/Paris" }))).status,401);
  assert.equal((await handler(req({ action: "sync" }))).status,401);
  assert.equal((await handler(req(null))).status,400);
});

test("le serveur importe les parties même si Behaviour n’a pas encore de statistiques générales", async () => {
  const finished = [];
  const profiles = [];
  const handler = statisticsHandler({ url, serviceKey: "server-private-key", request: async (target, init) => {
    if (target.endsWith("authorize_statistics_cron")) return Response.json(true);
    if (target.endsWith("claim_remote_statistics")) return Response.json([{ ...job, credentials: { ...credentials, session: behaviourSession() } }]);
    if (target.endsWith("finish_remote_statistics")) { finished.push(JSON.parse(init.body)); return Response.json(null); }
    if (target.endsWith("save_remote_statistics_profile")) { profiles.push(JSON.parse(init.body)); return Response.json(null); }
    if (target.includes("/player-stats/games/")) return Response.json({ code: "StatNotFound", message: "No stats found" }, { status: 404 });
    if (target.endsWith("/players/me")) return Response.json(behaviourProfile);
    if (target.endsWith("/players/me/game-accounts/dbd")) return Response.json(behaviourProviders);
    if (target.includes("match-history")) return Response.json(behaviourHistory);
    throw new Error("Unexpected request");
  } });
  const response = await handler(req({ action: "cron" }, { "x-dbd-cron-token": "a".repeat(64) }));
  assert.equal(response.status, 200);
  assert.equal(finished.length, 1);
  assert.equal(finished[0].owner_id, owner);
  assert.equal(finished[0].state, "success");
  assert.equal(finished[0].statistics, null);
  assert.equal(finished[0].matches.length, 1);
  assert.equal(profiles[0].nickname, "Donoteet");
  assert.equal(profiles[0].owner_id, owner);
  assert.ok(!JSON.stringify(finished).includes("private-refresh"));
});

test("une session révoquée ne bloque pas les autres joueurs et ne divulgue pas d’identifiants", async () => {
  const finished = [];
  const good = { ...credentials, session: behaviourSession() };
  const handler = statisticsHandler({ url, serviceKey: "server-private-key", request: async (target, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    if (target.endsWith("authorize_statistics_cron")) return Response.json(true);
    if (target.endsWith("claim_remote_statistics")) return Response.json([job,{...job,userId:other,credentials:good}]);
    if (target.endsWith("finish_remote_statistics")) { finished.push(body); return Response.json(null); }
    if (target.endsWith("save_remote_statistics_profile")) return Response.json(null);
    if (target.endsWith("/sso/token")) return new Response("private-error-body",{status:400});
    return Response.json(target.includes("match-history") ? behaviourHistory : behaviourOverview);
  } });
  const response=await handler(req({action:"cron"},{"x-dbd-cron-token":"a".repeat(64)}));
  assert.equal(response.status,200);
  assert.equal(finished.find(item=>item.owner_id===owner).state,"waiting_for_login");
  assert.equal(finished.find(item=>item.owner_id===other).state,"success");
  assert.ok(!JSON.stringify(finished).includes("private-error-body"));
  assert.ok(!(await response.text()).includes("private-refresh"));
});
