import { buildMatchHistoryEntryId } from "./match-history-id.mjs";
export { buildMatchHistoryEntryId } from "./match-history-id.mjs";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";

import { chromium } from "playwright";

const STATISTICS_URL = "https://stats.deadbydaylight.com/statistics/";
const MATCH_HISTORY_URL = "https://stats.deadbydaylight.com/match-history/";
const MATCH_HISTORY_HTML_EXAMPLE_FILE = resolve(process.cwd(), ".data/examples/match-history-page.example.html");
const MATCH_DETAIL_HTML_EXAMPLE_FILE = resolve(process.cwd(), ".data/examples/match-history-detail.example.html");

export class DbdStatisticsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DbdStatisticsError";
    this.code = code;
  }
}

export function statisticsBrowserExecutable() {
  const candidates = process.platform === "win32"
    ? [process.env.ProgramFiles ?? "C:\\Program Files", process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean).map(root => join(root, "Google", "Chrome", "Application", "chrome.exe"))
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"];
  const executable = candidates.find(path => existsSync(path));
  if (!executable) throw new DbdStatisticsError("BROWSER_NOT_FOUND", "Google Chrome est nécessaire à la connexion Behaviour. Relancez « Lancer Build Analyzer.bat » sous Windows pour l’installer, ou installez Google Chrome depuis google.com/chrome.");
  return executable;
}

export class DbdStatisticsProvider {
  #browser = null;
  #currentSync = null;
  #currentShowPage = null;
  #loginOpening = null;
  #port = 9333;
  #profilePath = resolve(process.cwd(), ".data/dbd-statistics-chrome-profile");
  #status = createStatisticsSyncStatus();

  async connect(options = {}) {
    if (this.#currentSync) {
      this.#pushLog("Synchronisation déjà en cours. Réutilisation de la tâche existante.");
      return this.#currentSync;
    }
    try {
      statisticsBrowserExecutable();
    } catch (error) {
      this.#fail(error.message);
      throw error;
    }

    this.#begin("Préparation de la synchronisation des statistiques DBD.");
    this.#currentSync = this.#runConnect(options)
      .then((snapshot) => {
        const message = snapshot.matchHistory.length > 0
          ? `Synchronisation terminée. ${snapshot.matchHistory.length} partie(s) détectée(s).`
          : "Synchronisation terminée. Aucune partie détectée dans l’historique affiché.";
        this.#succeed(message);
        return snapshot;
      })
      .catch((error) => {
        this.#fail(error instanceof Error ? error.message : String(error));
        throw error;
      })
      .finally(() => {
        this.#currentSync = null;
      });
    return this.#currentSync;
  }

