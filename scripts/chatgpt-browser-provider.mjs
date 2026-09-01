import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "playwright";

export const CHATGPT_BROWSER_CONFIG = Object.freeze({
  headless: process.env.CHATGPT_BROWSER_HEADLESS !== "false",
  timeout: positiveNumber(process.env.CHATGPT_BROWSER_TIMEOUT, 120_000),
  loginTimeout: positiveNumber(process.env.CHATGPT_BROWSER_LOGIN_TIMEOUT, 600_000),
  profilePath: resolve(process.cwd(), process.env.CHATGPT_BROWSER_PROFILE ?? ".data/chatgpt-browser-profile"),
  chatgptUrl: process.env.CHATGPT_BROWSER_URL ?? "https://chatgpt.com/"
});

export class BrowserProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BrowserProviderError";
    this.code = code;
  }
}

export class BrowserChatGPTProvider {
  #config;
  #context = null;
  #page = null;
  #headless = null;
  #busy = false;
  #connected = false;
  #cancelRequested = false;
  #state = "idle";
  #error;

  constructor(config = CHATGPT_BROWSER_CONFIG) {
    this.#config = config;
  }

  snapshot() {
    return {
      provider: "browser",
      connected: this.#connected,
      configured: existsSync(this.#connectionMarker()),
      busy: this.#busy,
      state: this.#state,
      ...(this.#error ? { error: this.#error } : {})
    };
  }

  async configure() {
    return this.#exclusive(async () => {
      this.#setState("starting_browser");
      const page = await this.#getPage(false);
      this.#setState("checking_session");
      await this.#navigate(page);
      const deadline = Date.now() + this.#config.loginTimeout;
      while (Date.now() < deadline) {
        this.#throwIfCancelled();
        await this.#assertNoChallenge(page);
        if (await this.#isAuthenticated(page)) {
          this.#connected = true;
          await writeFile(this.#connectionMarker(), "connected\n", { encoding: "utf8" });
          this.#setState("completed");
          await this.close();
          return this.snapshot();
        }
        await page.waitForTimeout(750);
      }
      throw new BrowserProviderError("AUTH_TIMEOUT", "Connexion ChatGPT non détectée dans le délai prévu.");
    });
  }

  async checkSession() {
    return this.#exclusive(async () => {
      this.#setState("starting_browser");
      const page = await this.#getPage(this.#config.headless);
      this.#setState("checking_session");
      await this.#navigate(page);
      this.#connected = await this.#isAuthenticated(page);
      if (!this.#connected) throw new BrowserProviderError("AUTH_REQUIRED", "ChatGPT nécessite une connexion ou une reconnexion.");
      this.#setState("completed");
      return this.snapshot();
    });
  }

