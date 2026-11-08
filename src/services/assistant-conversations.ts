import type { AssistantHistoryItem } from "./openai-build-assistant.js";

export const ASSISTANT_CONVERSATIONS_STORAGE_KEY = "dbd-build-tool.assistant-conversations";
export type ConversationProvider = "codex" | "openai";
export interface AssistantMessage extends AssistantHistoryItem { id: string }
export interface AssistantConversation {
  id: string;
  provider: ConversationProvider;
  title: string;
  updatedAt: string;
  messages: AssistantMessage[];
}

type ConversationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class LocalAssistantConversationRepository {
  constructor(private readonly storage: ConversationStorage) {}

  list(): AssistantConversation[] {
    const raw = this.storage.getItem(ASSISTANT_CONVERSATIONS_STORAGE_KEY);
    if (raw === null) return this.legacyConversations();
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error("Historique des conversations illisible ; les données sont conservées."); }
    if (!Array.isArray(value) || !value.every(isConversation) || new Set(value.map(({ id }) => id)).size !== value.length) {
      throw new Error("Historique des conversations invalide ; les données sont conservées.");
    }
    return value.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  create(provider: ConversationProvider): AssistantConversation {
    const conversation: AssistantConversation = { id: newId(), provider, title: "Nouvelle conversation", updatedAt: new Date().toISOString(), messages: [] };
    this.write([conversation, ...this.list()]);
    return conversation;
  }

  append(id: string, role: AssistantMessage["role"], content: string): void {
    const conversations = this.list();
    const conversation = conversations.find((entry) => entry.id === id);
    if (!conversation) throw new Error("Conversation supprimée ou introuvable.");
    if (role === "user" && !conversation.messages.some((entry) => entry.role === "user")) conversation.title = content.trim().slice(0, 60);
    conversation.messages.push({ id: newId(), role, content });
    conversation.updatedAt = new Date().toISOString();
    this.write(conversations);
  }

  delete(id: string): void { this.write(this.list().filter((entry) => entry.id !== id)); }

  private write(conversations: readonly AssistantConversation[]): void {
    this.storage.setItem(ASSISTANT_CONVERSATIONS_STORAGE_KEY, JSON.stringify(conversations));
    this.storage.removeItem("dbd-build-tool.assistant-session");
  }

  private legacyConversations(): AssistantConversation[] {
    const raw = this.storage.getItem("dbd-build-tool.assistant-session");
    if (!raw) return [];
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return []; }
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const provider = this.storage.getItem("dbd-build-tool.assistant-provider") === "openai" ? "openai" : "codex";
    return Object.entries(value).flatMap(([id, messages]) => Array.isArray(messages) && messages.every(isMessage) && messages.some((entry) => entry.role === "user")
      ? [{ id: `legacy:${id}`, provider, title: messages.find((entry) => entry.role === "user")!.content.trim().slice(0, 60), updatedAt: new Date(0).toISOString(), messages }]
      : []);
  }
}

function isMessage(value: unknown): value is AssistantMessage {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string" && (entry.role === "user" || entry.role === "assistant") && typeof entry.content === "string";
}

function isConversation(value: unknown): value is AssistantConversation {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string" && entry.id.length > 0 && (entry.provider === "codex" || entry.provider === "openai")
    && typeof entry.title === "string" && typeof entry.updatedAt === "string" && Number.isFinite(Date.parse(entry.updatedAt))
    && Array.isArray(entry.messages) && entry.messages.every(isMessage);
}

function newId(): string { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
