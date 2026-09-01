import {
  type Build,
  type BuildDraft,
  validateBuildDraft,
} from "../domain/build.js";

export const BUILDS_STORAGE_KEY = "dbd-build-tool.builds";

type BuildStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface BuildRepositoryOptions {
  storageKey?: string;
  now?: () => Date;
  generateId?: () => string;
}

export class LocalBuildRepository {
  private readonly storageKey: string;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(
    private readonly storage: BuildStorage,
    options: BuildRepositoryOptions = {},
  ) {
    this.storageKey = options.storageKey ?? BUILDS_STORAGE_KEY;
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? defaultBuildId;
  }

  list(): Build[] {
    return this.read();
  }

  create(draft: BuildDraft): Build {
    const builds = this.read();
    const build = this.newBuild(draft, builds);
    this.write([...builds, build]);
    return cloneBuild(build);
  }

  update(id: string, changes: Partial<BuildDraft>): Build {
    const builds = this.read();
    const index = builds.findIndex((build) => build.id === id);
    if (index === -1) throw new Error(`Build introuvable: ${id}`);

    const current = builds[index]!;
    const draft: BuildDraft = {
      name: changes.name ?? current.name,
      killerId: changes.killerId ?? current.killerId,
      perkIds: changes.perkIds ?? current.perkIds,
    };
    assertValidDraft(draft);

    const updated: Build = {
      ...current,
      name: draft.name.trim(),
      killerId: draft.killerId,
      perkIds: [...draft.perkIds],
      updatedAt: this.timestamp(),
    };
    builds[index] = updated;
    this.write(builds);
    return cloneBuild(updated);
  }

  duplicate(id: string, name: string): Build {
    const builds = this.read();
    const source = builds.find((build) => build.id === id);
    if (!source) throw new Error(`Build introuvable: ${id}`);

    const duplicate = this.newBuild(
      { name, killerId: source.killerId, perkIds: source.perkIds },
      builds,
    );
    this.write([...builds, duplicate]);
    return cloneBuild(duplicate);
  }

  delete(id: string): boolean {
    const builds = this.read();
    const remaining = builds.filter((build) => build.id !== id);
    if (remaining.length === builds.length) return false;
    this.write(remaining);
    return true;
  }

  clear(): void {
    this.storage.removeItem(this.storageKey);
  }

  private newBuild(draft: BuildDraft, existing: readonly Build[]): Build {
    assertValidDraft(draft);
    const id = this.generateId();
    if (id.trim().length === 0 || existing.some((build) => build.id === id)) {
      throw new Error(`ID de build invalide ou déjà utilisé: ${id}`);
    }
    const timestamp = this.timestamp();
    return {
      id,
      name: draft.name.trim(),
      killerId: draft.killerId,
      perkIds: [...draft.perkIds],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private timestamp(): string {
    const value = this.now();
    if (Number.isNaN(value.getTime())) throw new Error("Horodatage de build invalide");
    return value.toISOString();
  }

  private read(): Build[] {
    const raw = this.storage.getItem(this.storageKey);
    if (raw === null) return [];

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("Stockage des builds illisible");
    }
    if (!Array.isArray(value)) throw new Error("Stockage des builds invalide");

    const builds = value.map(readStoredBuild);
    if (new Set(builds.map((build) => build.id)).size !== builds.length) {
      throw new Error("Stockage des builds invalide: IDs dupliqués");
    }
    return builds;
  }

  private write(builds: readonly Build[]): void {
    this.storage.setItem(this.storageKey, JSON.stringify(builds));
  }
}

function assertValidDraft(draft: BuildDraft): void {
  const errors = validateBuildDraft(draft);
  if (errors.length > 0) throw new Error(`Build invalide: ${errors.join(", ")}`);
}

function readStoredBuild(value: unknown): Build {
  if (typeof value !== "object" || value === null) {
    throw new Error("Stockage des builds invalide");
  }
  const build = value as Record<string, unknown>;
  if (
    typeof build.id !== "string" || build.id.trim().length === 0 ||
    typeof build.name !== "string" ||
    typeof build.killerId !== "string" ||
    !Array.isArray(build.perkIds) || !build.perkIds.every((id) => typeof id === "string") ||
    typeof build.createdAt !== "string" || !isIsoDate(build.createdAt) ||
    typeof build.updatedAt !== "string" || !isIsoDate(build.updatedAt)
  ) {
    throw new Error("Stockage des builds invalide");
  }

  const result: Build = {
    id: build.id,
    name: build.name,
    killerId: build.killerId,
    perkIds: [...build.perkIds] as string[],
    createdAt: build.createdAt,
    updatedAt: build.updatedAt,
  };
  assertValidDraft(result);
  return result;
}

function isIsoDate(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function cloneBuild(build: Build): Build {
  return { ...build, perkIds: [...build.perkIds] };
}

function defaultBuildId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `build-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