  async ask(prompt) {
    if (typeof prompt !== "string" || !prompt.trim()) throw new BrowserProviderError("INVALID_PROMPT", "Le prompt ChatGPT est vide.");
    return this.#exclusive(async () => {
      const startedAt = Date.now();
      this.#setState("starting_browser");
      const page = await this.#getPage(this.#config.headless);
      this.#setState("checking_session");
      await this.#navigate(page);
      if (!await this.#isAuthenticated(page)) {
        this.#connected = false;
        throw new BrowserProviderError("AUTH_REQUIRED", "La session ChatGPT a expiré. Ouvrez la configuration pour vous reconnecter.");
      }
      this.#connected = true;
      const previousCount = await this.#assistantMessages(page).count();
      this.#setState("sending_prompt");
      const input = await this.#promptInput(page);
      await input.fill(prompt);
      await this.#submitPrompt(page, input);
      this.#setState("waiting_response");
      await this.waitForResponseCompletion(page, previousCount);
      this.#setState("extracting_response");
      const content = await this.#lastAssistantText(page);
      if (!content) throw new BrowserProviderError("EMPTY_RESPONSE", "ChatGPT a terminé sans réponse textuelle exploitable.");
      this.#setState("completed");
      return {
        success: true,
        content,
        ...(conversationId(page.url()) ? { conversationId: conversationId(page.url()) } : {}),
        durationMs: Date.now() - startedAt
      };
    });
  }

  async waitForResponseCompletion(page, previousCount) {
    const deadline = Date.now() + this.#config.timeout;
    let previousText = "";
    let stableSince = Date.now();
    let responseSeen = false;

    while (Date.now() < deadline) {
      this.#throwIfCancelled();
      await this.#assertNoChallenge(page);
      const messages = this.#assistantMessages(page);
      const count = await messages.count();
      const text = count > previousCount ? (await messages.last().innerText().catch(() => "")).trim() : "";
      if (text) responseSeen = true;
      if (text !== previousText) {
        previousText = text;
        stableSince = Date.now();
      }
      const stopVisible = await this.#generationStopVisible(page);
      const regenerateVisible = await this.#regenerateVisible(page);
      if (responseSeen && text && !stopVisible && (regenerateVisible || Date.now() - stableSince >= 3_000)) return;
      await page.waitForTimeout(600);
    }
    throw new BrowserProviderError("RESPONSE_TIMEOUT", "ChatGPT n’a pas terminé sa réponse avant le timeout.");
  }

  async cancel() {
    this.#cancelRequested = true;
    if (this.#page) {
      const stop = this.#page.getByRole("button", { name: /stop|arrêter|cancel|annuler/i }).first();
      if (await stop.isVisible().catch(() => false)) await stop.click({ timeout: 2_000 }).catch(() => undefined);
    }
    await this.close();
    this.#state = "idle";
  }

  async close() {
    const context = this.#context;
    this.#context = null;
    this.#page = null;
    this.#headless = null;
    if (context) await context.close().catch(() => undefined);
  }

  async #exclusive(operation) {
    if (this.#busy) throw new BrowserProviderError("BUSY", "Une requête ChatGPT Browser est déjà en cours.");
    this.#busy = true;
    this.#cancelRequested = false;
    this.#error = undefined;
    try {
      return await operation();
    } catch (error) {
      const normalized = normalizeError(error);
      this.#state = "error";
      this.#error = normalized.message;
      if (normalized.code === "CHALLENGE_REQUIRED") await this.close();
      throw normalized;
    } finally {
      this.#busy = false;
    }
  }

  async #getPage(headless) {
    if (this.#context && this.#headless !== headless) await this.close();
    if (!this.#context) {
      await mkdir(this.#config.profilePath, { recursive: true });
      try {
        this.#context = await chromium.launchPersistentContext(this.#config.profilePath, {
          headless,
          viewport: { width: 1440, height: 1000 },
          locale: "fr-FR"
        });
      } catch (error) {
        throw new BrowserProviderError("BROWSER_START_FAILED", browserStartMessage(error));
      }
      this.#headless = headless;
      this.#context.on("close", () => {
        this.#context = null;
        this.#page = null;
        this.#headless = null;
      });
    }
    this.#page = this.#context.pages()[0] ?? await this.#context.newPage();
    return this.#page;
  }

  async #navigate(page) {
    try {
      await page.goto(this.#config.chatgptUrl, { waitUntil: "domcontentloaded", timeout: Math.min(this.#config.timeout, 45_000) });
      await this.#assertNoChallenge(page);
    } catch (error) {
      if (error instanceof BrowserProviderError) throw error;
      throw new BrowserProviderError("NAVIGATION_FAILED", `Impossible d’ouvrir ChatGPT : ${cleanPlaywrightError(error)}`);
    }
  }

  async #isAuthenticated(page) {
    await page.waitForTimeout(500);
    const loginVisible = await page.getByRole("link", { name: /log in|se connecter|connexion/i }).first().isVisible().catch(() => false)
      || await page.getByRole("button", { name: /log in|se connecter|connexion/i }).first().isVisible().catch(() => false);
    if (loginVisible) return false;
    return Boolean(await this.#findVisible(page, promptSelectors(), 5_000));
  }

  async #promptInput(page) {
    const input = await this.#findVisible(page, promptSelectors(), 15_000);
    if (!input) throw new BrowserProviderError("PROMPT_INPUT_NOT_FOUND", "Zone de saisie ChatGPT introuvable. L’interface a peut-être changé.");
    return input;
  }

  async #submitPrompt(page, input) {
    const button = await this.#findVisible(page, [
      "button[data-testid='send-button']",
      "button[aria-label*='Send']",
      "button[aria-label*='Envoyer']"
    ], 3_000);
    if (button) {
      await button.click();
      return;
    }
    await input.press("Enter");
  }

  #assistantMessages(page) {
    return page.locator("[data-message-author-role='assistant']");
  }

  async #lastAssistantText(page) {
    const messages = this.#assistantMessages(page);
    if (await messages.count() === 0) throw new BrowserProviderError("RESPONSE_NOT_FOUND", "Dernier message assistant introuvable. L’interface ChatGPT a peut-être changé.");
    return (await messages.last().innerText()).trim();
  }

  async #generationStopVisible(page) {
    return page.getByRole("button", { name: /stop generating|arrêter la génération|stop|arrêter/i }).first().isVisible().catch(() => false);
  }

  async #regenerateVisible(page) {
    return page.getByRole("button", { name: /regenerate|réessayer|régénérer|try again/i }).first().isVisible().catch(() => false);
  }

  async #findVisible(page, selectors, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      for (const selector of selectors) {
        const locator = page.locator(selector).first();
        if (await locator.isVisible().catch(() => false)) return locator;
      }
      await page.waitForTimeout(250);
    }
    return null;
  }

  async #assertNoChallenge(page) {
    const [title, body, challengeFrames] = await Promise.all([
      page.title().catch(() => ""),
      page.locator("body").innerText({ timeout: 3_000 }).catch(() => ""),
      page.locator("iframe[src*='challenges.cloudflare.com'], iframe[src*='challenge-platform']").count().catch(() => 0)
    ]);
    if (challengeFrames > 0 || isSecurityChallenge(`${page.url()}\n${title}\n${body.slice(0, 2_000)}`)) {
      throw new BrowserProviderError("CHALLENGE_REQUIRED", "ChatGPT bloque le navigateur automatisé avec un contrôle de sécurité. Utilisez le provider « ChatGPT via Codex » ; le contrôle ne sera pas contourné.");
    }
  }

  #throwIfCancelled() {
    if (this.#cancelRequested) throw new BrowserProviderError("CANCELLED", "Requête ChatGPT annulée.");
  }

  #setState(state) {
    this.#state = state;
    this.#error = undefined;
  }

  #connectionMarker() {
    return resolve(this.#config.profilePath, ".chatgpt-connected");
  }
}

