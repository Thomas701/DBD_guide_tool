import { APP_URL } from "./config.mjs";
import { isAllowedSender, validPairing, hashText } from "./policy.mjs";
import { readBehaviourIdentity, validBehaviourSession } from "./behaviour-session.mjs";
import { collectBehaviourStatistics } from "./behaviour-api.mjs";

const ALARM = "dbd-statistics-sync";
let syncing = null;

async function ensureAlarm() {
  if (!await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { periodInMinutes: 5 });
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}
void ensureAlarm().catch(() => undefined);
chrome.runtime.onInstalled.addListener(() => { void ensureAlarm(); });
chrome.runtime.onStartup.addListener(() => { void ensureAlarm(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void sync().catch(() => undefined); });
chrome.action.onClicked.addListener(() => { void chrome.tabs.create({ url: APP_URL }); });

chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (!isAllowedSender(sender.url, APP_URL)) { respond({ ok: false, error: "Site non autorisé." }); return false; }
  void handleExternal(message).then(respond).catch(() => respond({ ok: false, error: "L’extension n’a pas pu terminer cette opération." }));
  return true;
});

async function rememberSession(session) {
  if (!validBehaviourSession(session)) return false;
  const { pairing, behaviourSession } = await chrome.storage.local.get(["pairing", "behaviourSession"]);
  if (!validPairing(pairing)) return false;
  const fingerprint = await hashText(readBehaviourIdentity(JSON.stringify({ state: session })));
  if (pairing.fingerprint && pairing.fingerprint !== fingerprint) return false;
  if (behaviourSession?.authToken.expirationDate > session.authToken.expirationDate) return true;
  await chrome.storage.local.set({ behaviourSession: session, pairing: { ...pairing, fingerprint } });
  return true;
}

async function captureOpenSession() {
  for (const tab of await chrome.tabs.query({ url: "https://stats.deadbydaylight.com/*" })) {
    const session = await chrome.tabs.sendMessage(tab.id, { type: "DBD_READ_BEHAVIOUR_SESSION" }).catch(() => null);
    if (await rememberSession(session)) return;
  }
}

async function handleExternal(message) {
  if (message?.type === "DBD_EXTENSION_STATUS") {
    const { pairing, status } = await chrome.storage.local.get(["pairing", "status"]);
    return { ok: true, userId: pairing?.userId ?? null, status: status ?? null };
  }
  if (message?.type === "DBD_EXTENSION_PAIR") {
    if (!validPairing(message.pairing)) return { ok: false, error: "Configuration invalide." };
    if (syncing) await syncing.catch(() => undefined);
    const { pairing: previous } = await chrome.storage.local.get("pairing");
    if (previous?.userId !== message.pairing.userId) await chrome.storage.local.remove("behaviourSession");
    await chrome.storage.local.set({ pairing: { ...message.pairing, fingerprint: null }, status: "Connexion Behaviour requise." });
    await ensureAlarm();
    await captureOpenSession();
    const { behaviourSession } = await chrome.storage.local.get("behaviourSession");
    if (behaviourSession) void sync().catch(() => undefined);
    return { ok: true, loginRequired: !behaviourSession };
  }
  const { pairing } = await chrome.storage.local.get("pairing");
  if (!pairing || pairing.userId !== message?.userId) return { ok: false, error: "Connectez d’abord l’extension à ce compte." };
  if (message.type === "DBD_EXTENSION_DISCONNECT") {
    if (syncing) await syncing.catch(() => undefined);
    await chrome.storage.local.remove(["pairing", "behaviourSession", "status", "loginTabId"]);
    return { ok: true };
  }
  if (message.type === "DBD_EXTENSION_SYNC") { void sync().catch(() => undefined); return { ok: true }; }
  return { ok: false, error: "Commande inconnue." };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "DBD_BEHAVIOUR_SESSION" || sender.id !== chrome.runtime.id || !sender.tab || !sender.url?.startsWith("https://stats.deadbydaylight.com/")) return false;
  void (async () => {
    if (syncing) await syncing.catch(() => undefined);
    const accepted = await rememberSession(message.session);
    respond({ ok: accepted });
    if (accepted) void sync().catch(() => undefined);
  })().catch(() => respond({ ok: false }));
  return true;
});

async function upload(pairing, statistics, matches, state, detail) {
  const response = await fetch(`${pairing.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/ingest_player_statistics`, {
    method: "POST", headers: { apikey: pairing.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ collector_token: pairing.collectorToken, statistics, matches, collector_state: state, collector_message: detail }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Association révoquée. Reconnectez l’extension depuis votre compte." : "Supabase n’a pas pu enregistrer les statistiques.");
}

function sync() {
  if (syncing) return syncing;
  syncing = runSync().finally(() => { syncing = null; });
  return syncing;
}

async function runSync() {
  const { pairing } = await chrome.storage.local.get("pairing");
  if (!validPairing(pairing)) return;
  try {
    let { behaviourSession } = await chrome.storage.local.get("behaviourSession");
    if (!behaviourSession) {
      await captureOpenSession();
      ({ behaviourSession } = await chrome.storage.local.get("behaviourSession"));
    }
    if (!validBehaviourSession(behaviourSession)) {
      const detail = "Connectez Behaviour depuis le site pour démarrer la synchronisation en arrière-plan.";
      await upload(pairing, null, [], "waiting_for_login", detail);
      await chrome.storage.local.set({ status: detail }); return;
    }
    const fingerprint = await hashText(readBehaviourIdentity(JSON.stringify({ state: behaviourSession })));
    if (pairing.fingerprint && pairing.fingerprint !== fingerprint) throw new Error("Le compte Behaviour a changé. Aucune statistique envoyée.");
    await chrome.storage.local.set({ pairing: { ...pairing, fingerprint } });
    const collected = await collectBehaviourStatistics(behaviourSession, async session => {
      if (!validBehaviourSession(session) || await hashText(readBehaviourIdentity(JSON.stringify({ state: session }))) !== fingerprint) throw new Error("La session renouvelée ne correspond pas au joueur associé.");
      await chrome.storage.local.set({ behaviourSession: session });
      for (const tab of await chrome.tabs.query({ url: "https://stats.deadbydaylight.com/*" })) {
        await chrome.tabs.sendMessage(tab.id, { type: "DBD_BEHAVIOUR_REFRESH", session }).catch(() => undefined);
      }
    });
    await upload(pairing, collected.statistics, collected.matches, "success", "Statistiques synchronisées en arrière-plan.");
    await chrome.storage.local.set({ status: `Dernière synchronisation : ${new Date().toISOString()}` });
  } catch (cause) {
    const detail = cause instanceof Error && !["TypeError", "AbortError", "TimeoutError"].includes(cause.name) ? cause.message : "Synchronisation temporairement indisponible. Nouvelle tentative automatique.";
    await chrome.storage.local.set({ status: detail });
    await upload(pairing, null, [], /Connexion Behaviour (expirée|révoquée)/.test(detail) ? "waiting_for_login" : "error", detail).catch(() => undefined);
  }
}
