import { KILLER_TIERS, type KillerTier } from "../domain/killer.js";
import type { Perk } from "../domain/perk.js";
import { PERK_BASE_TIERS, PERK_TIER_REASONS } from "../data/perk-tiers.js";

export const TIER_OVERRIDES_STORAGE_KEY = "dbd-build-tool.tier-overrides";
export type TierPlacement = KillerTier | "unranked";
export const TIER_PLACEMENTS: readonly TierPlacement[] = [...KILLER_TIERS, "unranked"];
export interface TierOverrides { killers: Record<string, TierPlacement>; perks: Record<string, TierPlacement> }
export interface PerkTierEntry { name: string; perk: Perk; tier: TierPlacement; baseTier: KillerTier | null; reason: string; customized: boolean }

export function rankPerks(perks: readonly Perk[], overrides: Readonly<Record<string, TierPlacement>>): PerkTierEntry[] {
  return perks.map((perk) => {
    const baseTier = PERK_BASE_TIERS[perk.id] ?? null;
    return {
      name: perk.name.fr ?? perk.name.en ?? perk.id, perk,
      tier: overrides[perk.id] ?? baseTier ?? "B-", baseTier,
      reason: PERK_TIER_REASONS[perk.id] ?? (baseTier ? "" : "Nouvelle perk à évaluer : rang B- provisoire."),
      customized: Object.hasOwn(overrides, perk.id)
    };
  }).sort((left, right) => TIER_PLACEMENTS.indexOf(left.tier) - TIER_PLACEMENTS.indexOf(right.tier) || left.name.localeCompare(right.name, "fr"));
}

export class LocalTierOverrideRepository {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem">) {}
  list(): TierOverrides {
    const raw = this.storage.getItem(TIER_OVERRIDES_STORAGE_KEY);
    if (raw === null) return { killers: {}, perks: {} };
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Tier list locale invalide.");
    const record = value as Record<string, unknown>;
    return { killers: readTiers(record.killers), perks: readTiers(record.perks) };
  }
  update(kind: keyof TierOverrides, id: string, tier: TierPlacement): TierOverrides {
    if ((tier !== "unranked" && !(KILLER_TIERS as readonly string[]).includes(tier)) || !id.trim() || ["__proto__", "constructor", "prototype"].includes(id)) throw new Error("Tier invalide.");
    const current = this.list();
    const next = { ...current, [kind]: { ...current[kind], [id]: tier } };
    this.storage.setItem(TIER_OVERRIDES_STORAGE_KEY, JSON.stringify(next));
    return next;
  }
}

function readTiers(value: unknown): Record<string, TierPlacement> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Tier list locale invalide.");
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, TierPlacement] => typeof entry[1] === "string" && (entry[1] === "unranked" || (KILLER_TIERS as readonly string[]).includes(entry[1]))));
}
