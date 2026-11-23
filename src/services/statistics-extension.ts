export const STATISTICS_EXTENSION_ID = "cljdeckobhfikpiecnpjlhmlbaeoalgh";
interface ExtensionReply { ok: boolean; error?: string; userId?: string | null; status?: string | null; loginRequired?: boolean; remoteSupported?: boolean; guidedSetupSupported?: boolean; cloudConnected?: boolean; extensionId?: string }
type BrowserRuntime = {
  lastError?: { message?: string };
  sendMessage: (id: string, request: unknown, callback: (reply: ExtensionReply | undefined) => void) => void;
};

export const statisticsBrowsers = {
  chrome: { name: "Chrome / Chromium", supported: true, extensionsUrl: "chrome://extensions" },
  edge: { name: "Edge", supported: true, extensionsUrl: "edge://extensions" },
  opera: { name: "Opera / Opera GX", supported: true, extensionsUrl: "opera://extensions" },
  brave: { name: "Brave", supported: true, extensionsUrl: "brave://extensions" },
  vivaldi: { name: "Vivaldi", supported: true, extensionsUrl: "vivaldi://extensions" },
  firefox: { name: "Firefox", supported: false, extensionsUrl: "" },
  safari: { name: "Safari", supported: false, extensionsUrl: "" },
  mobile: { name: "Navigateur mobile", supported: false, extensionsUrl: "" },
  other: { name: "Autre navigateur", supported: false, extensionsUrl: "" },
};

export function statisticsBrowser(userAgent: string): { name: string; supported: boolean; extensionsUrl: string } {
  if (/Android|iPhone|iPad|Mobile/i.test(userAgent)) return statisticsBrowsers.mobile;
  if (/Edg\//.test(userAgent)) return statisticsBrowsers.edge;
  if (/OPR\//.test(userAgent)) return statisticsBrowsers.opera;
  if (/Vivaldi\//.test(userAgent)) return statisticsBrowsers.vivaldi;
  if (/Brave\//.test(userAgent)) return statisticsBrowsers.brave;
  if (/Firefox\//.test(userAgent)) return statisticsBrowsers.firefox;
  if (/Chrome\/|Chromium\//.test(userAgent)) return statisticsBrowsers.chrome;
  if (/Safari\//.test(userAgent)) return statisticsBrowsers.safari;
  return statisticsBrowsers.other;
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

function runtimeMessage(request: unknown): Promise<ExtensionReply> {
  const runtime = (globalThis as typeof globalThis & { chrome?: { runtime?: BrowserRuntime } }).chrome?.runtime;
  if (!runtime?.sendMessage) return Promise.reject(new Error("L’API de communication Chrome est indisponible dans cet onglet."));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("L’extension ne répond pas. Réessayez la connexion.")), 20_000);
    try {
      runtime.sendMessage(STATISTICS_EXTENSION_ID, request, (reply) => {
        clearTimeout(timeout);
        const failure = runtime.lastError;
        if (failure || !reply) reject(new Error(failure?.message ?? "L’extension n’a renvoyé aucune réponse."));
        else if (!reply.ok) reject(new Error(reply.error ?? "L’extension a refusé la demande."));
        else resolve(reply);
      });
    } catch { clearTimeout(timeout); reject(new Error("Connexion à l’extension impossible.")); }
  });
}

export async function statisticsExtensionMessage(request: { type: string; [key: string]: unknown }): Promise<ExtensionReply> {
  let directError = "";
  const direct = await runtimeMessage({ type: "DBD_EXTENSION_STATUS" }).catch((cause: unknown) => {
    directError = cause instanceof Error ? cause.message : String(cause);
    return null;
  });
  if (direct) return request.type === "DBD_EXTENSION_STATUS" ? direct : runtimeMessage(request);
  const bridge = await bridgeMessage({ type: "DBD_EXTENSION_STATUS" }, 600).catch(() => null);
  if (!bridge) throw new Error(`Extension non détectée dans cet onglet. Connexion Chrome : ${directError} Passerelle du site : aucune réponse.`);
  const reply = request.type === "DBD_EXTENSION_STATUS" ? bridge : await bridgeMessage(request, 20_000, bridge.extensionId);
  if (!reply.ok) throw new Error(reply.error ?? "L’extension a refusé la demande.");
  return reply;
}
