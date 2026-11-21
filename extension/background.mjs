import { APP_URL } from "./config.mjs";
import { isAllowedSender, validPairing } from "./policy.mjs";

const ALARM = "dbd-statistics-sync";
let syncing = null;

async function ensureAlarm() {
  if (!await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { periodInMinutes: 5 });
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}
chrome.runtime.onInstalled.addListener(() => { void ensureAlarm(); });
chrome.runtime.onStartup.addListener(() => { void ensureAlarm(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void sync().catch(() => undefined); });
chrome.action.onClicked.addListener(() => { void chrome.tabs.create({ url: APP_URL }); });

chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (!isAllowedSender(sender.url, APP_URL)) { respond({ ok: false, error: "Site non autorisé." }); return false; }
  void handleExternal(message).then(respond).catch(() => respond({ ok: false, error: "L’extension n’a pas pu terminer cette opération." }));
  return true;
});

async function handleExternal(message) {
  if (message?.type === "DBD_EXTENSION_STATUS") {
    const { pairing, status } = await chrome.storage.local.get(["pairing", "status"]);
    return { ok: true, userId: pairing?.userId ?? null, status: status ?? null };
  }
  if (message?.type === "DBD_EXTENSION_PAIR") {
    if (!validPairing(message.pairing)) return { ok: false, error: "Configuration invalide." };
    // Finish any upload to the previous account before changing the association.
    if (syncing) await syncing.catch(() => undefined);
    await chrome.storage.local.set({ pairing: { ...message.pairing, fingerprint: null, knownMatches: [] }, status: "Connexion Behaviour requise." });
    await ensureAlarm();
    const tab = await chrome.tabs.create({ url: "https://stats.deadbydaylight.com/statistics/", active: true });
    await chrome.storage.local.set({ loginTabId: tab.id });
    void sync(tab.id).catch(() => undefined);
    return { ok: true };
  }
  const { pairing } = await chrome.storage.local.get("pairing");
  if (!pairing || pairing.userId !== message?.userId) return { ok: false, error: "Connectez d’abord l’extension à ce compte." };
  if (message.type === "DBD_EXTENSION_DISCONNECT") {
    if (syncing) await syncing.catch(() => undefined);
    await chrome.storage.local.remove(["pairing", "status", "loginTabId"]);
    return { ok: true };
  }
  if (message.type === "DBD_EXTENSION_SYNC") {
    void sync().catch(() => undefined);
    return { ok: true };
  }
  return { ok: false, error: "Commande inconnue." };
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "DBD_STATISTICS_READY" || !sender.tab || !sender.url?.startsWith("https://stats.deadbydaylight.com/")) return;
  void chrome.storage.local.get("loginTabId").then(({ loginTabId }) => {
    if (sender.tab.id === loginTabId) void sync(loginTabId).catch(() => undefined);
  });
});

async function readTab(tabId, kind, knownMatches = [], attemptedMatches = []) {
  for (let attempt = 0; attempt < 15; attempt++) {
    try { return await chrome.tabs.sendMessage(tabId, { type: "DBD_COLLECT", kind, knownMatches, attemptedMatches }); }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  throw new Error("La page Behaviour ne répond pas. Réessayez depuis le site.");
}

async function upload(pairing, statistics, matches, state, detail) {
  const response = await fetch(`${pairing.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/ingest_player_statistics`, {
    method: "POST", headers: { apikey: pairing.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ collector_token: pairing.collectorToken, statistics, matches, collector_state: state, collector_message: detail }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Association révoquée. Reconnectez l’extension depuis votre compte." : "Supabase n’a pas pu enregistrer les statistiques.");
}

function sync(existingTabId) {
  if (syncing) return syncing;
  syncing = runSync(existingTabId).finally(() => { syncing = null; });
  return syncing;
}

async function runSync(existingTabId) {
  const { pairing } = await chrome.storage.local.get("pairing");
  if (!validPairing(pairing)) return;
  const created = [];
  try {
    let overviewTabId = existingTabId;
    if (overviewTabId === undefined) {
      overviewTabId = (await chrome.tabs.create({ url: "https://stats.deadbydaylight.com/statistics/", active: false })).id;
      created.push(overviewTabId);
    }
    const overview = await readTab(overviewTabId, "overview");
    if (!overview?.ok) {
      const detail = overview?.error ?? "Reconnectez-vous à Behaviour, puis relancez la synchronisation.";
      await upload(pairing, null, [], "waiting_for_login", detail);
      await chrome.storage.local.set({ status: detail });
      return;
    }
    if (!overview.fingerprint) throw new Error("Le compte Behaviour n’a pas pu être identifié. Aucune statistique envoyée.");
    if (pairing.fingerprint && pairing.fingerprint !== overview.fingerprint) throw new Error("Le compte Behaviour a changé. Rétablissez le compte associé avant de synchroniser.");
    if (!pairing.fingerprint) {
      pairing.fingerprint = overview.fingerprint;
      await chrome.storage.local.set({ pairing });
    }
    const historyTab = await chrome.tabs.create({ url: "https://stats.deadbydaylight.com/match-history/", active: false });
    created.push(historyTab.id);
    const history = await readTab(historyTab.id, "history", pairing.knownMatches ?? [], pairing.attemptedMatches ?? []);
    if (!history?.ok) throw new Error(history?.error ?? "Historique Behaviour indisponible.");
    if (history.fingerprint !== overview.fingerprint) throw new Error("Le compte Behaviour a changé pendant la lecture. Aucune statistique envoyée.");
    await upload(pairing, overview.statistics, history.matches, "success", "Statistiques synchronisées depuis votre navigateur.");
    pairing.knownMatches = [...new Set([...(history.completeMatchIds ?? []), ...(pairing.knownMatches ?? [])])].slice(0, 2_000);
    const attempted = new Set(history.matches.map(match => match.id));
    pairing.attemptedMatches = [...(pairing.attemptedMatches ?? []).filter(id => !attempted.has(id)), ...attempted].slice(-2_000);
    await chrome.storage.local.set({ pairing });
    await chrome.storage.local.set({ status: `Dernière synchronisation : ${new Date().toISOString()}` });
    if (existingTabId !== undefined) await chrome.storage.local.remove("loginTabId");
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "Synchronisation impossible.";
    await chrome.storage.local.set({ status: detail });
    await upload(pairing, null, [], "error", detail).catch(() => undefined);
  } finally {
    for (const tabId of created) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}
