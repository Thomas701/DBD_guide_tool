export type AppStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type WorkspaceData = Record<string, string>;

export const WORKSPACE_KEYS = [
  "dbd-build-tool.builds",
  "dbd-build-tool.current-session",
  "dbd-build-tool.perk-description-overrides",
  "dbd-build-tool.perk-category-overrides",
  "dbd-build-tool.tier-overrides",
  "dbd-build-tool.assistant-conversations",
  "dbd-build-tool.assistant-build-keys",
  "dbd-build-tool.assistant-session",
  "dbd-build-tool.assistant-provider",
] as const;

export function readWorkspaceData(value: unknown): WorkspaceData {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Sauvegarde du compte invalide.");
  const entries = Object.entries(value);
  if (!entries.every(([key, item]) => WORKSPACE_KEYS.includes(key as typeof WORKSPACE_KEYS[number]) && typeof item === "string")) {
    throw new Error("La sauvegarde contient des données non reconnues ; elle est conservée sans modification.");
  }
  return Object.fromEntries(entries) as WorkspaceData;
}

export function createAccountStorage(backing: AppStorage, userId: string, onChange: () => void) {
  const prefix = `dbd-build-tool.account.${userId}.`;
  const dirtyKey = `${prefix}pending`;
  const revisionKey = `${prefix}revision`;
  function changed(key: string): void {
    if (!WORKSPACE_KEYS.includes(key as typeof WORKSPACE_KEYS[number])) return;
    backing.setItem(dirtyKey, "true");
    onChange();
  }
  const storage: AppStorage = {
    getItem: (key) => backing.getItem(`${prefix}${key}`),
    setItem(key, value) {
      if (storage.getItem(key) === value) return;
      backing.setItem(`${prefix}${key}`, value);
      changed(key);
    },
    removeItem(key) {
      if (storage.getItem(key) === null) return;
      backing.removeItem(`${prefix}${key}`);
      changed(key);
    },
  };
  return {
    storage,
    prefix,
    pending: () => backing.getItem(dirtyKey) === "true",
    revision: () => Number(backing.getItem(revisionKey) ?? 0),
    snapshot: (): WorkspaceData => Object.fromEntries(WORKSPACE_KEYS.flatMap((key) => {
      const value = storage.getItem(key);
      return value === null ? [] : [[key, value]];
    })),
    replace(data: WorkspaceData, revision: number) {
      const validated = readWorkspaceData(data);
      for (const key of WORKSPACE_KEYS) {
        if (validated[key] === undefined) backing.removeItem(`${prefix}${key}`);
        else backing.setItem(`${prefix}${key}`, validated[key]!);
      }
      backing.setItem(revisionKey, String(revision));
      backing.removeItem(dirtyKey);
    },
    saved(revision: number, snapshot: WorkspaceData) {
      backing.setItem(revisionKey, String(revision));
      if (JSON.stringify(this.snapshot()) === JSON.stringify(snapshot)) backing.removeItem(dirtyKey);
    },
  };
}

export type AccountStorage = ReturnType<typeof createAccountStorage>;
let currentStorage: AppStorage | null = null;
export function setAccountStorage(storage: AppStorage | null): void { currentStorage = storage; }

export const appStorage: AppStorage = {
  getItem: (key) => (currentStorage ?? window.localStorage).getItem(key),
  setItem: (key, value) => (currentStorage ?? window.localStorage).setItem(key, value),
  removeItem: (key) => (currentStorage ?? window.localStorage).removeItem(key),
};
