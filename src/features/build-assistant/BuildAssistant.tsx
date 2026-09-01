import { useEffect, useRef, useState, type FormEvent } from "react";

import type { Killer } from "../../domain/killer.js";
import type { Perk } from "../../domain/perk.js";
import {
  cancelBrowserProvider,
  configureBrowserProvider,
  createAssistantProvider,
  getCodexProviderStatus,
  getBrowserProviderStatus,
  normalizeServerUrl,
  ASSISTANT_SERVER_STORAGE_KEY,
  type AssistantActivity,
  type AssistantProviderId,
  type BrowserProviderStatus,
  type CodexProviderStatus
} from "../../services/assistant-provider.js";
import type { BuildCalculation, BuildScenario } from "../../services/build-calculator.js";
import { createNativeChatCopy, type CurrentBuildExport } from "../../services/local-data.js";
import { buildAssistantContext } from "../../services/openai-build-assistant.js";

interface BuildAssistantProps {
  conversationKey: string;
  killer: Killer;
  perks: readonly Perk[];
  scenario: BuildScenario;
  calculation: BuildCalculation;
  currentBuild: CurrentBuildExport;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const STORAGE_KEY = "dbd-build-tool.assistant-session";
const PROVIDER_STORAGE_KEY = "dbd-build-tool.assistant-provider";
const DEFAULT_SERVER = import.meta.env.VITE_ASSISTANT_SERVER_URL
  ?? import.meta.env.VITE_OPENAI_ASSISTANT_ENDPOINT
  ?? "http://127.0.0.1:8787";
const SUGGESTIONS = [
  "Explique les synergies de mes perks",
  "Suggère des améliorations vérifiables",
  "Montre tous les calculs",
  "Pourquoi cette statistique a changé ?"
] as const;

export function BuildAssistant({ conversationKey, killer, perks, scenario, calculation, currentBuild }: BuildAssistantProps) {
  const [histories, setHistories] = useState<Record<string, ChatMessage[]>>(loadHistories);
  const [draft, setDraft] = useState("");
  const [serverUrl, setServerUrl] = useState(loadServerUrl);
  const [providerId, setProviderId] = useState<AssistantProviderId>(loadProviderId);
  const [showConnection, setShowConnection] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [activity, setActivity] = useState<AssistantActivity>("idle");
  const [browserStatus, setBrowserStatus] = useState<BrowserProviderStatus | null>(null);
  const [codexStatus, setCodexStatus] = useState<CodexProviderStatus | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const requestController = useRef<AbortController | null>(null);
  const configuringRef = useRef(false);
  const messages = histories[conversationKey] ?? [welcomeMessage()];

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(histories));
    } catch {
      // L’assistant reste utilisable en mémoire si le stockage de session est bloqué.
    }
  }, [histories]);

  useEffect(() => {
    historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight });
  }, [messages.length, conversationKey]);

  useEffect(() => {
    if (!showConnection || providerId !== "browser") return;
    void refreshBrowserStatus(false);
  }, [showConnection, providerId]);

  useEffect(() => {
    if (!showConnection || providerId !== "codex") return;
    void refreshCodexStatus();
  }, [showConnection, providerId]);

  useEffect(() => {
    if (!isSending || providerId !== "browser") return;
    const refresh = (): void => { void refreshBrowserStatus(false); };
    refresh();
    const interval = window.setInterval(refresh, 700);
    return () => window.clearInterval(interval);
  }, [isSending, providerId, serverUrl]);

  function submit(event: FormEvent): void {
    event.preventDefault();
    void send(draft);
  }

  async function send(prompt: string): Promise<void> {
    const question = prompt.trim();
    if (!question || isSending) return;
    const previousMessages = histories[conversationKey] ?? [welcomeMessage()];
    const updatedMessages = [...previousMessages, message("user", question)];
    setHistories((current) => ({ ...current, [conversationKey]: updatedMessages }));
    setDraft("");
    setIsSending(true);
    setActivity("preparing_context");
    setConnectionError(null);
    const controller = new AbortController();
    requestController.current = controller;
    try {
      if (providerId === "clipboard") {
        const copied = await createNativeChatCopy(serverUrl, question, currentBuild);
        await copyText(copied.text);
        setActivity("completed");
        setHistories((current) => ({
          ...current,
          [conversationKey]: [...(current[conversationKey] ?? updatedMessages), message("assistant", `Contexte DBD, build actuel et question copiés (${copied.characters.toLocaleString("fr-FR")} caractères). Collez-les dans votre GPT distant.`)]
        }));
        return;
      }
      const context = buildAssistantContext({ killer, perks, scenario, calculation });
      setActivity(providerId === "browser" ? "starting_browser" : "sending_prompt");
      const provider = createAssistantProvider(providerId, serverUrl);
      const response = await provider.send({
        message: question,
        context,
        history: updatedMessages,
        localContext: { killer, perks, scenario, calculation }
      }, controller.signal);
      setActivity("completed");
      setHistories((current) => ({
        ...current,
        [conversationKey]: [...(current[conversationKey] ?? updatedMessages), message("assistant", response)]
      }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "erreur inconnue";
      setActivity("error");
      setHistories((current) => ({
        ...current,
        [conversationKey]: [...(current[conversationKey] ?? updatedMessages), message("assistant", `Provider ${providerLabel(providerId)} indisponible : ${detail}`)]
      }));
    } finally {
      requestController.current = null;
      setIsSending(false);
    }
  }

  async function configureBrowser(): Promise<void> {
    if (configuringRef.current) return;
    configuringRef.current = true;
    setIsConfiguring(true);
    setConnectionError(null);
    setActivity("starting_browser");
    try {
      saveSettings("browser", false);
      const currentStatus = await getBrowserProviderStatus(serverUrl);
      if (currentStatus.busy) {
        setBrowserStatus(currentStatus);
        throw new Error("Une connexion navigateur est déjà en cours. Annulez-la avant de recommencer.");
      }
      const status = await configureBrowserProvider(serverUrl);
      setBrowserStatus(status);
      setActivity("completed");
    } catch (error) {
      setActivity("error");
      setConnectionError(error instanceof Error ? error.message : "Configuration ChatGPT impossible.");
    } finally {
      configuringRef.current = false;
      setIsConfiguring(false);
    }
  }

  async function refreshCodexStatus(): Promise<void> {
    try {
      const status = await getCodexProviderStatus(serverUrl);
      setCodexStatus(status);
      setConnectionError(status.connected ? null : status.detail);
    } catch (error) {
      setCodexStatus(null);
      setConnectionError(error instanceof Error ? error.message : "Statut Codex indisponible.");
    }
  }

  async function refreshBrowserStatus(verify: boolean): Promise<void> {
    try {
      const status = await getBrowserProviderStatus(serverUrl, verify);
      setBrowserStatus(status);
      if (status.busy) setActivity(status.state);
      setConnectionError(status.error ?? null);
    } catch (error) {
      setBrowserStatus(null);
      setConnectionError(error instanceof Error ? error.message : "Serveur local inaccessible.");
    }
  }

  async function cancel(): Promise<void> {
    requestController.current?.abort();
    if (providerId === "browser" || providerId === "codex") await cancelBrowserProvider(serverUrl).catch(() => undefined);
    setActivity("idle");
  }

  function saveSettings(nextProvider = providerId, close = true): void {
    const normalizedUrl = normalizeServerUrl(serverUrl);
    if (!normalizedUrl) return;
    setServerUrl(normalizedUrl);
    setProviderId(nextProvider);
    if (close) setShowConnection(false);
    try {
      window.localStorage.setItem(ASSISTANT_SERVER_STORAGE_KEY, normalizedUrl);
      window.localStorage.setItem(PROVIDER_STORAGE_KEY, nextProvider);
    } catch {
      // La configuration reste disponible en mémoire.
    }
  }

  function clear(): void {
    setHistories((current) => ({ ...current, [conversationKey]: [welcomeMessage()] }));
  }

  return (
    <section className="analyzer-panel build-assistant" aria-labelledby="build-assistant-title">
      <div className="assistant-heading">
        <div className="compact-section-heading">
          <div>
            <span className="section-icon" aria-hidden="true">▣</span>
            <h2 id="build-assistant-title">Build Assistant</h2>
            <small>{providerLabel(providerId)}</small>
          </div>
        </div>
        <div className="assistant-heading-actions">
          <button className="secondary-button compact-button" type="button" onClick={() => setShowConnection((current) => !current)}>
            {providerId === "browser" ? "ChatGPT Browser" : "Provider"}
          </button>
          <button className="secondary-button compact-button" type="button" onClick={clear}>Vider</button>
        </div>
      </div>

      {showConnection && (
        <form className="assistant-connection" onSubmit={(event) => { event.preventDefault(); saveSettings(); }}>
          <fieldset>
            <legend>Provider</legend>
            {([
              ["local", "Moteur local"],
              ["clipboard", "Chat natif · copier/coller"],
              ["codex", "ChatGPT via Codex · recommandé"],
              ["browser", "Navigateur · expérimental"],
              ["openai", "OpenAI API"]
            ] as const).map(([id, label]) => (
              <label className="assistant-provider-option" key={id}>
                <input type="radio" name="assistant-provider" checked={providerId === id} onChange={() => setProviderId(id)} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>

          {providerId !== "local" && (
            <label>Serveur local
              <input type="url" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="http://127.0.0.1:8787" />
            </label>
          )}

          {providerId === "browser" && (
            <div className="assistant-browser-setup">
              <p className={`assistant-provider-status ${browserStatus?.connected ? "connected" : "disconnected"}`}>
                <span aria-hidden="true">●</span>
                {browserStatus?.connected ? "ChatGPT connecté" : browserStatus?.configured ? "Session à vérifier" : "ChatGPT non configuré"}
              </p>
              <p>Ce mode pilote l’interface web et peut être bloqué par un CAPTCHA. Il ne tente pas de contourner les contrôles de sécurité ; préférez le provider Codex.</p>
              <div>
                <button className="primary-button" type="button" onClick={() => void configureBrowser()} disabled={isConfiguring}>
                  {isConfiguring ? "Connexion en cours…" : "Configurer ChatGPT"}
                </button>
                <button className="secondary-button compact-button" type="button" onClick={() => void refreshBrowserStatus(true)} disabled={isConfiguring}>Vérifier</button>
                {isConfiguring && <button className="secondary-button compact-button" type="button" onClick={() => void cancel()}>Annuler</button>}
              </div>
            </div>
          )}

          {providerId === "codex" && (
            <div className="assistant-browser-setup">
              <p className={`assistant-provider-status ${codexStatus?.connected ? "connected" : "disconnected"}`}>
                <span aria-hidden="true">●</span>
                {codexStatus?.connected ? "Codex connecté avec ChatGPT" : codexStatus?.installed ? "Connexion ChatGPT requise" : "Codex CLI introuvable"}
              </p>
              <p>Provider officiel sans clé API. Il réutilise la connexion enregistrée par <code>codex login</code> et exécute l’analyse en lecture seule.</p>
              <div><button className="secondary-button compact-button" type="button" onClick={() => void refreshCodexStatus()}>Vérifier</button></div>
            </div>
          )}

          {providerId === "openai" && <p>Ce mode utilise le proxy local et nécessite <code>OPENAI_API_KEY</code> uniquement dans le processus serveur.</p>}
          {providerId === "clipboard" && <p>Le bouton d’envoi copie les connaissances DBD, le build actuel et votre question. Collez ensuite le contenu dans le GPT distant de votre choix.</p>}
          {providerId === "local" && <p>Ce mode répond uniquement à partir des calculs locaux, sans service externe.</p>}
          {connectionError && <p className="assistant-connection-error" role="alert">{connectionError}</p>}
          <div><button className="primary-button" type="submit">Enregistrer</button></div>
        </form>
      )}

      {isSending && (
        <div className="assistant-progress" role="status">
          <span className="assistant-spinner" aria-hidden="true" />
          <span>{activityLabel(activity)}</span>
          {(providerId === "browser" || providerId === "codex") && <button className="text-button" type="button" onClick={() => void cancel()}>Annuler</button>}
        </div>
      )}

      <div className="chat-history" ref={historyRef} aria-live="polite">
        {messages.map((entry) => (
          <article className={`chat-message ${entry.role}`} key={entry.id}>
            <span className="chat-avatar" aria-hidden="true">{entry.role === "user" ? "U" : "A"}</span>
            <div>
              <strong>{entry.role === "user" ? "Vous" : "Assistant"}</strong>
              <p>{entry.content}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="assistant-suggestions" aria-label="Questions suggérées">
        {SUGGESTIONS.map((suggestion) => (
          <button type="button" key={suggestion} onClick={() => void send(suggestion)} disabled={isSending}>{suggestion}</button>
        ))}
      </div>

      <form className={`chat-input ${providerId === "clipboard" ? "native-copy" : ""}`} onSubmit={submit}>
        <label className="sr-only" htmlFor="build-assistant-input">Question sur le build</label>
        <input
          id="build-assistant-input"
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Posez une question sur ce build…"
          disabled={isSending}
        />
        <button type="submit" aria-label={providerId === "clipboard" ? "Copier pour un GPT distant" : "Envoyer"} disabled={!draft.trim() || isSending}>{providerId === "clipboard" ? "Copier" : "➤"}</button>
      </form>
    </section>
  );
}

function welcomeMessage(): ChatMessage {
  return message("assistant", "Je peux expliquer les changements calculés, les conditions et les interactions de ce build.");
}

function message(role: ChatMessage["role"], content: string): ChatMessage {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, role, content };
}

async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("Le presse-papiers n’est pas disponible dans ce navigateur.");
  await navigator.clipboard.writeText(value);
}

function loadHistories(): Record<string, ChatMessage[]> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    return isChatStore(value) ? value : {};
  } catch {
    return {};
  }
}

function loadServerUrl(): string {
  try { return normalizeServerUrl(window.localStorage.getItem(ASSISTANT_SERVER_STORAGE_KEY) ?? window.sessionStorage.getItem(ASSISTANT_SERVER_STORAGE_KEY) ?? DEFAULT_SERVER); } catch { return normalizeServerUrl(DEFAULT_SERVER); }
}

function loadProviderId(): AssistantProviderId {
  try {
    const value = window.localStorage.getItem(PROVIDER_STORAGE_KEY) ?? window.sessionStorage.getItem(PROVIDER_STORAGE_KEY);
    return value === "browser" || value === "codex" || value === "openai" || value === "clipboard" || value === "local" ? value : "local";
  } catch {
    return "local";
  }
}

function providerLabel(provider: AssistantProviderId): string {
  if (provider === "browser") return "ChatGPT Browser";
  if (provider === "codex") return "ChatGPT via Codex";
  if (provider === "openai") return "OpenAI API";
  if (provider === "clipboard") return "Chat natif · copier/coller";
  return "Contexte du moteur";
}

function activityLabel(activity: AssistantActivity): string {
  const labels: Record<AssistantActivity, string> = {
    idle: "Prêt",
    preparing_context: "Préparation du contexte…",
    starting_browser: "Démarrage de Chromium…",
    checking_session: "Vérification de la session…",
    sending_prompt: "Envoi du prompt…",
    waiting_response: "ChatGPT prépare sa réponse…",
    extracting_response: "Récupération de la réponse…",
    completed: "Terminé",
    error: "Une erreur est survenue"
  };
  return labels[activity];
}

function isChatStore(value: unknown): value is Record<string, ChatMessage[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((messages) => Array.isArray(messages) && messages.every((entry) =>
    typeof entry === "object" && entry !== null
    && typeof (entry as ChatMessage).id === "string"
    && ((entry as ChatMessage).role === "user" || (entry as ChatMessage).role === "assistant")
    && typeof (entry as ChatMessage).content === "string"
  ));
}
