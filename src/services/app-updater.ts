export interface AppUpdateStatus {
  supported: boolean;
  available: boolean;
  blocked?: boolean;
  gitMissing?: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  currentRevision: string | null;
  latestRevision: string | null;
  message: string;
  updated?: boolean;
  gitInstalled?: boolean;
  restartRequired?: boolean;
}

export async function checkAppUpdate(serverUrl: string): Promise<AppUpdateStatus> {
  return requestUpdate(serverUrl, "/api/app-update/status");
}

export async function installAppUpdate(serverUrl: string): Promise<AppUpdateStatus> {
  return requestUpdate(serverUrl, "/api/app-update", { method: "POST" });
}

async function requestUpdate(serverUrl: string, path: string, init?: RequestInit): Promise<AppUpdateStatus> {
  let response: Response;
  try {
    response = await fetch(`${serverUrl.replace(/\/$/, "")}${path}`, init);
  } catch {
    throw new Error("Le service local de mise à jour est inaccessible. Lancez l’application avec « Lancer Build Analyzer.bat ».");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(isError(payload) ? payload.error : `Erreur HTTP ${response.status}`);
  if (!isUpdateStatus(payload)) throw new Error("Le service de mise à jour a renvoyé une réponse invalide.");
  return payload;
}

function isUpdateStatus(value: unknown): value is AppUpdateStatus {
  return typeof value === "object" && value !== null
    && "supported" in value && typeof value.supported === "boolean"
    && "available" in value && typeof value.available === "boolean"
    && "message" in value && typeof value.message === "string";
}

function isError(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string";
}
