import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { setCloudClient } from "../src/services/cloud-client.js";
import { readCloudStatisticsSnapshot, readCloudStatisticsStatus, requestCloudStatisticsSync } from "../src/services/cloud-statistics.js";

test("l’historique paginé récupère ensuite seulement les changements et les suppressions", async () => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const firstVersion = "2026-11-21T12:00:00.123456+00:00";
  let version = firstVersion;
  const rows = Array.from({ length: 501 }, (_, index) => ({ match_id: String(index).padStart(40, "0"), entry: { id: String(index).padStart(40, "0") }, deleted: false, updated_at: firstVersion }));
  const requests: { since: string | undefined; count: number }[] = [];
  let remoteSyncs = 0;
  const user = { id: userId, aud: "authenticated", email: "alice@example.test", created_at: "2026-11-21T00:00:00Z", app_metadata: {}, user_metadata: {} };
  const client = createClient("https://dbd-test.supabase.co", "sb_publishable_test_key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      let result: unknown;
      if (url.pathname === "/auth/v1/user") result = user;
      else if (url.pathname === "/functions/v1/sync-statistics") {
        assert.equal(JSON.parse(init?.body as string).action, "sync");
        assert.match(new Headers(init?.headers).get("Authorization") ?? "", /^Bearer /);
        remoteSyncs++; result = { ok: true };
      }
      else if (url.pathname === "/rest/v1/player_statistics") result = [{ updated_at: version, overview: null, fetched_count: 0, imported_count: 0 }];
      else if (url.pathname === "/rest/v1/rpc/statistics_collector_status") result = { state: "success", message: "Synchronisé", lastSeenAt: version };
      else if (url.pathname === "/rest/v1/player_matches") {
        assert.equal(url.searchParams.get("user_id"), `eq.${userId}`);
        const since = url.searchParams.getAll("updated_at").find(value => value.startsWith("gt."))?.slice(3);
        const until = url.searchParams.getAll("updated_at").find(value => value.startsWith("lte."))!.slice(4);
        const afterId = url.searchParams.getAll("match_id").find(value => value.startsWith("gt."))?.slice(3);
        const selected = rows.filter(row => (!since || row.updated_at > since) && row.updated_at <= until && (!afterId || row.match_id > afterId))
          .sort((left, right) => left.match_id.localeCompare(right.match_id)).slice(0, Number(url.searchParams.get("limit")));
        requests.push({ since, count: selected.length }); result = selected;
      } else throw new Error(`Unexpected endpoint ${url.pathname}`);
      return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
    } },
  });
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const signature = Buffer.from("test-signature").toString("base64url");
  const authentication = await client.auth.setSession({ access_token: `${header}.${payload}.${signature}`, refresh_token: "test-refresh" });
  assert.equal(authentication.error, null);
  setCloudClient(client);
  try {
    const first = await readCloudStatisticsSnapshot() as { matchHistory: { id: string }[]; updatedAt: string };
    assert.equal(first.matchHistory.length, 501);
    assert.equal(first.updatedAt, new Date(firstVersion).toISOString());
    assert.deepEqual(requests.map(request => request.count), [500, 1]);
    await readCloudStatisticsSnapshot();
    assert.equal(requests.length, 2, "An unchanged history must not be downloaded again.");
    version = "2026-11-21T12:01:00.987654+00:00";
    rows[0]!.deleted = true; rows[0]!.updated_at = version;
    const newId = String(501).padStart(40, "0");
    rows.push({ match_id: newId, entry: { id: newId }, deleted: false, updated_at: version });
    const next = await readCloudStatisticsSnapshot() as { matchHistory: { id: string }[] };
    assert.equal(next.matchHistory.length, 501);
    assert.equal(next.matchHistory.some(entry => entry.id === rows[0]!.match_id), false);
    assert.equal(next.matchHistory.some(entry => entry.id === newId), true);
    assert.deepEqual(requests.at(-1), { since: firstVersion, count: 2 });
    assert.equal((await readCloudStatisticsStatus()).lastSuccessAt, new Date(version).toISOString());
    await requestCloudStatisticsSync();
    assert.equal(remoteSyncs, 1, "Manual synchronization must work without a browser extension.");
  } finally { setCloudClient(null); }
});