export function isSecurityChallenge(content) {
  return /just a moment|cloudflare|challenges\.cloudflare\.com|verify you are human|human verification|security verification in progress|are you human|vérification de sécurité en cours|vérifiez que vous êtes humain|confirmez que vous êtes humain/i.test(content);
}

function promptSelectors() {
  return [
    "#prompt-textarea",
    "[data-testid='prompt-textarea']",
    "textarea[placeholder*='Message']",
    "textarea[placeholder*='message']",
    "div[contenteditable='true'][role='textbox']"
  ];
}

function normalizeError(error) {
  if (error instanceof BrowserProviderError) return error;
  return new BrowserProviderError("BROWSER_ERROR", cleanPlaywrightError(error));
}

function browserStartMessage(error) {
  const message = cleanPlaywrightError(error);
  if (/executable doesn't exist|browser.*not found/i.test(message)) return "Chromium Playwright n’est pas installé. Exécutez : npx playwright install chromium";
  if (/profile|user data|access|permission|lock/i.test(message)) return `Profil Chromium inaccessible ou déjà utilisé : ${message}`;
  return `Impossible de démarrer Chromium : ${message}`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function cleanPlaywrightError(error) {
  const message = errorMessage(error)
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\nCall log:[\s\S]*$/, "")
    .trim();
  if (/ERR_NETWORK_ACCESS_DENIED/i.test(message)) {
    return "Chromium n’a pas accès au réseau. Arrêtez l’ancien proxy, puis relancez `npm run assistant:proxy` dans un terminal Windows normal et vérifiez le pare-feu/antivirus si l’erreur persiste.";
  }
  return message;
}

function conversationId(url) {
  return /\/c\/([^/?#]+)/.exec(url)?.[1];
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
