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
      if (result.error && /timeout|timed out/i.test(result.error.message)) throw new Error("Sauvegarde impossible : le serveur a mis trop de temps à répondre. Vos changements restent sur cet appareil ; une nouvelle tentative sera effectuée automatiquement.");
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
      if (saved.revision !== this.local.revision()) {
        if (saved.revision !== this.local.revision() + 1 || !sameData(saved.data, this.local.snapshot())) throw new WorkspaceConflictError();
        this.local.saved(saved.revision, saved.data);
      }
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
      const expected = this.local.revision();
      let revision: number;
      try { revision = await this.remote.save(snapshot, expected); }
      catch (cause) {
        // A timeout can hide a committed save; acknowledge only this exact snapshot and revision.
        const saved = await this.remote.read().catch(() => null);
        if (!saved || saved.revision !== expected + 1 || !sameData(saved.data, snapshot)) throw cause;
        revision = saved.revision;
      }
      this.local.saved(revision, snapshot);
    }
  }
}

function sameData(left: WorkspaceData, right: WorkspaceData): boolean {
  return Object.keys(left).length === Object.keys(right).length && Object.entries(right).every(([key, value]) => left[key] === value);
}
