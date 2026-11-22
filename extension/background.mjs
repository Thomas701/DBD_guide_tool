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
async function activateOpenTabs() {
  for (const script of chrome.runtime.getManifest().content_scripts) {
    const tabs = await chrome.tabs.query({ url: script.matches });
    await Promise.allSettled(tabs.map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: script.js })));
  }
}
chrome.runtime.onInstalled.addListener(() => { void activateOpenTabs().catch(() => undefined); void resumePendingTransfer(); });
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
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }).catch(() => undefined);
    const session = await chrome.tabs.sendMessage(tab.id, { type: "DBD_READ_BEHAVIOUR_SESSION" }).catch(() => null);
    if (await rememberSession(session)) return;
  }
}

async function openLogin() {
  const { loginTabId, authorizationTabId, pairing } = await chrome.storage.local.get(["loginTabId", "authorizationTabId", "pairing"]);
  if (!pairing || pairing.cloudConnected) return;
  const authorization = authorizationTabId ? await chrome.tabs.get(authorizationTabId).catch(() => null) : null;
  if (authorization) { await chrome.tabs.update(authorization.id, { active: true }); return; }
  let tab = loginTabId ? await chrome.tabs.get(loginTabId).catch(() => null) : null;
  if (!tab?.url?.startsWith("https://stats.deadbydaylight.com/")) tab = await chrome.tabs.create({ url: "https://stats.deadbydaylight.com/statistics/", active: false });
  await chrome.storage.local.set({ loginTabId: tab.id });
  const deadline = Date.now() + 15_000;
  while ((await chrome.tabs.get(tab.id)).status !== "complete") {
    if (Date.now() >= deadline) throw new Error("La page Behaviour met trop de temps à répondre. Réessayez.");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = encode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  // The official callback reads its verifier here; this tab captures the tokens before the callback closes.
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: value => {
    localStorage.setItem("auth-store", JSON.stringify({ state: { authCodeVerifier: value }, version: 0 }));
  }, args: [verifier] });
  const url = new URL("https://account-backend.bhvr.com/sso/authorize");
  url.search = new URLSearchParams({ client_id: "DBDStats", response_type: "code", redirect_uri: "https://stats.deadbydaylight.com", code_challenge: challenge, code_challenge_method: "S256", action: "login", lang: "fr" }).toString();
  const opened = await chrome.tabs.create({ url: url.href, active: true });
  await chrome.storage.local.set({ authorizationTabId: opened.id });
}

async function continueConnection(userId, allowLogin) {
  const { behaviourSession, pairing } = await chrome.storage.local.get(["behaviourSession", "pairing"]);
  if (pairing?.userId !== userId) return { ok: false, error: "L’association a changé. Réessayez." };
  const loginRequired = !behaviourSession && !pairing.cloudConnected;
  if (behaviourSession) void sync().catch(() => undefined);
  if (loginRequired && allowLogin) await openLogin();
  return { ok: true, loginRequired };
}

async function handleExternal(message) {
  if (message?.type === "DBD_EXTENSION_STATUS") {
    const { pairing, status } = await chrome.storage.local.get(["pairing", "status"]);
    return { ok: true, userId: pairing?.userId ?? null, status: status ?? null, cloudConnected: Boolean(pairing?.cloudConnected), remoteSupported: true, guidedSetupSupported: true };
  }
  if (message?.type === "DBD_EXTENSION_PAIR") {
    if (!validPairing(message.pairing)) return { ok: false, error: "Configuration invalide." };
    if (syncing) await syncing.catch(() => undefined);
    const { pairing: previous } = await chrome.storage.local.get("pairing");
    if (previous?.userId !== message.pairing.userId) await chrome.storage.local.remove("behaviourSession");
    await chrome.storage.local.set({ pairing: { ...message.pairing, fingerprint: null, cloudConnected: false }, status: "Connexion Behaviour requise." });
    if (message.forceLogin) await chrome.storage.local.remove("behaviourSession");
    else await captureOpenSession();
    return continueConnection(message.pairing.userId, message.openLogin);
  }
  const { pairing } = await chrome.storage.local.get("pairing");
  if (!pairing || pairing.userId !== message?.userId) return { ok: false, error: "Connectez d'abord l'extension \u00e0 ce compte." };
  if (message.type === "DBD_EXTENSION_LOGIN") {
    await captureOpenSession();
    return continueConnection(message.userId, true);
  }
  if (message.type === "DBD_EXTENSION_DISCONNECT") {
    if (syncing) await syncing.catch(() => undefined);
    await chrome.storage.local.remove(["pairing", "behaviourSession", "status", "loginTabId", "authorizationTabId"]);
    await chrome.alarms.clear(ALARM);
    return { ok: true };
  }
  if (message.type === "DBD_EXTENSION_SYNC") { void sync().catch(() => undefined); return { ok: true }; }
  return { ok: false, error: "Commande inconnue." };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id === chrome.runtime.id && sender.tab && sender.frameId === 0 && isAllowedSender(sender.url, APP_URL)) {
    void handleExternal(message).then(respond).catch(() => respond({ ok: false, error: "L’extension n’a pas pu terminer cette opération." }));
    return true;
  }
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
      const owned = await chrome.storage.local.get(["loginTabId", "authorizationTabId"]);
      for (const id of [owned.loginTabId, owned.authorizationTabId]) {
        const tab = id ? await chrome.tabs.get(id).catch(() => null) : null;
        if (tab?.url?.startsWith("https://stats.deadbydaylight.com/")) await chrome.tabs.remove(id).catch(() => undefined);
      }
      await chrome.storage.local.remove(["loginTabId", "authorizationTabId"]);
    }
    await chrome.storage.local.set({ status: "Synchronisation distante active, m\u00eame navigateur ferm\u00e9 et PC \u00e9teint." });
  } catch {
    await chrome.storage.local.set({ status: "Synchronisation distante temporairement indisponible. La connexion reste conserv\u00e9e pour r\u00e9essayer." });
  }
}
