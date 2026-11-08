import { useEffect, useRef, useState, type FormEvent } from "react";

import type { Build } from "../../domain/build.js";
import type { Killer } from "../../domain/killer.js";
import type { Perk } from "../../domain/perk.js";
import {
  ASSISTANT_PROVIDER_IDS, ASSISTANT_PROVIDER_STORAGE_KEY, ASSISTANT_SERVER_STORAGE_KEY,
  cancelCodexLogin, connectCodexProvider, connectOpenAIProvider, createAssistantProvider,
  disconnectCodexProvider, disconnectOpenAIProvider, getCodexProviderStatus, getOpenAIProviderStatus, normalizeServerUrl, selectCodexModel,
  type AssistantProviderId, type CodexProviderStatus, type OpenAIProviderStatus
} from "../../services/assistant-provider.js";
import { LocalAssistantConversationRepository, type AssistantConversation } from "../../services/assistant-conversations.js";
import type { AssistantAction, AssistantActionSnapshot } from "../../services/assistant-actions.js";
import type { CurrentBuildExport } from "../../services/local-data.js";
import { killerPowerDescription } from "../../services/killer-powers.js";
import { buildNativeChatPrompt } from "../../services/native-chat-prompt.js";
import type { PerkTierEntry } from "../../services/tier-list.js";

interface BuildAssistantProps {
  currentBuild: CurrentBuildExport;
  allKillers: readonly Killer[];
  allSurvivors: readonly Killer[];
  allPerks: readonly Perk[];
  savedBuilds: readonly Build[];
  perkTierList: readonly PerkTierEntry[];
  howToPlay: string;
  constants: string;
  perkDescriptionOverrides: Readonly<Record<string, string>>;
  onApplyActions: (actions: readonly AssistantAction[], snapshot: AssistantActionSnapshot) => string[];
}

const DEFAULT_SERVER = import.meta.env.VITE_ASSISTANT_SERVER_URL ?? import.meta.env.VITE_OPENAI_ASSISTANT_ENDPOINT ?? "http://127.0.0.1:8787";
const PROVIDER_LABELS = { clipboard: "Copier/Coller", codex: "Codex", openai: "Clé API" } as const;
const SUGGESTIONS = ["Explique les synergies de mes perks", "Crée deux variantes sauvegardées de ce build", "Explique les calculs et leurs limites"] as const;

