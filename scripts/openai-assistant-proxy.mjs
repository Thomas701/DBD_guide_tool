import { createServer } from "node:http";

import { BrowserChatGPTProvider, BrowserProviderError } from "./chatgpt-browser-provider.mjs";
import { CodexChatGPTProvider, CodexProviderError } from "./codex-assistant-provider.mjs";
import { createNativeChatPrompt, updateNativePerk, writeCurrentBuild } from "./local-data-files.mjs";

const port = Number(process.env.OPENAI_ASSISTANT_PORT ?? 8787);
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL ?? "gpt-5-mini";
const browserProvider = new BrowserChatGPTProvider();
const codexProvider = new CodexChatGPTProvider();

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && !isAllowedOrigin(origin)) return send(response, 403, { error: "Origine non autorisée." });
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (request.method === "OPTIONS") return response.writeHead(204).end();

  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  try {
    if (request.method === "GET" && url.pathname === "/api/assistant/status") {
      if (url.searchParams.get("verify") === "1" && !browserProvider.snapshot().busy) {
        await browserProvider.checkSession().catch(() => undefined);
      }
      return send(response, 200, browserProvider.snapshot());
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
      return send(response, 200, await codexProvider.status());
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
    if (request.method === "POST" && url.pathname === "/api/local-data/copy-prompt") {
      const body = await readJson(request);
      if (!isRecord(body) || typeof body.question !== "string" || !isRecord(body.currentBuild)) {
        throw new HttpError(400, "Question ou build courant invalide.");
      }
      const text = await createNativeChatPrompt(body.question, body.currentBuild);
      return send(response, 200, { text, characters: text.length });
    }
    if (request.method === "POST" && url.pathname === "/api/assistant/message") {
      const body = await readJson(request);
      if (!isAssistantRequest(body)) return send(response, 400, { error: "Requête Build Assistant invalide." });
      if (body.provider === "browser") {
        if (typeof body.prompt !== "string" || !body.prompt.trim()) return send(response, 400, { error: "Prompt ChatGPT Browser manquant." });
        const result = await browserProvider.ask(body.prompt);
        return send(response, 200, { answer: result.content, conversationId: result.conversationId, durationMs: result.durationMs });
      }
      if (body.provider === "codex") {
        if (typeof body.prompt !== "string" || !body.prompt.trim()) return send(response, 400, { error: "Prompt Codex manquant." });
        return send(response, 200, { answer: await codexProvider.ask(body.prompt) });
      }
      return send(response, 200, { answer: await askOpenAI(body) });
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

async function askOpenAI(body) {
  if (!apiKey) throw new HttpError(503, "OPENAI_API_KEY est requise uniquement pour le provider OpenAI API.");
  const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      instructions: "Tu es un analyste expert de builds Dead by Daylight. Réponds en français. Utilise uniquement le contexte fourni pour les statistiques chiffrées ; distingue clairement les hypothèses et les données non calculables.",
      input: `Contexte du build (JSON) :\n${JSON.stringify(body.context)}\n\nHistorique récent :\n${JSON.stringify(body.history)}\n\nQuestion : ${body.message}`
    })
  });
  const result = await openaiResponse.json();
  if (!openaiResponse.ok) throw new HttpError(openaiResponse.status, result?.error?.message ?? "Erreur OpenAI.");
  const answer = result.output_text ?? result.output?.flatMap((item) => item.content ?? []).find((content) => content.type === "output_text")?.text;
  if (typeof answer !== "string" || !answer.trim()) throw new HttpError(502, "Réponse OpenAI sans texte.");
  return answer;
}

function sendError(response, error) {
  if (error instanceof HttpError) return send(response, error.status, { error: error.message });
  if (error instanceof BrowserProviderError) return send(response, browserErrorStatus(error.code), { error: error.message, code: error.code });
  if (error instanceof CodexProviderError) return send(response, codexErrorStatus(error.code), { error: error.message, code: error.code });
  return send(response, 500, { error: error instanceof Error ? error.message : "Erreur serveur inconnue." });
}

function codexErrorStatus(code) {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "BUSY") return 409;
  if (code === "TIMEOUT") return 504;
  if (code === "CODEX_NOT_FOUND" || code === "CODEX_ACCESS_DENIED") return 503;
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
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
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
    && typeof value.context === "object" && value.context !== null
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

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function shutdown() {
  codexProvider.cancel();
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
