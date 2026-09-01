import type { Killer } from "../domain/killer.js";
import type { Perk } from "../domain/perk.js";

const perkModules = import.meta.glob(
  "../../DBDImages-main/DBDImages-main/images/perks/killer/*.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;

const portraitModules = import.meta.glob(
  "../../DBDImages-main/DBDImages-main/images/characters/killer/*.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;

const killerPropertyModules = import.meta.glob(
  "../../DBDImages-main/DBDImages-main/images/killer_properties/*.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;

const perkImages = byFileName(perkModules);
const portraitImages = byFileName(portraitModules);
const killerPropertyImages = byFileName(killerPropertyModules);

export function perkIconUrl(perk: Perk): string | null {
  return resolveAsset(perk.icon, perkImages);
}

export function killerPortraitUrl(killer: Killer): string | null {
  return resolveAsset(killer.portrait, portraitImages);
}

export function killerPropertyIconUrl(fileName: string): string | null {
  return killerPropertyImages.get(fileName) ?? null;
}

function byFileName(modules: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(modules).map(([path, url]) => [fileName(path), url]));
}

function resolveAsset(path: string | null, assets: Map<string, string>): string | null {
  if (!path) return null;
  return assets.get(fileName(path)) ?? null;
}

function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").at(-1) ?? path;
}
