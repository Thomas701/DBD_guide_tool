import type { BuildCalculation, BuildScenario } from "./build-calculator.js";
import type { Killer } from "../domain/killer.js";
import type { Perk } from "../domain/perk.js";
import { answerBuildQuestion } from "./build-assistant.js";
import { buildChatGPTPrompt } from "./chatgpt-prompt-builder.js";
import type { AssistantBuildContext, AssistantHistoryItem } from "./openai-build-assistant.js";

export const ASSISTANT_PROVIDER_IDS = ["local", "clipboard", "codex", "openai", "browser"] as const;
export const ASSISTANT_SERVER_STORAGE_KEY = "dbd-build-tool.openai-assistant-endpoint";
export type AssistantProviderId = (typeof ASSISTANT_PROVIDER_IDS)[number];
export type AssistantActivity = "idle" | "preparing_context" | "starting_browser" | "checking_session" | "sending_prompt" | "waiting_response" | "extracting_response" | "completed" | "error";

export interface AssistantRequest {
  message: string;
  context: AssistantBuildContext;
  history: readonly AssistantHistoryItem[];
  localContext: { killer: Killer; perks: readonly Perk[]; scenario: BuildScenario; calculation: BuildCalculation };
}

export interface AssistantProvider {
  readonly id: AssistantProviderId;
  send(request: AssistantRequest, signal?: AbortSignal): Promise<string>;
}

export interface BrowserProviderStatus {
  provider: "browser";
  connected: boolean;
  configured: boolean;
  busy: boolean;
  state: AssistantActivity;
  error?: string;
}

export interface CodexProviderStatus {
  provider: "codex";
  installed: boolean;
  connected: boolean;
  detail: string;
}

export class LocalAnalysisProvider implements AssistantProvider {
  readonly id = "local" as const;
  async send(request: AssistantRequest): Promise<string> {
    return answerBuildQuestion(request.message, request.localContext);
  }
}

export class OpenAIAPIProvider implements AssistantProvider {
  readonly id = "openai" as const;
  constructor(private readonly serverUrl: string) {}
  send(request: AssistantRequest, signal?: AbortSignal): Promise<string> {
    return sendHttpRequest(this.serverUrl, this.id, request, signal);
  }
}

export class BrowserChatGPTProvider implements AssistantProvider {
  readonly id = "browser" as const;
  constructor(private readonly serverUrl: string) {}
  send(request: AssistantRequest, signal?: AbortSignal): Promise<string> {
    return sendHttpRequest(this.serverUrl, this.id, request, signal);
  }
}

export class CodexChatGPTProvider implements AssistantProvider {
  readonly id = "codex" as const;
  constructor(private readonly serverUrl: string) {}
  send(request: AssistantRequest, signal?: AbortSignal): Promise<string> {
    return sendHttpRequest(this.serverUrl, this.id, request, signal);
  }
}

export function createAssistantProvider(id: AssistantProviderId, serverUrl: string): AssistantProvider {
  if (id === "openai") return new OpenAIAPIProvider(serverUrl);
  if (id === "browser") return new BrowserChatGPTProvider(serverUrl);
  if (id === "codex") return new CodexChatGPTProvider(serverUrl);
  if (id === "clipboard") return { id, send: async () => { throw new Error("Le chat natif doit être copié depuis l’interface."); } };
  return new LocalAnalysisProvider();
}

export async function configureBrowserProvider(serverUrl: string): Promise<BrowserProviderStatus> {
  return requestStatus(`${normalizeServerUrl(serverUrl)}/api/assistant/configure`, { method: "POST" });
}

export async function getBrowserProviderStatus(serverUrl: string, verify = false): Promise<BrowserProviderStatus> {
  return requestStatus(`${normalizeServerUrl(serverUrl)}/api/assistant/status${verify ? "?verify=1" : ""}`);
}

export async function cancelBrowserProvider(serverUrl: string): Promise<void> {
  const response = await assistantFetch(`${normalizeServerUrl(serverUrl)}/api/assistant/cancel`, { method: "POST" });
  if (!response.ok) throw new Error(await errorFromResponse(response));
}

export async function getCodexProviderStatus(serverUrl: string): Promise<CodexProviderStatus> {
  const response = await assistantFetch(`${normalizeServerUrl(serverUrl)}/api/assistant/codex/status`);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isCodexStatus(payload)) throw new Error(isError(payload) ? payload.error : "Statut Codex indisponible.");
  return payload;
}

export function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/(?:api\/build-assistant|api\/assistant\/message)\/?$/, "").replace(/\/$/, "");
}

async function sendHttpRequest(serverUrl: string, provider: "openai" | "browser" | "codex", request: AssistantRequest, signal?: AbortSignal): Promise<string> {
  const response = await assistantFetch(`${normalizeServerUrl(serverUrl)}/api/assistant/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      message: request.message,
      context: request.context,
      history: request.history.slice(-8),
      prompt: provider === "browser" || provider === "codex" ? buildChatGPTPrompt(request.message, request.context, request.history) : undefined
    }),
    signal: signal ?? null
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isAnswer(payload)) throw new Error(isError(payload) ? payload.error : "Le provider n’a pas renvoyé de réponse exploitable.");
  return payload.answer;
}

async function requestStatus(url: string, init?: RequestInit): Promise<BrowserProviderStatus> {
  const response = await assistantFetch(url, init);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isBrowserStatus(payload)) throw new Error(isError(payload) ? payload.error : "Statut ChatGPT Browser indisponible.");
  return payload;
}

async function assistantFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error(`Proxy Build Assistant inaccessible sur ${new URL(url).origin}. Lancez \`npm run assistant:proxy\` dans un terminal et laissez-le ouvert.`);
  }
}

async function errorFromResponse(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  return isError(payload) ? payload.error : `Erreur HTTP ${response.status}`;
}

function isAnswer(value: unknown): value is { answer: string } {
  return typeof value === "object" && value !== null && "answer" in value && typeof value.answer === "string";
}

function isError(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string";
}

function isBrowserStatus(value: unknown): value is BrowserProviderStatus {
  return typeof value === "object" && value !== null
    && "provider" in value && value.provider === "browser"
    && "connected" in value && typeof value.connected === "boolean"
    && "configured" in value && typeof value.configured === "boolean"
    && "busy" in value && typeof value.busy === "boolean"
    && "state" in value && typeof value.state === "string";
}

function isCodexStatus(value: unknown): value is CodexProviderStatus {
  return typeof value === "object" && value !== null
    && "provider" in value && value.provider === "codex"
    && "installed" in value && typeof value.installed === "boolean"
    && "connected" in value && typeof value.connected === "boolean"
    && "detail" in value && typeof value.detail === "string";
}
