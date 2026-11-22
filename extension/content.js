(() => {
  let lastSession = "";
  function readSession() {
    try {
      const state = JSON.parse(localStorage.getItem("auth-store"))?.state;
      const providers = JSON.parse(localStorage.getItem("providers-store"))?.state;
      return state?.authToken?.token ? { authToken: state.authToken, refreshToken: state.refreshToken, provider: providers?.selectedProvider ?? providers?.defaultProvider } : null;
    } catch { return null; }
  }
  function publish() {
    const session = readSession(), serialized = JSON.stringify(session);
    if (!session || serialized === lastSession) return;
    lastSession = serialized;
    void chrome.runtime.sendMessage({ type: "DBD_BEHAVIOUR_SESSION", session }).catch(() => { lastSession = ""; });
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message?.type === "DBD_READ_BEHAVIOUR_SESSION") { respond(readSession()); return false; }
    if (message?.type === "DBD_BEHAVIOUR_REFRESH") {
      try {
        const raw = localStorage.getItem("auth-store"), store = JSON.parse(raw);
        // Never apply another player's session to a Behaviour tab.
        const subject = token => JSON.parse(atob(token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/"))).sub;
        if (subject(store.state.authToken.token) !== subject(message.session.authToken.token)) return false;
        if (store.state.authToken.expirationDate >= message.session.authToken.expirationDate) return false;
        Object.assign(store.state, { authToken: message.session.authToken, refreshToken: message.session.refreshToken });
        const next = JSON.stringify(store); localStorage.setItem("auth-store", next);
        lastSession = JSON.stringify(readSession());
        window.dispatchEvent(new StorageEvent("storage", { key: "auth-store", oldValue: raw, newValue: next, storageArea: localStorage }));
      } catch { /* The user may have signed out in this tab. */ }
    }
    return false;
  });
  window.addEventListener("storage", publish);
  setInterval(publish, 5_000);
  publish();
})();
