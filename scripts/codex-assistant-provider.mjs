import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { assistantSchemaPath } from "./assistant-response.mjs";

const require = createRequire(import.meta.url);
const timeout = positiveNumber(process.env.CODEX_ASSISTANT_TIMEOUT, 180_000);

export class CodexProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CodexProviderError";
    this.code = code;
  }
}

export function codexExecutable() {
  if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH;
  const cpu = { x64: "x86_64", arm64: "aarch64" }[process.arch];
  const target = { win32: "pc-windows-msvc", linux: "unknown-linux-musl", darwin: "apple-darwin" }[process.platform];
  if (!cpu || !target) throw new CodexProviderError("CODEX_NOT_FOUND", "Le moteur Codex n’est pas disponible pour ce système.");
  try {
    const packagePath = require.resolve(`@openai/codex-${process.platform}-${process.arch}/package.json`);
    return join(dirname(packagePath), "vendor", `${cpu}-${target}`, "bin", process.platform === "win32" ? "codex.exe" : "codex");
  } catch {
    throw new CodexProviderError("CODEX_NOT_FOUND", "Le moteur Codex intégré est absent. Relancez l’application avec son lanceur pour terminer sa préparation.");
  }
}

export class CodexChatGPTProvider {
  #profileDirectory;
  #environment;
  #selectedModel = process.env.CODEX_ASSISTANT_MODEL?.trim() || null;
  #settingsLoaded = false;
  #cachedStatus = null;
  #statusTask = null;
  #revision = 0;
  #child = null;
  #loginChild = null;
  #loginUrl = null;
  #loginError = null;

  constructor({ profileDirectory = join(homedir(), ".dbd-build-tool", "codex") } = {}) {
    this.#profileDirectory = profileDirectory;
  }

