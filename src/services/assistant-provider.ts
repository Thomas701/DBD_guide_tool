import { parseAssistantResponse, type AssistantResponse } from "./assistant-actions.js";
import { buildChatGPTPrompt } from "./chatgpt-prompt-builder.js";
import type { AssistantBuildContext, AssistantHistoryItem } from "./openai-build-assistant.js";

export const ASSISTANT_PROVIDER_IDS = ["clipboard", "codex", "openai"] as const;
export const ASSISTANT_SERVER_STORAGE_KEY = "dbd-build-tool.openai-assistant-endpoint";
export const ASSISTANT_PROVIDER_STORAGE_KEY = "dbd-build-tool.assistant-provider";
export type AssistantProviderId = (typeof ASSISTANT_PROVIDER_IDS)[number];

export interface AssistantRequest {
  message: string;
  context: AssistantBuildContext | null;
  history: readonly AssistantHistoryItem[];
  prompt?: string;
}
export interface AssistantProvider {
  readonly id: AssistantProviderId;
  send(request: AssistantRequest, signal?: AbortSignal): Promise<AssistantResponse>;
}
export interface CodexProviderStatus {
  provider: "codex";
  installed: boolean;
  connected: boolean;
  detail: string;
  loginPending: boolean;
  loginUrl: string | null;
  account: { email: string | null; plan: string | null } | null;
  models: { id: string; name: string; isDefault: boolean }[];
  selectedModel: string | null;
  quotas: CodexQuota[];
  quotaDetail: string | null;
}
export interface CodexQuota {
  id: string;
  name: string;
  windows: { remainingPercent: number | null; durationMinutes: number | null; resetsAt: number | null }[];
}
export interface OpenAIProviderStatus { provider: "openai"; connected: boolean; model: string }

export function createAssistantProvider(id: AssistantProviderId, serverUrl: string): AssistantProvider {
  return {
    id,
    async send(request, signal) {
      if (id === "clipboard") throw new Error("Le prompt doit être copié depuis l’interface.");
      const payload = await requestJson(`${normalizeServerUrl(serverUrl)}/api/assistant/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: id,
          message: request.message,
          context: request.context,
          history: request.history.slice(-20),
          prompt: request.prompt ?? (request.context ? buildChatGPTPrompt(request.message, request.context, request.history) : request.message),
          actionMode: true
        }),
        signal: signal ?? null
      });
      return parseAssistantResponse(payload);
    }
  };
}

export async function getCodexProviderStatus(serverUrl: string, refresh = false): Promise<CodexProviderStatus> {
  return codexStatus(await requestJson(`${normalizeServerUrl(serverUrl)}/api/assistant/codex/status${refresh ? "?refresh=1" : ""}`));
}
export async function connectCodexProvider(serverUrl: string): Promise<CodexProviderStatus> {
  return codexStatus(await requestJson(`${normalizeServerUrl(serverUrl)}/api/assistant/codex/login`, { method: "POST" }));
}
export async function cancelCodexLogin(serverUrl: string): Promise<CodexProviderStatus> {
  return codexStatus(await requestJson(`${normalizeServerUrl(serverUrl)}/api/assistant/codex/login`, { method: "DELETE" }));
}
export async function disconnectCodexProvider(serverUrl: string): Promise<CodexProviderStatus> {
  return codexStatus(await requestJson(`${normalizeServerUrl(serverUrl)}/api/assistant/codex/logout`, { method: "POST" }));
}
export async function selectCodexModel(serverUrl: string, model: string): Promise<CodexProviderStatus> {
  return codexStatus(await requestJson(`${normalizeServerUrl(serverUrl)}/api/assistant/codex/model`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model })
  }));
}
export async function getOpenAIProviderStatus(serverUrl: string): Promise<OpenAIProviderStatus> {
  return openaiStatus(await requestJson(`${normalizeServerUrl(serverUrl)}/api/assistant/openai/status`));
}
export async function connectOpenAIProvider(serverUrl: string, apiKey: string, model: string): Promise<OpenAIProviderStatus> {
  const url = new URL(normalizeServerUrl(serverUrl));
  if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) {
    throw new Error("La clé API doit être confiée au serveur local de l’application.");
  }
  return openaiStatus(await requestJson(`${url.toString().replace(/\/$/, "")}/api/assistant/openai/connect`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey, model })
  }));
}
export async function disconnectOpenAIProvider(serverUrl: string): Promise<OpenAIProviderStatus> {
  return openaiStatus(await requestJson(`${normalizeServerUrl(serverUrl)}/api/assistant/openai/connect`, { method: "DELETE" }));
}

export function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/(?:api\/build-assistant|api\/assistant\/message)\/?$/, "").replace(/\/$/, "");
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try { response = await fetch(url, init); }
  catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(`Build Assistant inaccessible sur ${new URL(url).origin}. Fermez puis relancez l’application avec son lanceur.`);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : `Erreur HTTP ${response.status}`);
  return payload;
}
function codexStatus(value: unknown): CodexProviderStatus {
  if (!isRecord(value) || value.provider !== "codex" || typeof value.installed !== "boolean" || typeof value.connected !== "boolean" || typeof value.detail !== "string" || !Array.isArray(value.models) || !Array.isArray(value.quotas)) {
    throw new Error("Statut Codex invalide. Redémarrez le serveur de l’application.");
  }
  let loginUrl: string | null = null;
  if (typeof value.loginUrl === "string") {
    try { const url = new URL(value.loginUrl); if (url.origin === "https://auth.openai.com" && !url.username && !url.password) loginUrl = url.toString(); } catch { /* Un lien de connexion mal formé est ignoré. */ }
  }
  const models = value.models.flatMap((entry: unknown) => isRecord(entry) && typeof entry.id === "string" && typeof entry.name === "string" ? [{ id: entry.id, name: entry.name, isDefault: entry.isDefault === true }] : []);
  const quotas: CodexQuota[] = value.quotas.flatMap((entry: unknown) => isRecord(entry) && typeof entry.id === "string" && typeof entry.name === "string" && Array.isArray(entry.windows) ? [{
    id: entry.id, name: entry.name,
    windows: entry.windows.flatMap((window: unknown) => isRecord(window) ? [{
      remainingPercent: typeof window.remainingPercent === "number" && Number.isFinite(window.remainingPercent) && window.remainingPercent >= 0 && window.remainingPercent <= 100 ? window.remainingPercent : null,
      durationMinutes: positiveFinite(window.durationMinutes), resetsAt: positiveFinite(window.resetsAt)
    }] : [])
  }] : []);
  return {
    provider: "codex", installed: value.installed, connected: value.connected, detail: value.detail, loginPending: value.loginPending === true, loginUrl,
    account: value.connected && isRecord(value.account) ? { email: typeof value.account.email === "string" ? value.account.email : null, plan: typeof value.account.plan === "string" ? value.account.plan : null } : null,
    models, selectedModel: typeof value.selectedModel === "string" && models.some((entry) => entry.id === value.selectedModel) ? value.selectedModel : null,
    quotas: value.connected ? quotas : [], quotaDetail: typeof value.quotaDetail === "string" ? value.quotaDetail : null
  };
}
function positiveFinite(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null; }
function openaiStatus(value: unknown): OpenAIProviderStatus {
  if (!isRecord(value) || value.provider !== "openai" || typeof value.connected !== "boolean" || typeof value.model !== "string") throw new Error("Statut API invalide. Redémarrez le serveur de l’application.");
  return { provider: "openai", connected: value.connected, model: value.model };
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
