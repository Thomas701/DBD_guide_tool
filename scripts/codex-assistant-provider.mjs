import { spawn } from "node:child_process";

const command = process.env.CODEX_CLI_PATH ?? "codex";
const model = process.env.CODEX_ASSISTANT_MODEL ?? "gpt-5.4";
const timeout = positiveNumber(process.env.CODEX_ASSISTANT_TIMEOUT, 180_000);

export class CodexProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CodexProviderError";
    this.code = code;
  }
}

export class CodexChatGPTProvider {
  #child = null;

  async status() {
    try {
      const result = await runCodex(["login", "status"], null, 15_000);
      return {
        provider: "codex",
        installed: true,
        connected: result.code === 0 && /logged in using chatgpt/i.test(`${result.stdout}\n${result.stderr}`),
        detail: cleanOutput(result.stdout || result.stderr) || "Statut Codex indisponible."
      };
    } catch (error) {
      const normalized = normalizeError(error);
      return { provider: "codex", installed: normalized.code !== "CODEX_NOT_FOUND", connected: false, detail: normalized.message };
    }
  }

  async ask(prompt) {
    if (this.#child) throw new CodexProviderError("BUSY", "Une requête ChatGPT via Codex est déjà en cours.");
    if (typeof prompt !== "string" || !prompt.trim()) throw new CodexProviderError("INVALID_PROMPT", "Le prompt Codex est vide.");

    const result = await this.#run([
      "exec",
      "--model", model,
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--sandbox", "read-only",
      "--skip-git-repo-check",
      "--ignore-rules",
      "--color", "never",
      "-"
    ], prompt);
    if (result.code !== 0) {
      const detail = cleanOutput(result.stderr || result.stdout);
      if (/not logged in|login required|authentication/i.test(detail)) throw new CodexProviderError("AUTH_REQUIRED", "Codex nécessite une connexion ChatGPT. Exécutez `codex login`.");
      throw new CodexProviderError("CODEX_FAILED", detail || `Codex s’est arrêté avec le code ${result.code}.`);
    }
    const answer = lastAgentMessage(result.stdout);
    if (!answer) throw new CodexProviderError("EMPTY_RESPONSE", "Codex n’a renvoyé aucune réponse textuelle.");
    return answer;
  }

  cancel() {
    this.#child?.kill();
    this.#child = null;
  }

  #run(args, input) {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let child;
      try {
        child = spawn(command, args, { cwd: process.cwd(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
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
        this.#child = null;
        callback();
      };
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error) => finish(() => reject(normalizeError(error))));
      child.on("close", (code) => finish(() => resolve({ code: code ?? 1, stdout, stderr })));
      child.stdin.end(input);
    });
  }
}

function runCodex(args, input, commandTimeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), commandTimeout);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(normalizeError(error)); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
    child.stdin.end(input ?? undefined);
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

function normalizeError(error) {
  if (error instanceof CodexProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOENT|not found|introuvable/i.test(message)) return new CodexProviderError("CODEX_NOT_FOUND", "Codex CLI est introuvable. Installez-le puis exécutez `codex login`.");
  if (/EACCES|access denied|accès refusé/i.test(message)) return new CodexProviderError("CODEX_ACCESS_DENIED", "Windows refuse de lancer Codex CLI. Vérifiez `CODEX_CLI_PATH` ou réinstallez Codex.");
  return new CodexProviderError("CODEX_ERROR", message);
}

function cleanOutput(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, "").trim();
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