  status() {
    return cloneStatisticsSyncStatus(this.#status);
  }

  async showPage(targetUrl) {
    const matcher = isStatisticsUrl(targetUrl) ? isStatisticsUrl : isMatchHistoryUrl(targetUrl) ? isMatchHistoryUrl : null;
    if (!matcher) throw new DbdStatisticsError("INVALID_URL", "Cette page ne fait pas partie du site Statistiques DBD autorisé.");
    if (this.#currentSync) {
      if (this.#status.phase === "waiting_for_login" && this.#browser?.isConnected()) await this.#startLoginIfNeeded(this.#browser);
      return { url: targetUrl };
    }
    if (this.#currentShowPage) return this.#currentShowPage;
    this.#currentShowPage = this.#showPage(targetUrl, matcher).finally(() => { this.#currentShowPage = null; });
    return this.#currentShowPage;
  }

  async #showPage(targetUrl, matcher) {
    if (!this.#currentSync && await this.#chromeIsHeadless()) await this.#closeBrowser();
    await this.#ensureChrome(false);
    const browser = await this.#getBrowser();
    const page = await this.#openTrackedPage(browser, targetUrl, matcher, true);
    if (!await this.#startLoginIfNeeded(browser)) await page.bringToFront().catch(() => undefined);
    return { url: page.url() };
  }

  async #runConnect(options = {}) {
    await mkdir(this.#profilePath, { recursive: true });
    this.#update("preparing", "Profil local prêt. Vérification de la session Chrome.");

    if (this.#currentShowPage) await this.#currentShowPage;
    this.#update("starting_browser", "Vérification de la session et lecture en arrière-plan.");
    await this.#ensureChrome(true);
    try {
      let browser = await this.#getBrowser();
      const headless = await this.#chromeIsHeadless();
      const snapshot = await this.#waitForStatistics(browser, headless ? 15_000 : 10 * 60_000, options, !headless);
      if (snapshot) return snapshot;
      if (!await this.#loginIsRequired(browser)) throw new DbdStatisticsError("STATISTICS_UNAVAILABLE", "La page Statistiques ne répond pas correctement. Aucune reconnexion manuelle n’est nécessaire.");
      if (!headless) throw new DbdStatisticsError("LOGIN_TIMEOUT", "Connexion non détectée. Connectez-vous dans la fenêtre Chrome ouverte.");

      await this.#closeBrowser();
      this.#update("waiting_for_login", "Connexion requise. Réutilisation d’une seule fenêtre Chrome dédiée.");
      await this.#ensureChrome(false);
      browser = await this.#getBrowser();
      const connected = await this.#waitForStatistics(browser, 10 * 60_000, options, true);
      if (connected) return connected;
      throw new DbdStatisticsError("LOGIN_TIMEOUT", "Connexion non détectée. Connectez-vous dans la fenêtre Chrome ouverte.");
    } finally {
      if (await this.#chromeIsHeadless()) await this.#closeBrowser();
    }
  }

  async #ensureChrome(headless) {
    if (!await this.#chromeIsRunning()) this.#openChrome(headless);
    await this.#waitForChrome();
  }

  #openChrome(headless) {
    const process = spawn(statisticsBrowserExecutable(), [
      `--remote-debugging-port=${this.#port}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${this.#profilePath}`,
      "--no-first-run",
      "--no-default-browser-check",
      headless ? "--headless=new" : "--new-window",
      STATISTICS_URL
    ], { detached: true, stdio: "ignore", windowsHide: headless });
    process.unref();
  }

  async #waitForChrome() {
    const deadline = Date.now() + 15_000;
    let lastLogAt = 0;
    while (Date.now() < deadline) {
      if (await this.#chromeIsRunning()) return;
      if (Date.now() - lastLogAt >= 4_000) {
        this.#pushLog("Chrome démarre… attente du port de débogage distant.");
        lastLogAt = Date.now();
      }
      await delay(250);
    }
    throw new DbdStatisticsError("BROWSER_START_FAILED", "Chrome n’a pas démarré dans le délai prévu.");
  }

  async #chromeIsRunning() {
    try {
      const response = await fetch(`http://127.0.0.1:${this.#port}/json/version`, { signal: AbortSignal.timeout(500) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async #chromeIsHeadless() {
    try {
      const response = await fetch(`http://127.0.0.1:${this.#port}/json/version`, { signal: AbortSignal.timeout(500) });
      const version = await response.json();
      return typeof version?.["User-Agent"] === "string" && version["User-Agent"].includes("HeadlessChrome/");
    } catch {
      return false;
    }
  }

  async #getBrowser() {
    if (this.#browser?.isConnected()) return this.#browser;
    try {
      this.#pushLog("Connexion au navigateur via le port CDP local.");
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.#port}`);
      this.#browser = browser;
      browser.on("disconnected", () => { if (this.#browser === browser) this.#browser = null; });
      return browser;
    } catch (error) {
      throw new DbdStatisticsError("BROWSER_CONNECTION_FAILED", error instanceof Error ? error.message : String(error));
    }
  }

  async #closeBrowser() {
    const browser = this.#browser;
    this.#browser = null;
    if (browser?.isConnected()) {
      const session = await browser.newBrowserCDPSession().catch(() => null);
      await session?.send("Browser.close").catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
    let deadline = Date.now() + 1_500;
    while (Date.now() < deadline && await this.#chromeIsRunning()) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (await this.#chromeIsRunning()) await stopProcessListeningOnPort(this.#port);
    deadline = Date.now() + 5_000;
    while (Date.now() < deadline && await this.#chromeIsRunning()) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (await this.#chromeIsRunning()) {
      throw new DbdStatisticsError("BROWSER_STOP_FAILED", "La session Chrome dédiée n’a pas pu être arrêtée pour changer de mode de lecture.");
    }
  }

  async #waitForStatistics(browser, timeout, options = {}, interactive = false) {
    const deadline = Date.now() + timeout;
    let lastWaitingLogAt = 0;
    let loginStarted = false;
    let reopenedStatistics = false;
    this.#update("reading_statistics", "Recherche de la page Statistiques générales.");
    await this.#openTrackedPage(browser, STATISTICS_URL, isStatisticsUrl, true);
    while (Date.now() < deadline) {
      const statistics = await this.#readGeneralStatistics(browser);
      if (statistics) {
        if (interactive) {
          this.#update("preparing", "Connexion détectée. Fermeture de la fenêtre et poursuite en arrière-plan.");
          await this.#closeBrowser();
          await this.#ensureChrome(true);
          browser = await this.#getBrowser();
        }
        this.#update("reading_history", "Statistiques générales détectées. Lecture de l’historique des parties.");
        // The login deadline must not shorten the time allowed for history hydration.
        const matchHistory = await this.#readMatchHistory(browser, 15_000, options);
        return {
          updatedAt: new Date().toISOString(),
          statistics,
          matchHistory
        };
      }
      if (!interactive && await this.#loginIsRequired(browser)) return null;
      if (interactive && !loginStarted) loginStarted = await this.#startLoginIfNeeded(browser);
      if (interactive && loginStarted && !reopenedStatistics) reopenedStatistics = await this.#openStatisticsAfterLogin(browser);
      if (Date.now() - lastWaitingLogAt >= 4_000) {
        this.#update("waiting_for_login", loginStarted
          ? "Connexion requise dans la fenêtre Chrome dédiée à l’application."
          : "En attente d’une session connectée sur la page Statistiques officielle.");
        lastWaitingLogAt = Date.now();
      }
      await delay(500);
    }
    return null;
  }

  async #loginIsRequired(browser) {
    for (const page of browser.contexts().flatMap((context) => context.pages())) {
      if (page.url().startsWith("https://account.bhvr.com/")) return true;
      if (await page.locator("[data-cy='login-btn']").isVisible().catch(() => false)) return true;
    }
    return false;
  }

  async #startLoginIfNeeded(browser) {
    if (this.#loginOpening) return this.#loginOpening;
    this.#loginOpening = this.#openLogin(browser).finally(() => { this.#loginOpening = null; });
    return this.#loginOpening;
  }

  async #openLogin(browser) {
    const pages = browser.contexts().flatMap((context) => context.pages()).slice().reverse();
    const accountPage = pages.find((page) => page.url().startsWith("https://account.bhvr.com/"));
    if (accountPage) {
      await accountPage.bringToFront().catch(() => undefined);
      return true;
    }
    for (const page of pages) {
      const loginButton = page.locator("[data-cy='login-btn']");
      if (!await loginButton.isVisible().catch(() => false)) continue;
      this.#update("waiting_for_login", "Le Chrome contrôlé est déconnecté (la session de votre Chrome habituel est distincte). Ouverture de la connexion Behaviour.");
      await page.bringToFront().catch(() => undefined);
      await loginButton.evaluate((button) => button.click());
      await delay(250);
      const openedAccountPage = browser.contexts().flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith("https://account.bhvr.com/"));
      await openedAccountPage?.bringToFront().catch(() => undefined);
      return true;
    }
    return false;
  }

  async #openStatisticsAfterLogin(browser) {
    for (const context of browser.contexts().slice().reverse()) {
      for (const page of context.pages().slice().reverse()) {
        if (!isStatisticsSiteUrl(page.url()) || isStatisticsUrl(page.url())) continue;
        if (await page.locator("body").getAttribute("data-auth").catch(() => null) !== "true") continue;
        this.#pushLog("Session connectée détectée. Ouverture de la page Statistiques.");
        const statisticsPage = browser.contexts().flatMap(context => context.pages()).find(candidate => isStatisticsUrl(candidate.url())) ?? page;
        await statisticsPage.goto(STATISTICS_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
        return true;
      }
    }
    return false;
  }

  async #readGeneralStatistics(browser) {
    for (const context of browser.contexts().slice().reverse()) {
      for (const page of context.pages().slice().reverse()) {
        const section = page.locator("[data-cy='General-Stats-section']");
        if (!await section.isVisible().catch(() => false)) continue;
        this.#pushLog("Section des statistiques générales détectée.");
        const read = async (name) => (await section.locator(`[data-cy='${name}']`).innerText()).trim();
        return {
          hoursPlayed: await read("Total-hours-played-in-matches-value"),
          matchesPlayed: await read("Total-matches-played-value"),
          bloodpointsEarned: await read("Total-Bloodpoints-earned-value"),
          sourceUrl: page.url()
        };
      }
    }
    return null;
  }

  async #readMatchHistory(browser, timeout, options = {}) {
    this.#update("reading_history", "Ouverture ou réutilisation de la page Match History.");
    const page = await this.#openTrackedPage(browser, MATCH_HISTORY_URL, isMatchHistoryUrl);
    await page.setViewportSize({ width: 1600, height: 1600 }).catch(() => undefined);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    const deadline = Date.now() + timeout;
    let bestHistory = [];
    let savedExample = false;
    let lastLogAt = 0;
    let lastButtonCount = -1;
    let stableBottomIterations = 0;
    const knownMatchIds = new Set(Array.isArray(options.knownMatchIds) ? options.knownMatchIds.filter((value) => typeof value === "string" && value) : []);
    const incompleteMatchIds = new Set(Array.isArray(options.incompleteMatchIds) ? options.incompleteMatchIds.filter((value) => typeof value === "string" && value) : []);
    let reachedKnownMatch = false;
    while (Date.now() < deadline) {
      const html = await page.content().catch(() => "");
      const buttonCount = countMatchHistoryButtonsFromHtml(html);
      const importedAt = new Date();
      const matchHistory = extractMatchHistoryEntriesFromHtml(html, page.url(), importedAt);
      const { selected, newHistory, pendingFound } = selectMatchesForEnrichment(matchHistory, knownMatchIds, incompleteMatchIds);
      if (!savedExample && buttonCount > 0) {
        await saveMatchHistoryHtmlExample(html).catch(() => undefined);
        this.#pushLog(`Snapshot HTML enregistré dans ${relative(process.cwd(), MATCH_HISTORY_HTML_EXAMPLE_FILE).replaceAll("\\", "/")}.`);
        savedExample = true;
      }
      if (buttonCount !== lastButtonCount) {
        this.#pushLog(`${buttonCount} bouton(s) d’historique détecté(s) dans le DOM.`);
        lastButtonCount = buttonCount;
      }
      if (selected.length > bestHistory.length) {
        bestHistory = selected;
        this.#pushLog(`Extraction HTML: ${matchHistory.length} carte(s) normalisée(s), ${bestHistory.length} à détailler.`);
      }
      if (newHistory.reachedKnownMatch && pendingFound) {
        if (matchHistory.length < buttonCount) {
          await delay(350);
          continue;
        }
        bestHistory = selected;
        reachedKnownMatch = true;
        this.#pushLog("Match déjà présent détecté et anciennes parties incomplètes retrouvées. Arrêt de la lecture de l’historique.");
        break;
      }
      if (bestHistory.length > 0 || newHistory.reachedKnownMatch) {
        const scrollState = await scrollMatchHistoryPage(page);
        if (scrollState.atBottom) stableBottomIterations += 1;
        else stableBottomIterations = 0;
        if (stableBottomIterations >= 2 && matchHistory.length >= buttonCount) {
          break;
        }
        await delay(350);
        continue;
      }
      if (Date.now() - lastLogAt >= 3_000) {
        if (buttonCount > 0) this.#pushLog(`Les cartes sont présentes dans le DOM (${buttonCount}), mais aucune n’a encore été normalisée.`);
        else this.#pushLog("Page Match History chargée, mais aucun bouton de partie n’a encore été détecté.");
        lastLogAt = Date.now();
      }
      const scrollState = await scrollMatchHistoryPage(page);
      if (buttonCount > 0 && scrollState.atBottom) break;
      await delay(350);
    }
    if (bestHistory.length > 0) {
      this.#pushLog(`Historique détecté: ${bestHistory.length} partie(s) à détailler.`);
      return await this.#enrichNewMatchHistory(page, bestHistory);
    }
    if (reachedKnownMatch) return [];
    this.#pushLog("Lecture terminée sans carte d’historique exploitable.");
    return [];
  }

  async #saveMatchHistoryExample(html) {
    await saveMatchHistoryHtmlExample(html);
  }

  async #enrichNewMatchHistory(page, entries) {
    await closeMatchDetailModal(page).catch(() => undefined);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "auto" })).catch(() => undefined);
    const detailed = [];
    for (const { index, entry } of entries) {
      this.#update("reading_details", `Lecture détaillée du match ${entry.playedAtLabel ?? entry.characterName}.`);
      try {
        detailed.push(await readMatchDetailsFromPage(page, index, entry, this.#pushLog.bind(this)));
      } catch (error) {
        // Keep the new card; missing participant equipment is retried on the next sync.
        detailed.push(entry);
        this.#pushLog(`Match enregistré. Nouvelle tentative possible si la partie reste en ligne: ${String(error.message ?? error).split("\n")[0].replace(/\x1b\[[0-9;]*m/g, "")}`);
        await closeMatchDetailModal(page).catch(() => undefined);
      }
    }
    await closeMatchDetailModal(page).catch(() => undefined);
    return detailed;
  }

  async #openTrackedPage(browser, targetUrl, matcher, reuseSitePage = false) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const trackedPages = pages.filter((page) => matcher(page.url()));
    const trackedPage = trackedPages[0];
    if (trackedPage) {
      await Promise.all(trackedPages.slice(1).map(page => page.close().catch(() => undefined)));
      this.#pushLog(`Page réutilisée: ${trackedPage.url()}`);
      if (!reuseSitePage) await trackedPage.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
      return trackedPage;
    }
    const context = browser.contexts()[0];
    if (!context) throw new DbdStatisticsError("BROWSER_CONNECTION_FAILED", "Chrome n’a fourni aucun contexte de navigation exploitable.");
    const page = reuseSitePage
      ? pages.findLast((candidate) => isStatisticsSiteUrl(candidate.url())) ?? await context.newPage()
      : await context.newPage();
    this.#pushLog(`Ouverture de ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    return page;
  }

  #begin(message) {
    this.#status = {
      ...createStatisticsSyncStatus(),
      busy: true,
      phase: "starting",
      message,
      startedAt: new Date().toISOString(),
      logs: [{ at: new Date().toISOString(), message }],
      lastSuccessAt: this.#status.lastSuccessAt
    };
  }