export function BuildAssistant({ currentBuild, allKillers, allSurvivors, allPerks, savedBuilds, perkTierList, howToPlay, constants, perkDescriptionOverrides, onApplyActions }: BuildAssistantProps) {
  const [historyState] = useState(createHistoryRepository);
  const [conversations, setConversations] = useState(historyState.conversations);
  const [activeIds, setActiveIds] = useState<Record<"codex" | "openai", string | null>>({
    codex: historyState.conversations.find((entry) => entry.provider === "codex")?.id ?? null,
    openai: historyState.conversations.find((entry) => entry.provider === "openai")?.id ?? null
  });
  const [providerId, setProviderId] = useState<AssistantProviderId>(loadProviderId);
  const [serverUrl, setServerUrl] = useState(() => loadSetting(ASSISTANT_SERVER_STORAGE_KEY, DEFAULT_SERVER));
  const [showConnection, setShowConnection] = useState(false);
  const [draft, setDraft] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [codexStatus, setCodexStatus] = useState<CodexProviderStatus | null>(null);
  const [openaiStatus, setOpenaiStatus] = useState<OpenAIProviderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const requestController = useRef<AbortController | null>(null);
  const applyActionsRef = useRef(onApplyActions);
  applyActionsRef.current = onApplyActions;
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversation = providerId === "clipboard" ? undefined : conversations.find((entry) => entry.id === activeIds[providerId] && entry.provider === providerId);
  const messages = conversation?.messages ?? [];
  const connected = providerId === "clipboard" || (providerId === "codex" ? codexStatus?.connected : openaiStatus?.connected) === true;
  const ready = connected && (providerId !== "codex" || Boolean(codexStatus?.selectedModel));

  useEffect(() => {
    setApiKey("");
    setError(null);
  }, [providerId, serverUrl]);

  useEffect(() => {
    if (providerId === "clipboard" || isConnecting || isSending) return;
    let active = true;
    let checking = false;
    const check = async (): Promise<void> => {
      if (checking) return;
      checking = true;
      try {
        const status = providerId === "codex" ? await getCodexProviderStatus(serverUrl) : await getOpenAIProviderStatus(serverUrl);
        if (active) updateConnection(status);
      } catch (failure) { if (active) setError(errorMessage(failure)); }
      finally { checking = false; }
    };
    void check();
    const interval = providerId === "codex" && (codexStatus?.loginPending || codexStatus?.connected) ? window.setInterval(() => void check(), codexStatus.loginPending ? 1_500 : 30_000) : null;
    return () => { active = false; if (interval !== null) window.clearInterval(interval); };
  }, [providerId, serverUrl, codexStatus?.loginPending, codexStatus?.connected, isConnecting, isSending]);

  useEffect(() => { historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight }); }, [messages.length, conversation?.id]);
  useEffect(() => { if (providerId === "codex" && connected) inputRef.current?.focus(); }, [providerId, connected]);
  useEffect(() => () => requestController.current?.abort(), []);

  function selectProvider(id: AssistantProviderId): void {
    setProviderId(id);
    setShowConnection(id !== "clipboard");
    setCopyStatus(null);
    try { window.localStorage.setItem(ASSISTANT_PROVIDER_STORAGE_KEY, id); } catch { /* Le mode reste actif pour cette session. */ }
  }

  function updateConnection(status: CodexProviderStatus | OpenAIProviderStatus): void {
    if (status.connected) setShowConnection(false);
    if (status.provider === "codex") setCodexStatus(status);
    else { setOpenaiStatus(status); setModel((current) => current || status.model); }
  }

  async function configure(action: () => Promise<CodexProviderStatus | OpenAIProviderStatus>): Promise<void> {
    if (isConnecting) return;
    setIsConnecting(true);
    setError(null);
    try {
      const status = await action();
      updateConnection(status);
      try { window.localStorage.setItem(ASSISTANT_SERVER_STORAGE_KEY, normalizeServerUrl(serverUrl)); } catch { /* Connexion disponible sans stockage. */ }
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setApiKey(""); setIsConnecting(false); }
  }

  function createConversation(): void {
    if (providerId === "clipboard") return;
    try {
      const created = historyState.repository.create(providerId);
      setConversations(historyState.repository.list());
      setActiveIds((current) => ({ ...current, [providerId]: created.id }));
      setDraft("");
      setError(null);
    } catch (failure) { setError(errorMessage(failure)); }
  }

  function deleteConversation(): void {
    if (!conversation || providerId === "clipboard") return;
    try {
      historyState.repository.delete(conversation.id);
      const next = historyState.repository.list();
      setConversations(next);
      setActiveIds((current) => ({ ...current, [providerId]: next.find((entry) => entry.provider === providerId)?.id ?? null }));
      setError(null);
    } catch (failure) { setError(errorMessage(failure)); }
  }

  async function send(text: string): Promise<void> {
    const question = text.trim();
    if (!question || requestController.current || isConnecting) return;
    if (!connected) { setShowConnection(true); setError("Connectez ce mode avant d’envoyer votre question."); return; }
    if (!ready) { setError("Actualisez la liste des modèles Codex avant d’envoyer votre question."); return; }
    const controller = new AbortController();
    requestController.current = controller;
    setIsSending(true);
    setError(null);
    setCopyStatus(null);
    let targetId: string | null = null;
    try {
      let previousMessages = messages;
      if (providerId !== "clipboard") {
        const target = conversation ?? historyState.repository.create(providerId);
        targetId = target.id;
        previousMessages = target.messages;
        historyState.repository.append(target.id, "user", question);
        setConversations(historyState.repository.list());
        setActiveIds((current) => ({ ...current, [providerId]: target.id }));
      }
      const fullPrompt = buildNativeChatPrompt(question, currentBuild, {
        howToPlay, constants, killers: allKillers, survivors: allSurvivors, perks: allPerks, savedBuilds,
        perkDescriptionOverrides, killerPowerDescription,
        perkTierList: perkTierList.flatMap(({ perk, name, tier }) => perk ? [{ perkId: perk.id, name, tier }] : [])
      }, providerId === "clipboard" ? [] : previousMessages);
      if (providerId === "clipboard") {
        if (!navigator.clipboard?.writeText) throw new Error("Le presse-papiers n’est pas disponible dans ce navigateur.");
        await navigator.clipboard.writeText(fullPrompt);
        setCopyStatus(`Prompt complet et question copiés (${fullPrompt.length.toLocaleString("fr-FR")} caractères). Collez-les dans votre GPT externe.`);
      } else {
        const response = await createAssistantProvider(providerId, serverUrl).send({
          message: question, prompt: fullPrompt, history: previousMessages,
          context: currentBuild.assistantContext
        }, controller.signal);
        if (controller.signal.aborted) throw new DOMException("Requête annulée.", "AbortError");
        let report: string[] = [];
        try { report = applyActionsRef.current(response.actions, { currentBuild, savedBuilds, perks: allPerks, perkDescriptionOverrides }); }
        catch (failure) { report = [`Aucune action appliquée : ${errorMessage(failure)}`]; }
        appendReply(targetId!, [response.answer, ...report.map((line) => `• ${line}`)].join("\n\n"));
      }
      setDraft("");
    } catch (failure) {
      const detail = controller.signal.aborted ? "Requête annulée." : errorMessage(failure);
      if (targetId) appendReply(targetId, detail);
      else setError(detail);
    } finally { requestController.current = null; setIsSending(false); }
  }

  function appendReply(id: string, content: string): void {
    try { historyState.repository.append(id, "assistant", content); setConversations(historyState.repository.list()); }
    catch (failure) {
      setConversations((current) => current.map((entry) => entry.id === id ? { ...entry, messages: [...entry.messages, { id: `memory:${Date.now()}`, role: "assistant", content }] } : entry));
      setError(`La réponse reste visible, mais son historique n’a pas pu être enregistré : ${errorMessage(failure)}`);
    }
  }

  function submit(event: FormEvent): void { event.preventDefault(); void send(draft); }

  return <section className="analyzer-panel build-assistant" aria-labelledby="build-assistant-title">
    <div className="assistant-heading">
      <div className="compact-section-heading"><div><span className="section-icon" aria-hidden="true">▣</span><h2 id="build-assistant-title">Build Assistant</h2>{providerId !== "clipboard" && <small className={connected ? "assistant-connected" : ""}>{connected ? "Connecté" : "À connecter"}</small>}</div></div>
      {providerId === "codex" && <div className="assistant-codex-account" aria-label="Connexion Codex de l’application">
        <div className="assistant-codex-identity"><span>Compte Codex</span><strong title={codexStatus?.account?.email ?? undefined}>{codexStatus?.account?.email ?? (connected ? "Compte ChatGPT" : "Non connecté")}</strong>{codexStatus?.account?.plan && <small>{codexStatus.account.plan}</small>}</div>
        <label className="assistant-codex-model">Modèle Codex<select aria-label="Modèle Codex" value={codexStatus?.selectedModel ?? ""} onChange={(event) => void configure(() => selectCodexModel(serverUrl, event.target.value))} disabled={!connected || isConnecting || isSending || !codexStatus?.models.length}>
          {!codexStatus?.selectedModel && <option value="">{connected ? "Modèles indisponibles" : "À connecter"}</option>}
          {codexStatus?.models.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.isDefault ? " · recommandé" : ""}</option>)}
        </select></label>
        <details className="assistant-codex-quota">
          <summary>Quota restant <strong>{connected ? codexStatus?.quotas.length === 1 ? codexStatus.quotas[0]!.windows.map((window) => `${quotaWindow(window.durationMinutes)} : ${quotaPercent(window.remainingPercent)}`).join(" · ") : codexStatus?.quotas.length ? "Voir les limites" : "Non communiqué" : "À connecter"}</strong></summary>
          <div className="assistant-codex-quota-details">
            <p>Quota du compte, partagé avec ses autres utilisations.</p>
            {codexStatus?.quotas.map((quota) => <div key={quota.id}><strong>{quota.name}</strong>{quota.windows.map((window, index) => <div className="assistant-codex-quota-window" key={index}>
              <span>{quotaWindow(window.durationMinutes)} : {quotaPercent(window.remainingPercent)} restants</span>
              {window.remainingPercent !== null && <progress aria-label={`${quota.name} · ${quotaWindow(window.durationMinutes)}`} value={window.remainingPercent} max={100} />}
              <small>{window.resetsAt === null ? "Réinitialisation non communiquée" : `Réinitialisation : ${new Date(window.resetsAt * 1000).toLocaleString("fr-FR")}`}</small>
            </div>)}</div>)}
            {!codexStatus?.quotas.length && <p>{codexStatus?.quotaDetail ?? (connected ? "Codex ne communique pas de quota pour ce compte." : "Connectez votre compte pour consulter son quota.")}</p>}
          </div>
        </details>
        <div className="assistant-codex-buttons">
          {connected ? <button className="secondary-button compact-button" type="button" onClick={() => void configure(() => disconnectCodexProvider(serverUrl))} disabled={isConnecting || isSending}>Déconnecter</button> : codexStatus?.loginPending ? <button className="secondary-button compact-button" type="button" onClick={() => void configure(() => cancelCodexLogin(serverUrl))} disabled={isConnecting}>Annuler la connexion</button> : <button className="primary-button compact-button" type="button" onClick={() => void configure(() => connectCodexProvider(serverUrl))} disabled={isConnecting || isSending}>{isConnecting ? "Connexion…" : "Connecter Codex"}</button>}
          <button className="secondary-button compact-button" type="button" aria-label="Actualiser les informations Codex" title="Actualiser le compte, les modèles et les quotas" onClick={() => void configure(() => getCodexProviderStatus(serverUrl, true))} disabled={isConnecting || isSending}>↻</button>
        </div>
      </div>}
      {providerId === "openai" && <button className="secondary-button compact-button" type="button" onClick={() => setShowConnection((current) => !current)} aria-expanded={showConnection || !connected} aria-controls="assistant-connection">Connexion</button>}
    </div>
    <div className="assistant-provider-tabs" role="group" aria-label="Mode de l’assistant">
      {ASSISTANT_PROVIDER_IDS.map((id) => <button key={id} type="button" aria-pressed={providerId === id} onClick={() => selectProvider(id)} disabled={isSending || isConnecting}>{PROVIDER_LABELS[id]}</button>)}
    </div>
    {providerId === "clipboard" ? <p className="assistant-mode-description">Écrivez votre question puis cliquez sur Copier. Le prompt complet reprend le catalogue, les descriptions affichées, les constantes, les tier lists et vos builds.</p> : <>
      {((providerId === "openai" && showConnection) || !connected) && <div className="assistant-connection" id="assistant-connection">
        {providerId === "openai" && <label>Serveur local<input type="url" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} disabled={isSending || isConnecting} /></label>}
        {providerId === "codex" ? <>
          <p className={`assistant-provider-status ${connected ? "connected" : ""}`}>{codexStatus?.detail ?? "Vérification de votre connexion…"}</p>
          {!connected && !codexStatus?.loginPending && <p>Connectez le compte ChatGPT de votre choix. Cette connexion appartient à l’application et reste indépendante de VS Code. La page ChatGPT s’ouvre dans votre navigateur ; vérifiez le compte choisi avant de valider.</p>}
          {codexStatus?.loginPending && <p role="status">Terminez la connexion dans la page ChatGPT. Le chat s’ouvrira automatiquement.{codexStatus.loginUrl && <> <a href={codexStatus.loginUrl} target="_blank" rel="noreferrer">Ouvrir la page de connexion</a></>}</p>}
        </> : <>
          <p className={`assistant-provider-status ${connected ? "connected" : ""}`}>{connected ? `Clé API connectée · ${openaiStatus?.model}` : "Connectez votre clé API OpenAI."}</p>
          <label>Clé API<input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-…" disabled={isConnecting || isSending} /></label>
          <label>Modèle<input type="text" value={model} onChange={(event) => setModel(event.target.value)} placeholder={openaiStatus?.model ?? "gpt-5-mini"} disabled={isConnecting || isSending} /></label>
          <p>La clé reste uniquement en mémoire dans le serveur local et disparaît à son arrêt. Les appels API utilisent votre compte OpenAI.</p>
          <div>
            <button type="button" className="primary-button" onClick={() => void configure(() => connectOpenAIProvider(serverUrl, apiKey, model || openaiStatus?.model || "gpt-5-mini"))} disabled={!apiKey.trim() || isConnecting || isSending}>{isConnecting ? "Connexion…" : "Connecter la clé"}</button>
            {connected && <button type="button" className="secondary-button compact-button" onClick={() => void configure(() => disconnectOpenAIProvider(serverUrl))} disabled={isConnecting || isSending}>Déconnecter</button>}
          </div>
        </>}
      </div>}
      <div className="assistant-conversations">
        <label className="sr-only" htmlFor="assistant-conversation">Conversations {PROVIDER_LABELS[providerId]}</label>
        <select id="assistant-conversation" value={conversation?.id ?? ""} onChange={(event) => setActiveIds((current) => ({ ...current, [providerId]: event.target.value }))} disabled={isSending}>
          <option value="">Nouvelle conversation</option>
          {conversations.filter((entry) => entry.provider === providerId).map((entry) => <option value={entry.id} key={entry.id}>{entry.title}</option>)}
        </select>
        <button className="secondary-button compact-button" type="button" onClick={createConversation} disabled={isSending}>Nouvelle</button>
        <button className="secondary-button compact-button" type="button" onClick={deleteConversation} disabled={!conversation || isSending}>Supprimer</button>
      </div>
      <div className="chat-history" ref={historyRef} aria-live="polite">
        {messages.length === 0 && <p className="assistant-mode-description">Posez une question ou demandez de modifier des descriptions, des tiers et des builds.</p>}
        {messages.map((entry) => <article className={`chat-message ${entry.role}`} key={entry.id}>
          <span className="chat-avatar" aria-hidden="true">{entry.role === "user" ? "U" : "A"}</span>
          <div><strong>{entry.role === "user" ? "Vous" : PROVIDER_LABELS[providerId]}</strong><p>{entry.content}</p></div>
        </article>)}
      </div>
    </>}
    {historyState.warning && <p className="assistant-connection-error" role="status">{historyState.warning}</p>}
    {error && <p className="assistant-connection-error" role="alert">{error}</p>}
    {copyStatus && <p className="assistant-copy-status" role="status">{copyStatus}</p>}
    {isSending && <div className="assistant-progress" role="status"><span className="assistant-spinner" aria-hidden="true" /><span>{providerId === "clipboard" ? "Copie du prompt…" : "Réponse en cours…"}</span><button className="text-button" type="button" onClick={() => requestController.current?.abort()}>Annuler</button></div>}
    {providerId !== "clipboard" && <div className="assistant-suggestions" aria-label="Questions suggérées">{SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" onClick={() => void send(suggestion)} disabled={!ready || isSending || isConnecting}>{suggestion}</button>)}</div>}
    <form className={`chat-input ${providerId === "clipboard" ? "native-copy" : ""}`} onSubmit={submit}>
      <label className="sr-only" htmlFor="build-assistant-input">Question ou demande de modification</label>
      <textarea ref={inputRef} id="build-assistant-input" rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={providerId === "clipboard" ? "Votre question pour le GPT externe…" : "Une question, une description à modifier, un build à créer…"} disabled={isSending}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); } }} />
      <button type="submit" aria-label={providerId === "clipboard" ? "Copier le prompt complet" : "Envoyer"} disabled={!draft.trim() || !ready || isSending || isConnecting}>{providerId === "clipboard" ? "Copier" : "➤"}</button>
    </form>
  </section>;
}

function createHistoryRepository(): { repository: LocalAssistantConversationRepository; conversations: AssistantConversation[]; warning: string | null } {
  try {
    const repository = new LocalAssistantConversationRepository(window.localStorage);
    return { repository, conversations: repository.list(), warning: null };
  } catch {
    const values = new Map<string, string>();
    const repository = new LocalAssistantConversationRepository({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } });
    return { repository, conversations: [], warning: "Historique local indisponible : les conversations de cette session restent en mémoire. Les anciennes données sont conservées." };
  }
}
function loadSetting(key: string, fallback: string): string { try { return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function loadProviderId(): AssistantProviderId { const value = loadSetting(ASSISTANT_PROVIDER_STORAGE_KEY, "clipboard"); return value === "codex" || value === "openai" ? value : "clipboard"; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "Erreur inconnue."; }
function quotaPercent(value: number | null): string { return value === null ? "Non communiqué" : `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`; }
function quotaWindow(minutes: number | null): string { return minutes === null ? "Période" : minutes % 1440 === 0 ? `${minutes / 1440} j` : minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`; }
