import { APP_URL } from "./config.mjs";
import { isAllowedSender, validPairing, hashText } from "./policy.mjs";
import { readBehaviourIdentity, validBehaviourSession } from "./behaviour-session.mjs";

const ALARM = "dbd-statistics-sync";
let syncing = null;

async function resumePendingTransfer() {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const { behaviourSession, pairing } = await chrome.storage.local.get(["behaviourSession", "pairing"]);
  if (validBehaviourSession(behaviourSession) && validPairing(pairing)) {
    await chrome.alarms.create(ALARM, { periodInMinutes: 5 });
    void sync().catch(() => undefined);
  } else await chrome.alarms.clear(ALARM);
}
chrome.runtime.onInstalled.addListener(() => { void resumePendingTransfer(); });
chrome.runtime.onStartup.addListener(() => { void resumePendingTransfer(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void sync().catch(() => undefined); });
chrome.action.onClicked.addListener(() => { void chrome.tabs.create({ url: APP_URL }); });
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (!isAllowedSender(sender.url, APP_URL)) { respond({ ok: false, error: "Site non autoris\u00e9." }); return false; }
  void handleExternal(message).then(respond).catch(() => respond({ ok: false, error: "L'extension n'a pas pu terminer cette op\u00e9ration." }));
  return true;
});

async function rememberSession(session) {
  if (!validBehaviourSession(session)) return false;
  const { pairing } = await chrome.storage.local.get("pairing");
  if (!validPairing(pairing)) return false;
  const fingerprint = await hashText(readBehaviourIdentity(JSON.stringify({ state: session })));
  if (pairing.fingerprint && pairing.fingerprint !== fingerprint) return false;
  if (pairing.cloudConnected && pairing.registeredExpiration >= session.authToken.expirationDate) return true;
  await chrome.storage.local.set({ behaviourSession: session, pairing: { ...pairing, fingerprint } });
  await chrome.alarms.create(ALARM, { periodInMinutes: 5 });
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
    return { ok: true, userId: pairing?.userId ?? null, status: status ?? null, remoteSupported: true };
  }
  if (message?.type === "DBD_EXTENSION_PAIR") {
    if (!validPairing(message.pairing)) return { ok: false, error: "Configuration invalide." };
    if (syncing) await syncing.catch(() => undefined);
    const { pairing: previous } = await chrome.storage.local.get("pairing");
    if (previous?.userId !== message.pairing.userId) await chrome.storage.local.remove("behaviourSession");
    await chrome.storage.local.set({ pairing: { ...message.pairing, fingerprint: null, cloudConnected: false }, status: "Connexion Behaviour requise." });
    await captureOpenSession();
    const { behaviourSession } = await chrome.storage.local.get("behaviourSession");
    if (behaviourSession) void sync().catch(() => undefined);
    return { ok: true, loginRequired: !behaviourSession };
  }
  const { pairing } = await chrome.storage.local.get("pairing");
  if (!pairing || pairing.userId !== message?.userId) return { ok: false, error: "Connectez d'abord l'extension \u00e0 ce compte." };
  if (message.type === "DBD_EXTENSION_DISCONNECT") {
    if (syncing) await syncing.catch(() => undefined);
    await chrome.storage.local.remove(["pairing", "behaviourSession", "status", "loginTabId"]);
    await chrome.alarms.clear(ALARM);
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

function sync() {
  if (syncing) return syncing;
  syncing = runSync().finally(() => { syncing = null; });
  return syncing;
}

async function runSync() {
  const { pairing, behaviourSession } = await chrome.storage.local.get(["pairing", "behaviourSession"]);
  if (!validPairing(pairing)) return;
  if (!validBehaviourSession(behaviourSession) && !pairing.cloudConnected) {
    await captureOpenSession();
    const next = await chrome.storage.local.get("behaviourSession");
    if (next.behaviourSession) return runSync();
    await chrome.storage.local.set({ status: "Connectez Behaviour une fois pour activer la synchronisation distante." });
    return;
  }
  try {
    const transfer = validBehaviourSession(behaviourSession);
    const response = await fetch(`${pairing.supabaseUrl}/functions/v1/sync-statistics`, {
      method: "POST", headers: { apikey: pairing.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ action: transfer ? "connect" : "sync", collector_token: pairing.collectorToken,
        ...(transfer ? { session: behaviourSession, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : {}) }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok || !(await response.json()).ok) throw new Error("Remote synchronization unavailable");
    if (transfer) {
      await chrome.storage.local.set({ pairing: { ...pairing, cloudConnected: true, registeredExpiration: behaviourSession.authToken.expirationDate } });
      await chrome.storage.local.remove("behaviourSession");
      await chrome.alarms.clear(ALARM);
    }
    await chrome.storage.local.set({ status: "Synchronisation distante active, m\u00eame navigateur ferm\u00e9 et PC \u00e9teint." });
  } catch {
    await chrome.storage.local.set({ status: "Synchronisation distante temporairement indisponible. La connexion reste conserv\u00e9e pour r\u00e9essayer." });
  }
}