  #update(phase, message) {
    this.#status.busy = true;
    this.#status.phase = phase;
    this.#status.message = message;
    this.#appendLog(message);
  }

  #pushLog(message) {
    if (!message || this.#status.logs.at(-1)?.message === message) return;
    this.#appendLog(message);
  }

  #appendLog(message) {
    const nextLog = { at: new Date().toISOString(), message };
    this.#status.logs = [...this.#status.logs, nextLog].slice(-20);
  }

  #succeed(message) {
    this.#status.busy = false;
    this.#status.phase = "success";
    this.#status.message = message;
    this.#status.finishedAt = new Date().toISOString();
    this.#status.lastSuccessAt = this.#status.finishedAt;
    this.#status.error = null;
    this.#appendLog(message);
  }

  #fail(message) {
    this.#status.busy = false;
    this.#status.phase = "error";
    this.#status.message = message;
    this.#status.finishedAt = new Date().toISOString();
    this.#status.error = message;
    this.#appendLog(message);
  }
}

export function isStatisticsUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "stats.deadbydaylight.com" && /\/statistics\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isMatchHistoryUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "stats.deadbydaylight.com" && /\/match-history\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function isStatisticsSiteUrl(value) {
  try {
    return new URL(value).hostname === "stats.deadbydaylight.com";
  } catch {
    return false;
  }
}

