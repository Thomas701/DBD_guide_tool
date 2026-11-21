(async () => {
  const { createStatisticsParser, hasCompleteMatchDetails, prioritizeMatchRetries } = await import(chrome.runtime.getURL("statistics-parser.mjs"));
  const { matchHistoryIdentity } = await import(chrome.runtime.getURL("match-history-identity.mjs"));
  const { readBehaviourIdentity } = await import(chrome.runtime.getURL("behaviour-session.mjs"));
  const parser = createStatisticsParser(matchHistoryIdentity);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function hash(value, algorithm = "SHA-256") {
    return [...new Uint8Array(await crypto.subtle.digest(algorithm, new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  async function fingerprint() {
    // Read only the JWT subject locally; the token and cookies never leave this tab.
    const identity = readBehaviourIdentity(localStorage.getItem("auth-store"));
    return identity ? hash(identity) : null;
  }
  async function waitFor(selector, timeout = 15_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const element = document.querySelector(selector);
      if (element) return element;
      await delay(250);
    }
    return null;
  }
  async function overview() {
    const section = await waitFor('[data-cy="General-Stats-section"]');
    if (!section) return { ok: false, error: "Connectez-vous à Behaviour dans l’onglet Statistiques, puis réessayez." };
    const read = name => section.querySelector(`[data-cy="${name}"]`)?.textContent?.trim();
    const statistics = {
      hoursPlayed: read("Total-hours-played-in-matches-value"),
      matchesPlayed: read("Total-matches-played-value"),
      bloodpointsEarned: read("Total-Bloodpoints-earned-value"),
      sourceUrl: "https://stats.deadbydaylight.com/statistics/",
    };
    if (!statistics.hoursPlayed || !statistics.matchesPlayed || !statistics.bloodpointsEarned) throw new Error("Les statistiques Behaviour ne sont pas encore disponibles.");
    return { ok: true, statistics, fingerprint: await fingerprint() };
  }
  async function enrich(card, entry) {
    card.click();
    const root = await waitFor(parser.MATCH_DETAIL_ROOT_SELECTOR, 3_000);
    if (!root) return entry;
    try {
      const participants = entry.participants.map(participant => ({ ...participant }));
      const emblems = parser.extractEmblemsFromHtml(root.outerHTML);
      const mainDuration = root.querySelector(parser.DURATION_VALUE_SELECTOR)?.textContent;
      const used = new Set();
      const buttons = [...root.querySelectorAll(parser.PLAYER_BUTTON_SELECTOR)];
      for (const button of buttons) {
        const portrait = parser.extractImageAssets(button.outerHTML).find(asset => parser.isCharacterAssetUrl(asset.url));
        const score = parser.parseDisplayNumber(button.textContent ?? "");
        let index = participants.findIndex((participant, i) => !used.has(i) && participant.imageUrl === portrait?.url && participant.score === score);
        if (index < 0) index = participants.findIndex((participant, i) => !used.has(i) && participant.imageUrl === portrait?.url);
        if (index < 0) continue;
        used.add(index); button.click();
        await delay(200);
        const details = [...root.querySelectorAll('[data-cy$="-match-details"]')].at(-1);
        if (details) participants[index] = { ...participants[index], ...parser.extractParticipantLoadoutFromHtml(details.outerHTML), ...parser.extractEmblemsFromHtml(details.outerHTML), survivalTimeLabel: parser.extractDurationLabel([...root.querySelectorAll(parser.DURATION_VALUE_SELECTOR)].at(1)?.textContent ?? "") };
        root.querySelector('[data-cy="back-btn"]')?.click();
        await delay(100);
      }
      return { ...entry, participants, ...emblems, survivalTimeLabel: entry.role === "survivor" ? parser.extractDurationLabel(mainDuration ?? "") : entry.survivalTimeLabel };
    } finally {
      root.querySelector('[data-cy="modal-close-btn"]')?.click();
      await delay(150);
    }
  }
  async function history(knownMatches, attemptedMatches) {
    const identity = await fingerprint();
    if (!identity) throw new Error("Session Behaviour indisponible. Reconnectez-vous au site officiel.");
    await waitFor(parser.MATCH_CARD_SELECTOR, 8_000);
    let previousCount = -1;
    for (let step = 0; step < 12; step++) {
      const count = document.querySelectorAll(parser.MATCH_CARD_SELECTOR).length;
      if (count === previousCount) break;
      previousCount = count;
      window.scrollTo(0, document.documentElement.scrollHeight);
      await delay(350);
    }
    const cards = [...document.querySelectorAll(parser.MATCH_CARD_SELECTOR)].slice(0, 200);
    const matches = [];
    const known = new Set(knownMatches);
    const candidates = [];
    let parsedCount = 0;
    for (const card of cards) {
      const entry = parser.extractMatchHistoryEntriesFromHtml(card.outerHTML, "https://stats.deadbydaylight.com/match-history/")[0];
      if (!entry) continue;
      parsedCount++;
      entry.id = await hash(entry.id, "SHA-1");
      if (known.has(entry.id)) continue;
      candidates.push({ card, entry });
    }
    for (const { card, entry } of prioritizeMatchRetries(candidates, attemptedMatches)) {
      matches.push(await enrich(card, entry));
      // shortcut: import 20 detailed matches per pass; subsequent polls continue the initial archive.
      if (matches.length >= 20) break;
    }
    if (cards.length && !parsedCount) throw new Error("Le format de l’historique Behaviour a changé. Les données existantes sont conservées.");
    return { ok: true, matches, fingerprint: identity, completeMatchIds: matches.filter(hasCompleteMatchDetails).map(match => match.id) };
  }
  let running = null;
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== "DBD_COLLECT") return false;
    running ??= (message.kind === "overview" ? overview() : history(Array.isArray(message.knownMatches) ? message.knownMatches : [], Array.isArray(message.attemptedMatches) ? message.attemptedMatches : [])).finally(() => { running = null; });
    void running.then(respond).catch(cause => respond({ ok: false, error: cause instanceof Error ? cause.message : "Lecture impossible." }));
    return true;
  });
  let announced = false;
  const observer = new MutationObserver(() => {
    if (!announced && document.querySelector('[data-cy="General-Stats-section"]')) {
      announced = true;
      void chrome.runtime.sendMessage({ type: "DBD_STATISTICS_READY" }).catch(() => undefined);
      observer.disconnect();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.querySelector('[data-cy="General-Stats-section"]')) {
    announced = true; observer.disconnect();
    void chrome.runtime.sendMessage({ type: "DBD_STATISTICS_READY" }).catch(() => undefined);
  }
})();