  async #env() {
    if (!this.#environment) {
      await mkdir(this.#profileDirectory, { recursive: true, mode: 0o700 });
      const environment = { ...process.env, CODEX_HOME: this.#profileDirectory };
      for (const key of ["CODEX_SQLITE_HOME", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "OPENAI_API_KEY", "OPENAI_IDENTITY_TOKEN_FILE", "OPENAI_FEDERATION_RULE_ID", "OPENAI_WORKLOAD_IDENTITY_CONTEXT"]) delete environment[key];
      this.#environment = environment;
    }
    return this.#environment;
  }

  #invalidate() { this.#revision++; this.#cachedStatus = null; }

  async status({ refresh = false } = {}) {
    if (this.#loginChild) return this.#snapshot({ installed: true, loginPending: true, loginUrl: this.#loginUrl, detail: "Terminez la connexion dans votre navigateur." });
    if (!refresh && this.#cachedStatus?.expires > Date.now()) return this.#cachedStatus.value;
    if (this.#statusTask) return this.#statusTask;
    const revision = this.#revision;
    this.#statusTask = this.#readStatus().then((value) => {
      if (revision === this.#revision) this.#cachedStatus = { value, expires: Date.now() + 30_000 };
      return value;
    }).finally(() => { this.#statusTask = null; });
    return this.#statusTask;
  }

  #snapshot(values) {
    return { provider: "codex", installed: true, connected: false, loginPending: false, loginUrl: null, account: null, models: [], selectedModel: null, quotas: [], quotaDetail: null, ...values };
  }

  async #readStatus() {
    try {
      const environment = await this.#env();
      if (!this.#settingsLoaded) {
        try {
          const settings = JSON.parse(await readFile(join(this.#profileDirectory, "build-assistant-settings.json"), "utf8"));
          if (typeof settings.model === "string") this.#selectedModel = settings.model;
        } catch (error) { if (error.code !== "ENOENT") throw new CodexProviderError("CODEX_SETTINGS", "Le choix du modèle enregistré est illisible. Restaurez le fichier build-assistant-settings.json du profil de l’application."); }
        this.#settingsLoaded = true;
      }
      return await withCodexRpc(environment, async (request) => {
        const { account } = await request("account/read", { refreshToken: false });
        if (account?.type !== "chatgpt") return this.#snapshot({ detail: this.#loginError ?? "Connectez un compte ChatGPT pour cette application. Cette connexion est indépendante de VS Code." });
        const [catalog, limits] = await Promise.allSettled([
          listCodexModels(request), request("account/rateLimits/read", {})
        ]);
        const models = catalog.status === "fulfilled" ? catalog.value : [];
        const selectedModel = models.find((entry) => entry.id === this.#selectedModel)?.id ?? models.find((entry) => entry.isDefault)?.id ?? models[0]?.id ?? null;
        return this.#snapshot({
          connected: true,
          account: { email: typeof account.email === "string" ? account.email : null, plan: typeof account.planType === "string" ? account.planType : null },
          models, selectedModel,
          quotas: limits.status === "fulfilled" ? codexQuotas(limits.value) : [],
          quotaDetail: limits.status === "rejected" ? "Quota temporairement indisponible." : null,
          detail: catalog.status === "rejected" ? "Compte connecté. La liste des modèles est temporairement indisponible ; actualisez la connexion." : "Compte ChatGPT connecté à cette application."
        });
      });
    } catch (error) {
      const normalized = normalizeError(error);
      return this.#snapshot({ installed: normalized.code !== "CODEX_NOT_FOUND", detail: normalized.message });
    }
  }

  async selectModel(model) {
    if (this.#child) throw new CodexProviderError("BUSY", "Attendez la fin de la réponse avant de changer de modèle.");
    const status = await this.status({ refresh: true });
    if (this.#child) throw new CodexProviderError("BUSY", "Attendez la fin de la réponse avant de changer de modèle.");
    if (!status.connected) throw new CodexProviderError("AUTH_REQUIRED", "Connectez votre compte ChatGPT à l’application.");
    if (!status.models.some((entry) => entry.id === model)) throw new CodexProviderError("MODEL_UNAVAILABLE", "Choisissez un modèle proposé pour ce compte.");
    await writeFile(join(this.#profileDirectory, "build-assistant-settings.json"), JSON.stringify({ model }), { mode: 0o600 });
    this.#selectedModel = model;
    this.#invalidate();
    const value = { ...status, selectedModel: model };
    this.#cachedStatus = { value, expires: Date.now() + 30_000 };
    return value;
  }

  async login() {
    const status = await this.status();
    if (status.connected || status.loginPending) return status;
    if (!status.installed) throw new CodexProviderError("CODEX_NOT_FOUND", status.detail);
    const environment = await this.#env();
    if (this.#loginChild) return this.status();
    this.#loginError = null;
    this.#loginUrl = null;
    const child = spawn(codexExecutable(), ["login", "-c", 'cli_auth_credentials_store="file"'], { cwd: process.cwd(), env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    this.#loginChild = child;
    this.#invalidate();
    let output = "";
    const capture = (chunk) => {
      output = (output + chunk).slice(-64_000);
      const match = cleanOutput(output).match(/https:\/\/auth\.openai\.com\/[^\s\x1b]+/);
      if (match) this.#loginUrl = match[0];
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const timer = setTimeout(() => { this.#loginError = "Connexion expirée. Réessayez."; child.kill(); }, 600_000);
    const finish = () => { clearTimeout(timer); if (this.#loginChild === child) { this.#loginChild = null; this.#invalidate(); } };
    child.on("error", (error) => { this.#loginError = normalizeError(error).message; finish(); });
    child.on("close", (code) => { if (code && !this.#loginError) this.#loginError = "La connexion Codex n’a pas abouti. Réessayez."; finish(); });
    return this.status();
  }

  async cancelLogin() {
    const child = this.#loginChild;
    if (!child) return;
    this.#loginError = "Connexion annulée.";
    await new Promise((resolve) => { child.once("close", resolve); child.kill(); });
  }

  async logout() {
    this.#invalidate();
    this.cancel();
    await this.#statusTask;
    await this.cancelLogin();
    const result = await runCodex(["logout", "-c", 'cli_auth_credentials_store="file"'], await this.#env(), 15_000);
    if (result.code !== 0) throw new CodexProviderError("CODEX_LOGOUT", "La déconnexion n’a pas abouti. Réessayez.");
    this.#loginError = null;
    this.#invalidate();
    return this.status({ refresh: true });
  }

  async ask(prompt, { actionMode = false, signal } = {}) {
    if (this.#child) throw new CodexProviderError("BUSY", "Une requête ChatGPT via Codex est déjà en cours.");
    if (typeof prompt !== "string" || !prompt.trim()) throw new CodexProviderError("INVALID_PROMPT", "Le prompt Codex est vide.");
    const status = await this.status();
    if (!status.connected) throw new CodexProviderError("AUTH_REQUIRED", "Connectez votre compte ChatGPT à l’application.");
    const model = status.selectedModel;
    if (!model) throw new CodexProviderError("MODEL_UNAVAILABLE", "La liste des modèles est indisponible. Actualisez la connexion avant de réessayer.");
    const revision = this.#revision;

    const result = await this.#run([
      "exec",
      "--model", model,
      "-c", 'cli_auth_credentials_store="file"',
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--sandbox", "read-only",
      "--skip-git-repo-check",
      ...(actionMode ? ["--output-schema", assistantSchemaPath] : []),
      "--color", "never",
      "-"
    ], prompt, signal);
    this.#cachedStatus = null;
    if (revision !== this.#revision) throw new CodexProviderError("AUTH_REQUIRED", "La connexion a changé pendant la réponse. Aucune action appliquée.");
    const failure = codexFailureMessage(`${result.stdout}\n${result.stderr}`);
    if (result.code !== 0 || failure) {
      const detail = failure || cleanOutput(result.stderr).split(/\r?\n/).filter((line) => !/^\s*[{[]/.test(line)).join("\n").trim();
      if (/model.*(?:not supported|not found|does not exist)/i.test(detail)) {
        throw new CodexProviderError("MODEL_UNAVAILABLE", "Ce modèle n’est pas disponible avec ce compte ChatGPT. Actualisez la liste et choisissez un autre modèle.");
      }
      if (/not logged in|login required|authentication/i.test(detail)) throw new CodexProviderError("AUTH_REQUIRED", "Reconnectez votre compte ChatGPT depuis le bouton Connecter Codex.");
      throw new CodexProviderError("CODEX_FAILED", detail || `Codex s’est arrêté avec le code ${result.code}.`);
    }
    const answer = lastAgentMessage(result.stdout);
    if (!answer) throw new CodexProviderError("EMPTY_RESPONSE", "Codex n’a renvoyé aucune réponse textuelle.");
    return answer;
  }

  cancel() {
    this.#child?.kill();
  }

  async #run(args, input, signal) {
    const environment = await this.#env();
    if (this.#child) throw new CodexProviderError("BUSY", "Une requête ChatGPT via Codex est déjà en cours.");
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new CodexProviderError("CANCELLED", "Requête annulée.")); return; }
      let stdout = "";
      let stderr = "";
      let settled = false;
      let child;
      try {
        child = spawn(codexExecutable(), args, { cwd: process.cwd(), env: environment, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      } catch (error) {
        reject(normalizeError(error));
        return;
      }
      this.#child = child;
      const timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new CodexProviderError("TIMEOUT", "Codex n’a pas répondu avant le timeout.")));
      }, timeout);
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (this.#child === child) this.#child = null;
        callback();
      };
      const abort = () => { child.kill(); finish(() => reject(new CodexProviderError("CANCELLED", "Requête annulée."))); };
      signal?.addEventListener("abort", abort, { once: true });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error) => finish(() => reject(normalizeError(error))));
      child.on("close", (code) => finish(() => resolve({ code: code ?? 1, stdout, stderr })));
      child.stdin.end(input);
    });
  }
}

function runCodex(args, environment, commandTimeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(codexExecutable(), args, { cwd: process.cwd(), env: environment, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), commandTimeout);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(normalizeError(error)); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
    child.stdin.end();
  });
}

async function withCodexRpc(environment, operation) {
  const child = spawn(codexExecutable(), ["app-server", "-c", 'cli_auth_credentials_store="file"'], { cwd: process.cwd(), env: environment, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
  const stopped = new Promise((resolve) => child.once("close", resolve));
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let sequence = 0;
  let closed = false;
  const fail = (error) => { closed = true; for (const entry of pending.values()) entry.reject(error); pending.clear(); };
  child.on("error", (error) => fail(normalizeError(error)));
  child.stdin.on("error", () => fail(new CodexProviderError("CODEX_STATUS", "La connexion au moteur Codex a été interrompue.")));
  child.on("close", () => fail(new CodexProviderError("CODEX_STATUS", "Le moteur Codex s’est arrêté pendant la lecture du compte.")));
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id);
        if (message.error) entry.reject(new CodexProviderError("CODEX_STATUS", "Codex n’a pas pu lire les informations du compte."));
        else entry.resolve(message.result);
      }
    } catch { /* Une ligne de diagnostic ne fait pas partie du protocole. */ }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    if (closed) { reject(new CodexProviderError("CODEX_STATUS", "La connexion au moteur Codex est fermée.")); return; }
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  const timer = setTimeout(() => { fail(new CodexProviderError("TIMEOUT", "La lecture du compte Codex a expiré. Réessayez.")); child.kill(); }, 25_000);
  try {
    await request("initialize", { clientInfo: { name: "dbd_build_tool", title: "Build Analyzer", version: "0.1.0" } });
    child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
    return await operation(request);
  } finally {
    clearTimeout(timer);
    lines.close();
    const shutdownTimer = setTimeout(() => child.kill(), 1_000);
    child.stdin.end();
    await stopped;
    clearTimeout(shutdownTimer);
  }
}

async function listCodexModels(request) {
  const models = new Map();
  const cursors = new Set();
  let cursor = null;
  do {
    const page = await request("model/list", { limit: 100, includeHidden: false, cursor });
    if (!Array.isArray(page?.data)) throw new Error("Catalogue Codex invalide.");
    for (const entry of page.data) {
      if (typeof entry.model === "string" && entry.model.length <= 200 && entry.model.trim() && !entry.hidden) {
        models.set(entry.model, { id: entry.model, name: typeof entry.displayName === "string" ? entry.displayName : entry.model, isDefault: entry.isDefault === true });
      }
    }
    cursor = typeof page.nextCursor === "string" && page.nextCursor ? page.nextCursor : null;
    if (cursor && cursors.has(cursor)) throw new Error("Pagination Codex invalide.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...models.values()];
}

export function codexQuotas(result) {
  const byId = result?.rateLimitsByLimitId;
  const entries = byId && typeof byId === "object" && !Array.isArray(byId) && Object.keys(byId).length ? Object.entries(byId) : result?.rateLimits ? [[result.rateLimits.limitId ?? "codex", result.rateLimits]] : [];
  return entries.flatMap(([id, limit]) => {
    if (!limit || typeof limit !== "object") return [];
    const windows = [limit.primary, limit.secondary].flatMap((window) => window && typeof window === "object" ? [{
      remainingPercent: typeof window.usedPercent === "number" && Number.isFinite(window.usedPercent) ? Math.max(0, Math.min(100, 100 - window.usedPercent)) : null,
      durationMinutes: Number.isFinite(window.windowDurationMins) && window.windowDurationMins > 0 ? window.windowDurationMins : null,
      resetsAt: Number.isFinite(window.resetsAt) && window.resetsAt > 0 && window.resetsAt < 8_640_000_000_000 ? window.resetsAt : null
    }] : []);
    return windows.length ? [{ id, name: typeof limit.limitName === "string" ? limit.limitName : id === "codex" ? "Codex" : id, windows }] : [];
  });
}

export function lastAgentMessage(output) {
  let answer = "";
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") answer = event.item.text;
    } catch {
      // Les lignes non JSON sont ignorées ; Codex documente stdout comme JSONL avec --json.
    }
  }
  return answer.trim();
}

export function codexFailureMessage(output) {
  let failure = "";
  let error = "";
  for (const line of cleanOutput(output).split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event?.type === "turn.failed") failure = typeof event.error?.message === "string" && event.error.message.trim() || "Codex n’a pas pu terminer sa réponse. Réessayez.";
      if (event?.type === "error" && typeof event.message === "string") error = event.message.trim();
    } catch {
      // Les diagnostics non JSON ne sont pas des événements de réponse.
    }
  }
  return failure || error;
}

function normalizeError(error) {
  if (error instanceof CodexProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOENT|not found|introuvable/i.test(message)) return new CodexProviderError("CODEX_NOT_FOUND", "Le moteur Codex intégré est absent. Relancez l’application avec son lanceur pour terminer sa préparation.");
  if (/EACCES|access denied|accès refusé/i.test(message)) return new CodexProviderError("CODEX_ACCESS_DENIED", "Le système refuse de démarrer le moteur Codex intégré. Vérifiez les autorisations de l’application.");
  return new CodexProviderError("CODEX_ERROR", message);
}

function cleanOutput(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, "").trim();
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