export function takeMatchesUntilKnown(entries, knownMatchIds) {
  const firstKnownIndex = entries.findIndex((entry) => knownMatchIds.has(entry.id));
  return {
    entries: firstKnownIndex < 0 ? entries : entries.slice(0, firstKnownIndex),
    reachedKnownMatch: firstKnownIndex >= 0
  };
}

export function selectMatchesForEnrichment(entries, knownMatchIds, incompleteMatchIds) {
  const newHistory = takeMatchesUntilKnown(entries, knownMatchIds);
  const selected = entries.flatMap((entry, index) => index < newHistory.entries.length || incompleteMatchIds.has(entry.id) ? [{ entry, index }] : []);
  const foundIds = new Set(entries.map((entry) => entry.id));
  return { selected, newHistory, pendingFound: [...incompleteMatchIds].every((id) => foundIds.has(id)) };
}

export function normalizeMatchHistoryCard(rawCard, sourceUrl, referenceDate = new Date()) {
  if (!isRecord(rawCard)) return null;
  const textLines = uniqueStrings(Array.isArray(rawCard.textLines) ? rawCard.textLines : []);
  const characterName = findCharacterName(textLines);
  const playedAtLabel = textLines.find(isDateLabel) ?? null;
  const durationLabel = textLines.find(isDurationLabel) ?? null;
  const queueLabel = textLines.find((line) => /^(?:\d+v\d+|Lights Out)$/i.test(line)) ?? null;
  const resultLabel = textLines.find(isResultLabel) ?? null;
  const primaryScoreLine = findPrimaryScoreLine(textLines);
  const scoreLines = textLines.filter(isScoreLine);
  const participantScoreLines = scoreLines.filter((line, index) => line !== primaryScoreLine || index !== scoreLines.indexOf(primaryScoreLine));
  const participants = zipParticipants(stringArray(rawCard.participantImageUrls), participantScoreLines);
  const mapName = findMapName(textLines, { characterName, playedAtLabel, durationLabel, queueLabel, resultLabel, primaryScoreLine, participantScoreLines });
  const perkIconUrls = stringArray(rawCard.loadoutIconUrls).slice(0, 4);
  const equipmentIconUrls = stringArray(rawCard.loadoutIconUrls).slice(4);
  const perkIconLabels = stringArray(rawCard.loadoutIconLabels).slice(0, perkIconUrls.length);
  const equipmentIconLabels = stringArray(rawCard.loadoutIconLabels).slice(4, 4 + equipmentIconUrls.length);
  const importedAt = referenceDate.toISOString();

  if (!characterName && !mapName && !playedAtLabel && perkIconUrls.length === 0 && participants.length === 0) return null;

  const entry = {
    id: "",
    role: inferRole(resultLabel),
    characterName: characterName ?? "Match inconnu",
    resultLabel,
    score: primaryScoreLine ? parseScore(primaryScoreLine) : null,
    characterImageUrl: normalizeUrl(rawCard.characterImageUrl),
    perkIconUrls,
    perkIconLabels,
    equipmentIconUrls,
    equipmentIconLabels,
    participants,
    mapName,
    mapImageUrl: normalizeUrl(rawCard.mapImageUrl),
    playedAt: playedAtLabel ? parseMatchDateLabel(playedAtLabel, referenceDate) : null,
    playedAtLabel,
    durationLabel,
    queueLabel,
    sourceUrl: normalizeUrl(sourceUrl) ?? MATCH_HISTORY_URL,
    importedAt
  };
  entry.id = buildMatchHistoryEntryId(entry);
  return entry;
}

export function parseMatchDateLabel(value, referenceDate = new Date()) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = /^(?<month>[A-Za-zÀ-ÿ.]+)\s+(?<day>\d{1,2}),\s+(?<hour>\d{1,2}):(?<minute>\d{2})\s+(?<period>[AP]M)$/i.exec(value.trim());
  const monthIndex = monthIndexFromLabel(parsed?.groups?.month ?? "");
  const day = Number.parseInt(parsed?.groups?.day ?? "", 10);
  const hour12 = Number.parseInt(parsed?.groups?.hour ?? "", 10);
  const minute = Number.parseInt(parsed?.groups?.minute ?? "", 10);
  const period = parsed?.groups?.period?.toUpperCase();
  if (monthIndex < 0 || !Number.isInteger(day) || !Number.isInteger(hour12) || !Number.isInteger(minute) || !period) return null;
  const hour = (hour12 % 12) + (period === "PM" ? 12 : 0);
  const candidate = new Date(Date.UTC(referenceDate.getUTCFullYear(), monthIndex, day, hour, minute));
  if (candidate.getTime() - referenceDate.getTime() > 36 * 60 * 60 * 1000) {
    candidate.setUTCFullYear(candidate.getUTCFullYear() - 1);
  }
  return candidate.toISOString();
}

