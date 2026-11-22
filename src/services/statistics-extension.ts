export const STATISTICS_EXTENSION_ID = "kiefmoeclpffgabjgaadfnmnfnocpffm";
interface ExtensionReply { ok: boolean; error?: string; userId?: string | null; status?: string | null; loginRequired?: boolean }
type BrowserRuntime = {
  lastError?: { message?: string };
  sendMessage: (id: string, request: unknown, callback: (reply: ExtensionReply | undefined) => void) => void;
};

export function statisticsExtensionMessage(request: unknown): Promise<ExtensionReply> {
  const runtime = (globalThis as typeof globalThis & { chrome?: { runtime?: BrowserRuntime } }).chrome?.runtime;
  if (!runtime?.sendMessage) return Promise.reject(new Error("Installez l’extension Statistiques dans Chrome ou Edge, puis rechargez cette page."));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("L’extension ne répond pas. Rechargez-la puis réessayez.")), 20_000);
    try {
      runtime.sendMessage(STATISTICS_EXTENSION_ID, request, (reply) => {
        clearTimeout(timeout);
        if (runtime.lastError || !reply) reject(new Error("Extension Statistiques introuvable. Installez-la puis rechargez cette page."));
        else if (!reply.ok) reject(new Error(reply.error ?? "L’extension a refusé la demande."));
        else resolve(reply);
      });
    } catch { clearTimeout(timeout); reject(new Error("Connexion à l’extension impossible.")); }
  });
}
