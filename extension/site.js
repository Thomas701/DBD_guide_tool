(() => {
  if (window.top !== window || globalThis.dbdStatisticsBridge) return;
  globalThis.dbdStatisticsBridge = true;
  const commands = new Set(["DBD_EXTENSION_STATUS", "DBD_EXTENSION_PAIR", "DBD_EXTENSION_LOGIN", "DBD_EXTENSION_DISCONNECT", "DBD_EXTENSION_SYNC"]);
  window.addEventListener("message", event => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin || message?.source !== "DBD_BUILD_ANALYZER"
      || typeof message.id !== "string" || message.id.length > 100 || !commands.has(message.request?.type)) return;
    if (message.extensionId && message.extensionId !== chrome.runtime.id) return;
    void chrome.runtime.sendMessage(message.request).then(reply => {
      window.postMessage({ source: "DBD_STATISTICS_EXTENSION", id: message.id, reply: { ...reply, extensionId: chrome.runtime.id } }, location.origin);
    }).catch(() => {
      window.postMessage({ source: "DBD_STATISTICS_EXTENSION", id: message.id, reply: { ok: false, error: "L’extension a été mise à jour. Réessayez la connexion." } }, location.origin);
    });
  });
  window.postMessage({ source: "DBD_STATISTICS_EXTENSION", type: "READY" }, location.origin);
})();