export function extractMatchHistoryEntriesFromHtml(html, sourceUrl, referenceDate = new Date()) {
  if (typeof html !== "string" || !html.trim()) return [];
  const entries = [];
  for (const buttonHtml of matchHistoryButtonsFromHtml(html)) {
    const entry = parseMatchHistoryButtonHtml(buttonHtml, sourceUrl, referenceDate);
    if (entry) entries.push(entry);
  }
  return dedupeMatchHistoryEntries(entries);
}

export function countMatchHistoryButtonsFromHtml(html) {
  return matchHistoryButtonsFromHtml(html).length;
}

function findCharacterName(lines) {
  return lines.find((line) => !isResultLabel(line) && !isDateLabel(line) && !isDurationLabel(line) && !isScoreLine(line) && !isGenericLabel(line) && !/^\d+v\d+$/i.test(line)) ?? null;
}

function findMapName(lines, excluded) {
  const ignored = new Set([
    excluded.characterName,
    excluded.playedAtLabel,
    excluded.durationLabel,
    excluded.queueLabel,
    excluded.resultLabel,
    excluded.primaryScoreLine,
    ...excluded.participantScoreLines,
    "Score"
  ].filter(Boolean));
  const candidates = lines.filter((line) => !ignored.has(line) && !isScoreLine(line) && !isGenericLabel(line));
  return candidates.length > 1 ? candidates.at(-1) ?? null : candidates.find((line) => line !== excluded.characterName) ?? null;
}

function findPrimaryScoreLine(lines) {
  const scoreLabelIndex = lines.findIndex((line) => /^score$/i.test(line));
  if (scoreLabelIndex >= 0) return lines.slice(scoreLabelIndex + 1).find(isScoreLine) ?? null;
  return lines.find(isScoreLine) ?? null;
}

function zipParticipants(imageUrls, values) {
  return Array.from({ length: Math.max(imageUrls.length, values.length) }, (_, index) => ({
    name: null,
    role: roleFromCharacterUrl(imageUrls[index]),
    imageUrl: normalizeUrl(imageUrls[index]) ?? null,
    score: parseDisplayNumber(values[index]),
    valueLabel: normalizeStringValue(values[index]),
    survivalTimeLabel: extractDurationLabel(values[index]),
    resultLabel: defaultParticipantResultLabel(roleFromCharacterUrl(imageUrls[index]), null)
  }));
}

function inferRole(resultLabel) {
  if (!resultLabel) return "unknown";
  return /killer$/i.test(resultLabel) ? "killer" : /escaped|dead|sacrificed|killed|mori|disconnected/i.test(resultLabel) ? "survivor" : "unknown";
}

function isResultLabel(line) {
  return /killer$/i.test(line) || /^(escaped|dead|sacrificed|killed|mori(?:ed)?|disconnected)$/i.test(line);
}

function isDateLabel(line) {
  return /^(?:[A-Z][a-z]{2}|[A-Za-z]{3,9})\s+\d{1,2},\s+\d{1,2}:\d{2}\s+[AP]M$/.test(line);
}

function isDurationLabel(line) {
  return /^\d{1,2}:\d{2}$/.test(line);
}

function isScoreLine(line) {
  return /^\d{1,3}(?:,\d{3})*$/.test(line);
}

function isGenericLabel(line) {
  return /^score$/i.test(line);
}

