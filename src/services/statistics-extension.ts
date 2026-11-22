export const STATISTICS_EXTENSION_ID = "kiefmoeclpffgabjgaadfnmnfnocpffm";
interface ExtensionReply { ok: boolean; error?: string; userId?: string | null; status?: string | null; loginRequired?: boolean; remoteSupported?: boolean; guidedSetupSupported?: boolean; cloudConnected?: boolean; extensionId?: string }
type BrowserRuntime = {
  lastError?: { message?: string };
  sendMessage: (id: string, request: unknown, callback: (reply: ExtensionReply | undefined) => void) => void;
};

export function statisticsBrowser(userAgent: string): { name: string; supported: boolean; extensionsUrl: string } {
  if (/Android|iPhone|iPad|Mobile/i.test(userAgent)) return { name: "mobile", supported: false, extensionsUrl: "" };
  if (/Edg\//.test(userAgent)) return { name: "Edge", supported: true, extensionsUrl: "edge://extensions" };
  if (/OPR\//.test(userAgent)) return { name: "Opera", supported: true, extensionsUrl: "opera://extensions" };
  if (/Chrome\//.test(userAgent)) return { name: "Chrome / Chromium", supported: true, extensionsUrl: "chrome://extensions" };
  return { name: "ce navigateur", supported: false, extensionsUrl: "" };
}

export function statisticsStoreUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.origin === "https://chromewebstore.google.com" && /^\/detail\/(?:[a-z0-9-]+\/)?[a-p]{32}$/.test(url.pathname)
      && !url.username && !url.password && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}

function bridgeMessage(request: unknown, duration: number, extensionId?: string): Promise<ExtensionReply> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    function receive(event: MessageEvent): void {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== "DBD_STATISTICS_EXTENSION"
        || event.data.id !== id || typeof event.data.reply?.ok !== "boolean") return;
      cleanup();
      resolve(event.data.reply as ExtensionReply);
    }
    function cleanup(): void { clearTimeout(timeout); window.removeEventListener("message", receive); }
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Extension Statistiques introuvable.")); }, duration);
    window.addEventListener("message", receive);
    window.postMessage({ source: "DBD_BUILD_ANALYZER", id, request, extensionId }, window.location.origin);
  });
}

function legacyMessage(request: unknown): Promise<ExtensionReply> {
  const runtime = (globalThis as typeof globalThis & { chrome?: { runtime?: BrowserRuntime } }).chrome?.runtime;
  if (!runtime?.sendMessage) return Promise.reject(new Error("Installez l’extension Statistiques pour connecter Behaviour."));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("L’extension ne répond pas. Réessayez la connexion.")), 20_000);
    try {
      runtime.sendMessage(STATISTICS_EXTENSION_ID, request, (reply) => {
        clearTimeout(timeout);
        if (runtime.lastError || !reply) reject(new Error("Extension Statistiques introuvable. Installez-la pour continuer."));
        else if (!reply.ok) reject(new Error(reply.error ?? "L’extension a refusé la demande."));
        else resolve(reply);
      });
    } catch { clearTimeout(timeout); reject(new Error("Connexion à l’extension impossible.")); }
  });
}

export async function statisticsExtensionMessage(request: { type: string; [key: string]: unknown }): Promise<ExtensionReply> {
  const bridge = await bridgeMessage({ type: "DBD_EXTENSION_STATUS" }, 600).catch(() => null);
  const reply = bridge ? request.type === "DBD_EXTENSION_STATUS" ? bridge : await bridgeMessage(request, 20_000, bridge.extensionId) : await legacyMessage(request);
  if (!reply.ok) throw new Error(reply.error ?? "L’extension a refusé la demande.");
  return reply;
}
