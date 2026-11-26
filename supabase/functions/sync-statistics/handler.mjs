import { BehaviourStatisticsUnavailableError, collectBehaviourStatistics } from "../../../extension/behaviour-api.mjs";
import { readBehaviourIdentity, validBehaviourSession } from "../../../extension/behaviour-session.mjs";
import { hashText } from "../../../extension/policy.mjs";

export function statisticsHandler({ url, serviceKey, request = fetch }) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  async function rpc(name, body) {
    const response = await request(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Database operation failed");
    return response.status === 204 ? null : response.json();
  }
  async function run(target_user) {
    const jobs = await rpc("claim_remote_statistics", { target_user });
    const results = await Promise.allSettled(jobs.map(async ({ userId, lease, credentials }) => {
      let statistics = null, matches = [], state = "success", detail = "Statistiques synchronisées par le serveur, même navigateur fermé.";
      try {
        const { session, fingerprint, timeZone } = credentials;
        if (!validBehaviourSession(session) || await hashText(readBehaviourIdentity(JSON.stringify({ state: session }))) !== fingerprint) throw new Error("Invalid stored session");
        const result = await collectBehaviourStatistics(session, async next => {
          if (!validBehaviourSession(next) || await hashText(readBehaviourIdentity(JSON.stringify({ state: next }))) !== fingerprint) throw new Error("Behaviour identity changed");
          await rpc("save_remote_statistics_session", { owner_id: userId, lease, behaviour_session: next });
        }, request, timeZone);
        statistics = result.statistics; matches = result.matches;
        if (result.nickname) await rpc("save_remote_statistics_profile", { owner_id: userId, lease, nickname: result.nickname });
      } catch (cause) {
        const loginRequired = cause instanceof Error && /Connexion Behaviour (expirée|révoquée)/.test(cause.message);
        state = loginRequired ? "waiting_for_login" : "error";
        detail = loginRequired ? "Behaviour demande une nouvelle connexion. Reconnectez Behaviour depuis votre compte." : "Synchronisation distante temporairement indisponible. Nouvelle tentative automatique.";
        if (cause instanceof BehaviourStatisticsUnavailableError) detail = cause.message;
      }
      await rpc("finish_remote_statistics", { owner_id: userId, lease, statistics, matches, state, detail });
    }));
    if (results.some(result => result.status === "rejected")) throw new Error("Statistics persistence failed");
    return jobs.length;
  }
  return async req => {
    const origin = req.headers.get("origin");
    const cors = { "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
    if (["https://thomas701.github.io", "http://127.0.0.1:5173", "http://localhost:5173"].includes(origin)) cors["Access-Control-Allow-Origin"] = origin;
    const reply = (body, status = 200) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return reply({ ok: false, error: "Méthode non autorisée." }, 405);
    try {
      if (Number(req.headers.get("content-length")) > 50000) return reply({ ok: false }, 413);
      const text = await req.text();
      if (new TextEncoder().encode(text).length > 50000) return reply({ ok: false }, 413);
      const body = JSON.parse(text);
      if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ ok: false }, 400);
      let owner = null;
      if (body.action === "cron") {
        const token = req.headers.get("x-dbd-cron-token");
        if (!/^[a-f0-9]{64}$/.test(token ?? "") || !await rpc("authorize_statistics_cron", { token })) return reply({ ok: false }, 401);
      } else if (["connect", "sync"].includes(body.action)) {
        if (/^[a-f0-9]{64}$/.test(body.collector_token ?? "")) owner = await rpc("remote_statistics_owner", { collector_token: body.collector_token });
        else if (body.action === "sync" && /^Bearer \S+$/.test(req.headers.get("authorization") ?? "")) {
          const userHeaders = { ...headers, Authorization: req.headers.get("authorization") };
          const verified = await request(`${url}/auth/v1/user`, { headers: userHeaders, signal: AbortSignal.timeout(10_000) });
          if (verified.ok) {
            const staff = await request(`${url}/rest/v1/rpc/is_admin`, {
              method: "POST", headers: userHeaders, body: "{}", signal: AbortSignal.timeout(10_000),
            });
            if (!staff.ok) throw new Error("Statistics role lookup failed");
            if (await staff.json() !== true) return reply({ ok: false, error: "Synchronisation manuelle réservée au personnel." }, 403);
            owner = (await verified.json()).id;
          }
        }
        if (!owner) return reply({ ok: false, error: "Connexion au compte requise." }, 401);
        if (body.action === "sync" && /^[a-f0-9]{64}$/.test(body.collector_token ?? "")) return reply({ ok: true, processed: 0 });
      } else return reply({ ok: false }, 400);
      if (body.action === "connect") {
        if (!validBehaviourSession(body.session) || typeof body.timeZone !== "string") return reply({ ok: false, error: "Session Behaviour invalide." }, 400);
        try { new Intl.DateTimeFormat("en", { timeZone: body.timeZone }); } catch { return reply({ ok: false }, 400); }
        await rpc("register_remote_statistics", { collector_token: body.collector_token, behaviour_session: body.session, fingerprint: await hashText(readBehaviourIdentity(JSON.stringify({ state: body.session }))), time_zone: body.timeZone });
      }
      return reply({ ok: true, processed: await run(owner) });
    } catch {
      return reply({ ok: false, error: "Synchronisation distante indisponible. Réessayez dans quelques instants." }, 503);
    }
  };
}