function parseScore(value) {
  const numeric = Number.parseInt(value.replaceAll(",", ""), 10);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseDisplayNumber(value) {
  return typeof value === "string" && /^\d{1,3}(?:,\d{3})*$/.test(value.trim())
    ? parseScore(value.trim())
    : null;
}

function extractDurationLabel(value) {
  if (typeof value !== "string") return null;
  const matches = value.match(STANDALONE_DURATION_PATTERN);
  return matches?.at(-1) ?? null;
}

function normalizeStringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeUrl(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function roleFromCharacterUrl(url) {
  if (typeof url !== "string") return "unknown";
  if (/\/characters\/survivors\//i.test(url)) return "survivor";
  if (/\/characters\/killers\//i.test(url)) return "killer";
  return "unknown";
}

function defaultParticipantResultLabel(role, value) {
  const normalized = normalizeStringValue(value);
  if (normalized) return normalized;
  return role === "survivor" ? "Sacrificed" : null;
}

function matchHistoryButtonsFromHtml(html) {
  return [...html.matchAll(MATCH_HISTORY_BUTTON_PATTERN)].map((match) => match[0]);
}

function dedupeMatchHistoryEntries(entries) {
  const seen = new Map();
  for (const entry of entries) seen.set(entry.id, entry);
  return [...seen.values()];
}

function parseMatchHistoryButtonHtml(buttonHtml, sourceUrl, referenceDate) {
  const role = /data-cy\s*=\s*(["'])killer-match-card-btn\1/i.test(buttonHtml) ? "killer" : /data-cy\s*=\s*(["'])survivor-match-card-btn\1/i.test(buttonHtml) ? "survivor" : "unknown";
  const textContent = collapseText(stripHtml(buttonHtml));
  const characterName = extractTextByClassFragment(buttonHtml, MATCH_CHARACTER_NAME_CLASS_FRAGMENTS) ?? extractCharacterNameFromText(textContent);
  const playedAtLabel = extractDataCyText(buttonHtml, "match-date") ?? firstMatch(textContent, MATCH_DATE_PATTERN);
  const durationLabel = extractDataCyText(buttonHtml, "match-duration") ?? lastMatch(textContent, MATCH_DURATION_PATTERN);
  const mapName = extractDataCyText(buttonHtml, "match-map") ?? null;
  const scoreLabel = extractScoreLabel(buttonHtml, textContent);
  const queueLabel = extractDataCyText(buttonHtml, "match-mode")
    ?? extractTextByClassFragment(buttonHtml, ["font-sans inline-block overflow-hidden text-ellipsis whitespace-nowrap"])
    ?? firstMatch(textContent, /\b(?:\d+v\d+|Lights Out)\b/g);
  const resultLabel = extractResultLabel(queueLabel ? textContent.replaceAll(queueLabel, " ") : textContent, characterName, scoreLabel);
  const imageAssets = extractImageAssets(buttonHtml);
  const imageUrls = imageAssets.map((asset) => asset.url);
  const characterImageUrls = imageUrls.filter(isCharacterAssetUrl);
  const loadoutAssets = imageAssets.filter((asset) => isPerkAssetUrl(asset.url) || isEquipmentAssetUrl(asset.url));
  const perkAssets = loadoutAssets.filter((asset) => isPerkAssetUrl(asset.url));
  const equipmentAssets = loadoutAssets.filter((asset) => !isPerkAssetUrl(asset.url));
  const perkIconUrls = perkAssets.map((asset) => asset.url);
  const perkIconLabels = perkAssets.map((asset) => asset.label);
  const equipmentIconUrls = equipmentAssets.map((asset) => asset.url);
  const equipmentIconLabels = equipmentAssets.map((asset) => asset.label);
  const parsedParticipants = extractParticipantsFromButtonHtml(buttonHtml);
  const participantMetricLabels = extractParticipantMetricLabels(textContent, {
    characterName,
    scoreLabel,
    playedAtLabel,
    durationLabel,
    queueLabel,
    mapName,
    resultLabel,
  });
  const participants = parsedParticipants.length > 0 ? parsedParticipants : zipParticipants(characterImageUrls.slice(1), participantMetricLabels);
  // Hydration can expose a card before its map/date/duration have loaded.
  if (!characterName || !mapName || !playedAtLabel || !durationLabel) return null;
  const entry = {
    id: "",
    role,
    characterName: characterName ?? "Match inconnu",
    resultLabel,
    score: parseDisplayNumber(scoreLabel),
    characterImageUrl: characterImageUrls[0] ?? null,
    perkIconUrls,
    perkIconLabels,
    equipmentIconUrls,
    equipmentIconLabels,
    participants,
    mapName,
    mapImageUrl: imageUrls.find(isMapAssetUrl) ?? null,
    playedAt: playedAtLabel ? parseMatchDateLabel(playedAtLabel, referenceDate) : null,
    playedAtLabel,
    durationLabel,
    queueLabel,
    sourceUrl: normalizeUrl(sourceUrl) ?? MATCH_HISTORY_URL,
    importedAt: referenceDate.toISOString()
  };
  entry.id = buildMatchHistoryEntryId(entry);
  return entry;
}

function extractTextByClassFragment(html, classFragments) {
  for (const fragment of classFragments) {
    const pattern = new RegExp(`<[^>]+class=("|')[^"']*${escapeRegExp(fragment)}[^"']*\\1[^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
    const match = pattern.exec(html);
    const text = collapseText(stripHtml(match?.[2] ?? ""));
    if (text) return text;
  }
  return null;
}

function extractScoreLabel(html, textContent) {
  const explicit = firstMatch(collapseText(stripHtml(firstMatch(html, /Score<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i, 1) ?? "")), /.+/g);
  if (explicit) return explicit;
  const match = /\bScore\b\s*([\d,]+)/i.exec(textContent);
  return match?.[1] ?? null;
}

function extractResultLabel(textContent, characterName, scoreLabel) {
  const beforeScore = scoreLabel ? textContent.split(`Score ${scoreLabel}`)[0] : textContent.split(/\bScore\b/i)[0];
  if (!beforeScore) return null;
  if (characterName && beforeScore.includes(characterName)) {
    const value = beforeScore.replace(characterName, "").trim();
    return value || null;
  }
  return null;
}

function extractParticipantMetricLabels(textContent, context) {
  let segment = textContent;
  if (context.playedAtLabel && segment.includes(context.playedAtLabel)) segment = segment.split(context.playedAtLabel)[0] ?? segment;
  if (context.queueLabel) segment = segment.replace(context.queueLabel, " ");
  if (context.mapName) segment = segment.replace(context.mapName, " ");
  if (context.durationLabel) segment = segment.replace(context.durationLabel, " ");
  if (context.characterName) segment = segment.replace(context.characterName, " ");
  if (context.resultLabel) segment = segment.replace(context.resultLabel, " ");
  if (context.scoreLabel) {
    const marker = `Score ${context.scoreLabel}`;
    segment = segment.includes(marker)
      ? segment.split(marker).slice(1).join(marker)
      : segment.replace(/^.*?\bScore\b/i, " ");
  }
  segment = segment.replace(/\+/g, " ");
  return (segment.match(PARTICIPANT_VALUE_PATTERN) ?? []).map((value) => value.trim());
}

function extractCharacterNameFromText(textContent) {
  const beforeScore = textContent.split(/\bScore\b/i)[0]?.trim() ?? "";
  if (!beforeScore) return null;
  return beforeScore.split(/\s{2,}/).at(-1) ?? null;
}

function extractDataCyText(html, dataCy) {
  const pattern = new RegExp(`<[^>]+data-cy=("|')${escapeRegExp(dataCy)}\\1[^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
  const match = pattern.exec(html);
  const text = collapseText(stripHtml(match?.[2] ?? ""));
  return text || null;
}

function extractImageUrls(html) {
  return extractImageAssets(html).map((asset) => asset.url);
}

export function extractImageAssets(html) {
  return [...html.matchAll(/<img\b[^>]*>/gi)].flatMap((match) => {
    const url = extractHtmlAttribute(match[0], "src");
    if (!url) return [];
    const label = extractHtmlAttribute(match[0], "title") ?? extractHtmlAttribute(match[0], "alt");
    return [{ url: normalizeCapturedImageUrl(url), label: normalizeStringValue(decodeHtmlEntities(label ?? "")) }];
  });
}

function extractHtmlAttribute(html, name) {
  return new RegExp(`\\b${name}=("|')([^"']*)\\1`, "i").exec(html)?.[2] ?? null;
}

function extractParticipantsFromButtonHtml(buttonHtml) {
  return [...buttonHtml.matchAll(PARTICIPANT_BLOCK_PATTERN)].map((match) => {
    const imageUrl = normalizeCapturedImageUrl(match.groups?.imageUrl ?? "");
    const role = roleFromCharacterUrl(imageUrl);
    const valueLabel = normalizeStringValue(collapseText(stripHtml(match.groups?.valueLabel ?? "")));
    const statusLabel = normalizeStringValue(collapseText(stripHtml(match.groups?.statusLabel ?? "")));
    const participantBody = collapseText(stripHtml(match.groups?.participantBody ?? ""));
    const survivalTimeLabel = extractDurationLabel(participantBody);
    return {
      name: normalizeStringValue(collapseText(stripHtml(match.groups?.name ?? ""))),
      role,
      imageUrl: normalizeUrl(imageUrl),
      score: parseDisplayNumber(valueLabel),
      valueLabel,
      survivalTimeLabel: survivalTimeLabel && survivalTimeLabel !== valueLabel ? survivalTimeLabel : null,
      resultLabel: defaultParticipantResultLabel(role, statusLabel)
    };
  });
}

function normalizeCapturedImageUrl(value) {
  const decoded = decodeHtmlEntities(value);
  try {
    const absolute = new URL(decoded, MATCH_HISTORY_URL);
    const wrapped = absolute.searchParams.get("url");
    return wrapped ? new URL(wrapped, absolute.origin).toString() : absolute.toString();
  } catch {
    return decoded;
  }
}

function isCharacterAssetUrl(url) {
  return /assets\.live\.bhvraccount\.com\/characters\/(killers|survivors)\//i.test(url);
}

function isPerkAssetUrl(url) {
  return /assets\.live\.bhvraccount\.com\/perks\//i.test(url);
}

function isEquipmentAssetUrl(url) {
  return /assets\.live\.bhvraccount\.com\/(offerings|items|add-ons|characterClasses)\//i.test(url);
}

function isMapAssetUrl(url) {
  return /assets\.live\.bhvraccount\.com\/maps\//i.test(url);
}

function stripHtml(value) {
  return decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function collapseText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function firstMatch(value, pattern, group = 0) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const match = new RegExp(pattern.source, flags).exec(value);
  return match?.[group] ?? null;
}

function lastMatch(value, pattern) {
  const matches = [...value.matchAll(pattern.flags.includes("g") ? pattern : new RegExp(pattern.source, `${pattern.flags}g`))];
  return matches.at(-1)?.[0] ?? null;
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;|&#160;/gi, " ");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function saveMatchHistoryHtmlExample(html) {
  await mkdir(dirname(MATCH_HISTORY_HTML_EXAMPLE_FILE), { recursive: true });
  await writeFile(MATCH_HISTORY_HTML_EXAMPLE_FILE, html, "utf8");
}

async function scrollMatchHistoryPage(page) {
  return page.evaluate(() => {
    const scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const viewportHeight = window.innerHeight;
    const nextY = Math.min(window.scrollY + Math.max(viewportHeight * 0.85, 720), Math.max(0, scrollHeight - viewportHeight));
    window.scrollTo(0, nextY);
    return {
      scrollY: window.scrollY,
      scrollHeight,
      viewportHeight,
      atBottom: window.scrollY + viewportHeight >= scrollHeight - 4
    };
  }).catch(() => ({ scrollY: 0, scrollHeight: 0, viewportHeight: 0, atBottom: true }));
}

export async function readMatchDetailsFromPage(page, index, entry, pushLog = () => {}) {
  await closeMatchDetailModal(page);
  const cardButton = page.locator(MATCH_CARD_SELECTOR).nth(index);
  await cardButton.scrollIntoViewIfNeeded().catch(() => undefined);
  await clickMatchHistoryButton(cardButton);

  const detailRoot = await waitForMatchDetailRoot(page, entry);
  const modalHtml = await detailRoot.evaluate((node) => node.outerHTML).catch(() => "");
  if (modalHtml.trim()) await saveMatchDetailHtmlExample(modalHtml).catch(() => undefined);

  const participants = entry.participants.map((participant) => ({ ...participant }));
  const mainEmblems = extractEmblemsFromHtml(modalHtml);
  const survivalTimeLabel = entry.role === "survivor"
    ? extractDurationLabel(await detailRoot.locator(DURATION_VALUE_SELECTOR).first().innerText().catch(() => ""))
    : entry.survivalTimeLabel;
  const playerButtons = detailRoot.locator(PLAYER_BUTTON_SELECTOR);
  const playerCount = await playerButtons.count().catch(() => 0);
  if (playerCount > 0) pushLog(`Détail du match: ${playerCount} joueur(s) interactif(s) détecté(s).`);

  const used = new Set();
  for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
    const playerButton = playerButtons.nth(playerIndex);
    const buttonHtml = await playerButton.evaluate((node) => node.outerHTML);
    const imageUrl = extractImageUrls(buttonHtml).find(isCharacterAssetUrl);
    const score = parseDisplayNumber((await playerButton.innerText()).trim());
    let participantIndex = participants.findIndex((participant, i) => !used.has(i) && participant.imageUrl === imageUrl && participant.score === score);
    if (participantIndex < 0) participantIndex = participants.findIndex((participant, i) => !used.has(i) && participant.imageUrl === imageUrl);
    if (participantIndex < 0) continue;
    used.add(participantIndex);
    try {
      await clickMatchHistoryButton(playerButton);
      const duration = detailRoot.locator(DURATION_VALUE_SELECTOR).nth(1);
      await duration.waitFor({ state: "visible", timeout: 10_000 });
      const survivalTimeLabel = extractDurationLabel(await duration.innerText());
      const selectedHtml = await detailRoot.locator('[data-cy$="-match-details"]').last().evaluate(node => node.outerHTML);
      participants[participantIndex] = { ...participants[participantIndex], survivalTimeLabel, ...extractParticipantLoadoutFromHtml(selectedHtml), ...extractEmblemsFromHtml(selectedHtml) };
      await clickMatchHistoryButton(detailRoot.locator('[data-cy="back-btn"]'));
      await duration.waitFor({ state: "detached", timeout: 10_000 });
    } catch (error) {
      pushLog(`Équipement d’un participant indisponible: ${String(error.message ?? error).split("\n")[0]}`);
      await clickMatchHistoryButton(detailRoot.locator('[data-cy="back-btn"]')).catch(() => undefined);
    }
  }

  await closeMatchDetailModal(page).catch(() => undefined);
  return { ...entry, survivalTimeLabel, ...mainEmblems, participants };
}

export function extractEmblemsFromHtml(html) {
  const emblems = extractImageAssets(html).filter(asset => /assets\.live\.bhvraccount\.com\/emblems\//i.test(asset.url)).slice(0, 4);
  return { emblemIconUrls: emblems.map(asset => asset.url), emblemIconLabels: emblems.map(asset => asset.label) };
}

export function extractParticipantLoadoutFromHtml(html) {
  const assets = extractImageAssets(html);
  const perks = assets.filter((asset) => isPerkAssetUrl(asset.url)).slice(0, 4);
  const equipment = assets.filter((asset) => isEquipmentAssetUrl(asset.url));
  return {
    perkIconUrls: perks.map((asset) => asset.url),
    perkIconLabels: perks.map((asset) => asset.label),
    equipmentIconUrls: equipment.map((asset) => asset.url),
    equipmentIconLabels: equipment.map((asset) => asset.label),
  };
}

async function waitForMatchDetailRoot(page, entry) {
  const modalRoot = page.locator(MATCH_DETAIL_ROOT_SELECTOR).last();
  await modalRoot.waitFor({ state: "visible", timeout: 3_000 });
  return modalRoot;
}

async function closeMatchDetailModal(page) {
  const closeButton = page.locator('[data-cy="modal-close-btn"]').last();
  if (!await closeButton.isVisible().catch(() => false)) return;
  await clickMatchHistoryButton(closeButton);
  await page.locator(MATCH_DETAIL_ROOT_SELECTOR).last().waitFor({ state: "hidden", timeout: 5_000 });
}

async function clickMatchHistoryButton(locator) {
  // React animates/replaces these buttons. DOM activation avoids waiting for a stable position.
  await locator.waitFor({ state: "visible", timeout: 5_000 });
  await locator.evaluate(button => button.click(), undefined, { timeout: 5_000 });
}

async function saveMatchDetailHtmlExample(html) {
  await mkdir(dirname(MATCH_DETAIL_HTML_EXAMPLE_FILE), { recursive: true });
  await writeFile(MATCH_DETAIL_HTML_EXAMPLE_FILE, html, "utf8");
}

function monthIndexFromLabel(value) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return MONTH_LOOKUP[normalized] ?? -1;
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.flatMap((entry) => typeof entry === "string" && entry.trim() ? [entry.trim()] : [])
    : [];
}

function uniqueStrings(values) {
  const seen = new Set();
  return values.flatMap((value) => {
    if (typeof value !== "string") return [];
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return [];
    seen.add(trimmed);
    return [trimmed];
  });
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(timeout) {
  return new Promise((resolve) => setTimeout(resolve, timeout));
}

async function stopProcessListeningOnPort(port) {
  if (process.platform !== "win32") return;
  const output = await execFileOutput("netstat", ["-ano", "-p", "tcp"]);
  const processIds = listeningProcessIds(output, port);
  if (processIds.length !== 1) return;
  await execFileOutput("taskkill", ["/PID", processIds[0], "/T", "/F"]).catch(() => undefined);
}

export function listeningProcessIds(output, port) {
  return [...new Set(output.split(/\r?\n/).flatMap((line) => {
    const columns = line.trim().split(/\s+/);
    return columns.at(-2) === "LISTENING" && columns[1]?.endsWith(`:${port}`) && /^\d+$/.test(columns.at(-1) ?? "")
      ? [columns.at(-1)]
      : [];
  }))];
}

function execFileOutput(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr).trim() || error.message));
      else resolve(String(stdout));
    });
  });
}

function createStatisticsSyncStatus() {
  return {
    busy: false,
    phase: "idle",
    message: "Aucune synchronisation des statistiques en cours.",
    startedAt: null,
    finishedAt: null,
    lastSuccessAt: null,
    error: null,
    logs: []
  };
}

function cloneStatisticsSyncStatus(status) {
  return {
    ...status,
    logs: status.logs.map((entry) => ({ ...entry }))
  };
}

const MONTH_LOOKUP = {
  jan: 0,
  january: 0,
  janv: 0,
  janvier: 0,
  feb: 1,
  february: 1,
  fevr: 1,
  fevrier: 1,
  mar: 2,
  march: 2,
  mars: 2,
  apr: 3,
  april: 3,
  avr: 3,
  avril: 3,
  may: 4,
  mai: 4,
  jun: 5,
  june: 5,
  juin: 5,
  jul: 6,
  july: 6,
  juil: 6,
  juillet: 6,
  aug: 7,
  august: 7,
  aout: 7,
  septembre: 8,
  sep: 8,
  sept: 8,
  oct: 9,
  october: 9,
  octobre: 9,
  nov: 10,
  november: 10,
  novembre: 10,
  dec: 11,
  december: 11,
  decembre: 11
};

const MATCH_HISTORY_BUTTON_PATTERN = /<button\b(?=[^>]*\bdata-cy\s*=\s*("|')(killer-match-card-btn|survivor-match-card-btn)\1)[^>]*>[\s\S]*?<\/button>/giu;
const MATCH_DATE_PATTERN = /(?:[A-Z][a-z]{2}|[A-Za-z]{3,9})\s+\d{1,2},\s+\d{1,2}:\d{2}\s+[AP]M/g;
const MATCH_DURATION_PATTERN = /\b\d{1,2}:\d{2}\b/g;
const PARTICIPANT_VALUE_PATTERN = /\d{1,3}(?:,\d{3})*|\d{1,2}:\d{2}/g;
const STANDALONE_DURATION_PATTERN = /\b\d{1,2}:\d{2}\b/g;
const PARTICIPANT_BLOCK_PATTERN = /<img\b[^>]*alt="(?<name>[^"]+)"[^>]*title="[^"]*"[^>]*class="[^"]*absolute w-\[120%\] max-w-none[^"]*"[^>]*src="(?<imageUrl>[^"]+)"[^>]*>[\s\S]{0,300}?<span\b[^>]*class="[^"]*text-md text-neutral-text-light font-sans text-nowrap[^"]*"[^>]*>(?<valueLabel>[\s\S]*?)<\/span>(?<participantBody>[\s\S]{0,220}?)(?:<img\b[^>]*alt="(?<statusLabel>[^"]+)"[^>]*class="[^"]*size-8[^"]*"[^>]*>)?/giu;
const MATCH_CARD_SELECTOR = '[data-cy="killer-match-card-btn"], [data-cy="survivor-match-card-btn"]';
const MATCH_DETAIL_ROOT_SELECTOR = '[data-cy="modal"]';
const PLAYER_BUTTON_SELECTOR = '[data-cy="Players-card"] [data-cy="survivor-opponent-btn"], [data-cy="Players-card"] [data-cy="killer-opponent-btn"]';
const DURATION_VALUE_SELECTOR = '[data-cy="Duration-card"] .text-neutral-text-xlight.grow.text-start.text-lg.font-bold';
const MATCH_CHARACTER_NAME_CLASS_FRAGMENTS = [
  "font-display text-display-xs text-neutral-text-xlight text-start font-bold",
  "font-sans text-left text-md font-bold text-neutral-text-xlight"
];
