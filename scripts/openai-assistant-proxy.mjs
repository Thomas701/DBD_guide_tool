import { execFileSync } from "node:child_process";
import { createServer } from "node:http";

import { BrowserChatGPTProvider, BrowserProviderError } from "./chatgpt-browser-provider.mjs";
import { DbdStatisticsError, DbdStatisticsProvider } from "./dbd-statistics-provider.mjs";
import { CodexChatGPTProvider, CodexProviderError } from "./codex-assistant-provider.mjs";
import { AppUpdateError, applyAppUpdate, getAppUpdateStatus } from "./app-updater.mjs";
import { deleteMatchHistoryEntry, readStatisticsSnapshot, syncStatisticsSnapshot, updateMatchHistoryEntry, updateNativePerk, writeCurrentBuild } from "./local-data-files.mjs";
import { actionPrompt, assistantResponseSchema, ensureBuildCreation, parseActionAnswer } from "./assistant-response.mjs";

const port = Number(process.env.OPENAI_ASSISTANT_PORT ?? 8787);
let apiKey = process.env.OPENAI_API_KEY;
let model = process.env.OPENAI_MODEL ?? "gpt-5-mini";
const browserProvider = new BrowserChatGPTProvider();
const codexProvider = new CodexChatGPTProvider();
const dbdStatisticsProvider = new DbdStatisticsProvider();
const API_VERSION = 18;
const serviceRevision = readServiceRevision();
let statisticsSyncPromise = null;

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && !isAllowedOrigin(origin)) return send(response, 403, { error: "Origine non autorisée." });
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (request.method === "OPTIONS") return response.writeHead(204).end();

  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  try {
    if (request.method === "GET" && url.pathname === "/api/assistant/status") {
      if (url.searchParams.get("verify") === "1" && !browserProvider.snapshot().busy) {
        await browserProvider.checkSession().catch(() => undefined);
      }
      return send(response, 200, { ...browserProvider.snapshot(), apiVersion: API_VERSION, serviceRevision });
    }
    if (request.method === "GET" && url.pathname === "/api/app-update/status") {
      return send(response, 200, await getAppUpdateStatus());
    }
    if (request.method === "POST" && url.pathname === "/api/app-update") {
      return send(response, 200, await applyAppUpdate());
    }
    if (request.method === "POST" && url.pathname === "/api/assistant/configure") {
      return send(response, 200, await browserProvider.configure());
    }
    if (request.method === "POST" && url.pathname === "/api/assistant/cancel") {
      await browserProvider.cancel();
      codexProvider.cancel();
      return send(response, 200, { success: true });
    }
    if (request.method === "GET" && url.pathname === "/api/assistant/codex/status") {
      return send(response, 200, await codexProvider.status({ refresh: url.searchParams.get("refresh") === "1" }));
    }
    if (url.pathname === "/api/assistant/codex/login" && request.method === "POST") {
      return send(response, 200, await codexProvider.login());
    }
    if (url.pathname === "/api/assistant/codex/login" && request.method === "DELETE") {
      await codexProvider.cancelLogin();
      return send(response, 200, await codexProvider.status());
    }
    if (url.pathname === "/api/assistant/codex/logout" && request.method === "POST") {
      return send(response, 200, await codexProvider.logout());
    }
    if (url.pathname === "/api/assistant/codex/model" && request.method === "POST") {
      const body = await readJson(request);
      if (!isRecord(body) || typeof body.model !== "string" || !body.model.trim() || body.model.length > 200) throw new HttpError(400, "Modèle Codex invalide.");
      return send(response, 200, await codexProvider.selectModel(body.model));
    }
    if (url.pathname === "/api/assistant/openai/status" && request.method === "GET") {
      return send(response, 200, openaiStatus());
    }
    if (url.pathname === "/api/assistant/openai/connect" && request.method === "POST") {
      const body = await readJson(request);
      if (!isRecord(body) || typeof body.apiKey !== "string" || !body.apiKey.trim() || body.apiKey.length > 1_000 || /[\r\n]/.test(body.apiKey)
        || typeof body.model !== "string" || !/^[a-zA-Z0-9._:-]{1,100}$/.test(body.model)) throw new HttpError(400, "Clé API ou modèle invalide.");
      const candidateKey = body.apiKey.trim();
      const check = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(body.model)}`, {
        headers: { Authorization: `Bearer ${candidateKey}` }, signal: AbortSignal.timeout(15_000)
      });
      if (!check.ok) throw new HttpError(check.status, check.status === 401 ? "Clé API refusée par OpenAI." : "Ce modèle n’est pas accessible avec cette clé API.");
      apiKey = candidateKey;
      model = body.model;
      return send(response, 200, openaiStatus());
    }
    if (url.pathname === "/api/assistant/openai/connect" && request.method === "DELETE") {
      apiKey = undefined;
      return send(response, 200, openaiStatus());
    }
    if (request.method === "POST" && url.pathname === "/api/local-data/current-build") {
      const body = await readJson(request);
      if (!isRecord(body)) throw new HttpError(400, "Build courant invalide.");
      await writeCurrentBuild(body);
      return send(response, 200, { success: true });
    }
    if (request.method === "POST" && url.pathname === "/api/local-data/perk") {
      const body = await readJson(request);
      if (!isRecord(body) || typeof body.perkId !== "string" || !isRecord(body.changes)) {
        throw new HttpError(400, "Modification native de perk invalide.");
      }
      return send(response, 200, { perk: await updateNativePerk(body.perkId, body.changes) });
    }
    if (request.method === "GET" && url.pathname === "/api/statistics/cache") {
      return send(response, 200, await readStatisticsSnapshot());
    }
    if (url.pathname === "/api/statistics/match" && request.method === "PUT") {
      const body = await readJson(request);
      if (!isRecord(body) || typeof body.id !== "string" || !isRecord(body.changes)) throw new HttpError(400, "Modification de partie invalide.");
      return send(response, 200, await updateMatchHistoryEntry(body.id, body.changes));
    }
    if (url.pathname === "/api/statistics/match" && request.method === "DELETE") {
      const body = await readJson(request);
      if (!isRecord(body) || typeof body.id !== "string") throw new HttpError(400, "Partie invalide.");
      return send(response, 200, await deleteMatchHistoryEntry(body.id));
    }
    if (request.method === "GET" && url.pathname === "/api/statistics/status") {
      return send(response, 200, dbdStatisticsProvider.status());
    }
    if (request.method === "POST" && url.pathname === "/api/statistics/connect") {
      return send(response, 200, await connectStatistics());
    }
    if (request.method === "POST" && url.pathname === "/api/statistics/show-page") {
      const body = await readJson(request);
      if (!isRecord(body) || typeof body.url !== "string") throw new HttpError(400, "URL Statistiques invalide.");
      return send(response, 200, await dbdStatisticsProvider.showPage(body.url));
    }
    if (request.method === "POST" && url.pathname === "/api/assistant/message") {
      const body = await readJson(request);
      if (!isAssistantRequest(body)) return send(response, 400, { error: "Requête Build Assistant invalide." });
      const controller = new AbortController();
      response.once("close", () => { if (!response.writableEnded) controller.abort(); });
      if (body.provider === "browser") {
        if (typeof body.prompt !== "string" || !body.prompt.trim()) return send(response, 400, { error: "Prompt ChatGPT Browser manquant." });
        const result = await browserProvider.ask(body.prompt);
        return send(response, 200, { answer: result.content, conversationId: result.conversationId, durationMs: result.durationMs });
      }
      if (body.provider === "codex") {
        if (typeof body.prompt !== "string" || !body.prompt.trim()) return send(response, 400, { error: "Prompt Codex manquant." });
        const structured = body.actionMode === true;
        if (structured) {
          const answer = await ensureBuildCreation(body.message, body.prompt, async (prompt) => parseActionAnswer(await codexProvider.ask(actionPrompt(prompt), { actionMode: true, signal: controller.signal })));
          return send(response, 200, answer);
        }
        return send(response, 200, { answer: await codexProvider.ask(body.prompt, { signal: controller.signal }) });
      }
      const answer = body.actionMode === true ? await ensureBuildCreation(body.message, openaiPrompt(body), (prompt) => askOpenAI({ ...body, prompt }, controller.signal)) : await askOpenAI(body, controller.signal);
      return send(response, 200, body.actionMode === true ? answer : { answer });
    }
    if (request.method === "POST" && url.pathname === "/api/build-assistant") {
      const body = await readJson(request);
      if (!isLegacyRequest(body)) return send(response, 400, { error: "Requête Build Assistant invalide." });
      return send(response, 200, { answer: await askOpenAI({ ...body, provider: "openai" }) });
    }
    return send(response, 404, { error: "Route introuvable." });
  } catch (error) {
    return sendError(response, error);
  }
});

if (await existingAssistantServer(port)) {
  console.log(`Build Assistant déjà actif : http://127.0.0.1:${port}`);
} else {
  server.listen(port, "127.0.0.1", () => {
    console.log(`Build Assistant local : http://127.0.0.1:${port}`);
    console.log(`ChatGPT via Codex : disponible · OpenAI API : ${apiKey ? "disponible" : "désactivée"} · Navigateur : expérimental`);
  });
}

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`Le port ${port} est déjà utilisé. Fermez le processus concerné ou définissez OPENAI_ASSISTANT_PORT sur un autre port.`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});

