import type { SupabaseClient } from "@supabase/supabase-js";
import { readWorkspaceData, type AccountStorage, type WorkspaceData } from "./account-storage.js";

export class WorkspaceConflictError extends Error {
  constructor() { super("Ce compte a été modifié sur un autre appareil. Exportez les changements locaux avant de recharger la sauvegarde en ligne."); }
}

export interface WorkspaceRemote {
  read(): Promise<{ data: WorkspaceData; revision: number }>;
  save(data: WorkspaceData, revision: number): Promise<number>;
}

export function workspaceRemote(client: SupabaseClient, userId: string): WorkspaceRemote {
  return {
    async read() {
      const { data, error } = await client.from("user_workspaces").select("data,revision").eq("user_id", userId).maybeSingle();
      if (error) throw new Error(`Lecture du compte impossible : ${error.message}`);
      return data ? { data: readWorkspaceData(data.data), revision: Number(data.revision) } : { data: {}, revision: 0 };
    },
    async save(data, revision) {
      const result = await client.rpc("save_workspace", { workspace_data: data, expected_revision: revision });
      if (result.error?.code === "40001") throw new WorkspaceConflictError();
      if (result.error) throw new Error(`Sauvegarde impossible : ${result.error.message}`);
      if (!Number.isSafeInteger(result.data) || result.data < 1) throw new Error("Version de sauvegarde invalide.");
      return result.data as number;
    },
  };
}

export class CloudWorkspace {
  private flushing: Promise<void> | null = null;
  constructor(readonly local: AccountStorage, private readonly remote: WorkspaceRemote) {}

  async load(discardLocal = false): Promise<void> {
    const saved = await this.remote.read();
    if (!discardLocal && this.local.pending()) {
      if (saved.revision !== this.local.revision()) throw new WorkspaceConflictError();
      return;
    }
    this.local.replace(saved.data, saved.revision);
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.savePending().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async savePending(): Promise<void> {
    while (this.local.pending()) {
      const snapshot = this.local.snapshot();
      const revision = await this.remote.save(snapshot, this.local.revision());
      this.local.saved(revision, snapshot);
    }
  }
}
