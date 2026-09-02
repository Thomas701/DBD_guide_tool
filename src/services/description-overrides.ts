import { PERK_CATEGORY_SET, type PerkCategory } from "../domain/category.js";

export const DESCRIPTION_OVERRIDES_STORAGE_KEY = "dbd-build-tool.perk-description-overrides";
export const CATEGORY_OVERRIDES_STORAGE_KEY = "dbd-build-tool.perk-category-overrides";

type DescriptionOverrideStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class LocalDescriptionOverrideRepository {
  constructor(
    private readonly storage: DescriptionOverrideStorage,
    private readonly storageKey = DESCRIPTION_OVERRIDES_STORAGE_KEY,
  ) {}

  list(): Record<string, string> {
    return this.read();
  }

  update(perkId: string, html: string): Record<string, string> {
    const next = this.read();
    const key = perkId.trim();
    const value = html.trim();

    if (!key || !value) return next;
    next[key] = value;
    this.write(next);
    return { ...next };
  }

  delete(perkId: string): Record<string, string> {
    const next = this.read();
    delete next[perkId];
    this.write(next);
    return { ...next };
  }

  private read(): Record<string, string> {
    const raw = this.storage.getItem(this.storageKey);
    if (raw === null) return {};

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }

    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, entry]) => key.trim().length > 0 && typeof entry === "string" && entry.trim().length > 0)
        .map(([key, entry]) => [key, entry.trim()])
    );
  }

  private write(overrides: Readonly<Record<string, string>>): void {
    if (Object.keys(overrides).length === 0) {
      this.storage.removeItem(this.storageKey);
      return;
    }

    this.storage.setItem(this.storageKey, JSON.stringify(overrides));
  }
}

export class LocalCategoryOverrideRepository {
  constructor(
    private readonly storage: DescriptionOverrideStorage,
    private readonly storageKey = CATEGORY_OVERRIDES_STORAGE_KEY,
  ) {}

  list(): Record<string, PerkCategory[]> {
    return this.read();
  }

  update(perkId: string, categories: readonly PerkCategory[]): Record<string, PerkCategory[]> {
    const next = this.read();
    const key = perkId.trim();
    if (!key) return next;
    next[key] = [...new Set(categories)].filter((category) => PERK_CATEGORY_SET.has(category));
    this.write(next);
    return { ...next };
  }

  delete(perkId: string): Record<string, PerkCategory[]> {
    const next = this.read();
    delete next[perkId];
    this.write(next);
    return { ...next };
  }

  private read(): Record<string, PerkCategory[]> {
    const raw = this.storage.getItem(this.storageKey);
    if (raw === null) return {};
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
      return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) =>
        key.trim() && Array.isArray(entry)
          ? [[key, [...new Set(entry.filter((category): category is PerkCategory => typeof category === "string" && PERK_CATEGORY_SET.has(category)))]]]
          : []
      ));
    } catch {
      return {};
    }
  }

  private write(overrides: Readonly<Record<string, readonly PerkCategory[]>>): void {
    if (Object.keys(overrides).length === 0) this.storage.removeItem(this.storageKey);
    else this.storage.setItem(this.storageKey, JSON.stringify(overrides));
  }
}