function openaiStatus() { return { provider: "openai", connected: Boolean(apiKey), model }; }

function openaiPrompt(body) {
  return typeof body.prompt === "string" && body.prompt.trim() ? body.prompt : `Contexte du build (JSON) :\n${JSON.stringify(body.context)}\n\nHistorique récent :\n${JSON.stringify(body.history)}\n\nQuestion : ${body.message}`;
}

async function askOpenAI(body, signal) {
  if (!apiKey) throw new HttpError(503, "OPENAI_API_KEY est requise uniquement pour le provider OpenAI API.");
  const requestKey = apiKey;
  const prompt = openaiPrompt(body);
  const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${requestKey}`, "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model,
      store: false,
      instructions: "Tu es un analyste expert de builds Dead by Daylight. Réponds en français. Utilise uniquement le contexte fourni pour les statistiques chiffrées ; distingue clairement les hypothèses et les données non calculables.",
      input: body.actionMode === true ? actionPrompt(prompt) : prompt,
      ...(body.actionMode === true ? { text: { format: { type: "json_schema", name: "dbd_assistant_response", strict: true, schema: assistantResponseSchema } } } : {})
    })
  });
  const result = await openaiResponse.json();
  if (!openaiResponse.ok) throw new HttpError(openaiResponse.status, String(result?.error?.message ?? "Erreur OpenAI.").replaceAll(requestKey, "[clé masquée]").replace(/sk-[A-Za-z0-9_-]+/g, "[clé masquée]"));
  if (result.status === "incomplete") throw new HttpError(502, "Réponse OpenAI interrompue. Aucune action appliquée.");
  const content = result.output?.flatMap((item) => item.content ?? []) ?? [];
  const refusal = content.find((item) => item.type === "refusal")?.refusal;
  if (typeof refusal === "string") return body.actionMode === true ? { answer: refusal, actions: [] } : refusal;
  const answer = result.output_text ?? content.filter((item) => item.type === "output_text").map((item) => item.text).join("");
  if (typeof answer !== "string" || !answer.trim()) throw new HttpError(502, "Réponse OpenAI sans texte.");
  return body.actionMode === true ? parseActionAnswer(answer) : answer;
}

function sendError(response, error) {
  if (error instanceof AppUpdateError) return send(response, error.status, { error: error.message });
  if (error instanceof HttpError) return send(response, error.status, { error: error.message });
  if (error instanceof BrowserProviderError) return send(response, browserErrorStatus(error.code), { error: error.message, code: error.code });
  if (error instanceof DbdStatisticsError) return send(response, statisticsErrorStatus(error.code), { error: error.message, code: error.code });
  if (error instanceof CodexProviderError) return send(response, codexErrorStatus(error.code), { error: error.message, code: error.code });
  return send(response, 500, { error: error instanceof Error ? error.message : "Erreur serveur inconnue." });
}

async function connectStatistics() {
  if (!statisticsSyncPromise) {
    statisticsSyncPromise = (async () => {
      try {
        const current = await readStatisticsSnapshot();
        return await syncStatisticsSnapshot(await dbdStatisticsProvider.connect({
          knownMatchIds: current.matchHistory.map((entry) => entry.id),
          incompleteMatchIds: current.matchHistory.filter((entry) => !entry.emblemIconUrls || (entry.role === "survivor" && !entry.survivalTimeLabel) || entry.participants.some((participant) => !participant.perkIconUrls || !participant.equipmentIconUrls)).map((entry) => entry.id)
        }));
      } finally {
        statisticsSyncPromise = null;
      }
    })();
  }
  return statisticsSyncPromise;
}

function codexErrorStatus(code) {
  if (code === "CANCELLED") return 499;
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "BUSY") return 409;
  if (code === "TIMEOUT") return 504;
  if (code === "CODEX_NOT_FOUND" || code === "CODEX_ACCESS_DENIED") return 503;
  return 502;
}

function statisticsErrorStatus(code) {
  if (code === "INVALID_URL") return 400;
  if (code === "BUSY") return 409;
  if (code === "LOGIN_TIMEOUT") return 504;
  if (code === "BROWSER_NOT_FOUND" || code === "BROWSER_START_FAILED" || code === "BROWSER_STOP_FAILED" || code === "STATISTICS_UNAVAILABLE") return 503;
  return 502;
}

function browserErrorStatus(code) {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "CHALLENGE_REQUIRED") return 403;
  if (code === "BUSY") return 409;
  if (code === "RESPONSE_TIMEOUT" || code === "AUTH_TIMEOUT") return 504;
  if (code === "BROWSER_START_FAILED") return 503;
  if (code === "CANCELLED") return 499;
  return 502;
}

function send(response, status, payload) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) reject(new HttpError(413, "Requête trop volumineuse."));
    });
    request.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { reject(new HttpError(400, "JSON invalide.")); }
    });
    request.on("error", reject);
  });
}

function isAssistantRequest(value) {
  return isLegacyRequest(value) && (value.provider === "openai" || value.provider === "browser" || value.provider === "codex");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLegacyRequest(value) {
  return typeof value === "object" && value !== null
    && typeof value.message === "string"
    && typeof value.context === "object"
    && Array.isArray(value.history);
}

function isAllowedOrigin(origin) {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:")
      && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

function readServiceRevision() {
  try {
    return execFileSync("git", ["-c", `safe.directory=${process.cwd().replaceAll("\\", "/")}`, "rev-parse", "HEAD"], {
      cwd: process.cwd(), encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"]
    }).trim() || null;
  } catch {
    return null;
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function shutdown() {
  codexProvider.cancel();
  await codexProvider.cancelLogin();
  await browserProvider.close();
  server.close();
}

async function existingAssistantServer(serverPort) {
  try {
    const response = await fetch(`http://127.0.0.1:${serverPort}/api/assistant/status`, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.provider === "browser";
  } catch {
    return false;
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
