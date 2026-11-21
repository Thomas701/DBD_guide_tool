import { createStatisticsParser } from "../shared/statistics-parser.mjs";
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


const statisticsParser = createStatisticsParser(buildMatchHistoryEntryId);
export const { isStatisticsUrl, isMatchHistoryUrl, takeMatchesUntilKnown, selectMatchesForEnrichment, normalizeMatchHistoryCard, parseMatchDateLabel, extractMatchHistoryEntriesFromHtml, countMatchHistoryButtonsFromHtml, extractImageAssets, extractEmblemsFromHtml, extractParticipantLoadoutFromHtml } = statisticsParser;
const { isStatisticsSiteUrl, parseDisplayNumber, extractDurationLabel, extractImageUrls, isCharacterAssetUrl, MATCH_CARD_SELECTOR, MATCH_DETAIL_ROOT_SELECTOR, PLAYER_BUTTON_SELECTOR, DURATION_VALUE_SELECTOR } = statisticsParser;
