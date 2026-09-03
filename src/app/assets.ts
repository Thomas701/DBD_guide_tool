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

const killerConditionModules = import.meta.glob(
  "../../DBDImages-main/DBDImages-main/images/killer_conditions/*.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;

const conditionBackgroundModules = import.meta.glob(
  "../../DBDImages-main/DBDImages-main/images/backgrounds/basic/veryrare.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;

const perkImages = byFileName(perkModules);
const portraitImages = byFileName(portraitModules);
const killerPropertyImages = byFileName(killerPropertyModules);
const killerConditionImages = byFileName(killerConditionModules);
export const conditionIconBackgroundUrl = Object.values(conditionBackgroundModules)[0] ?? null;

const conditionImageNames: Record<string, string> = {
  not_in_chase: "stop_chase.png",
  carrying_survivor: "survivant_transport.png",
  near_completed_generator: "generator_70_progression.png",
  generator_damaged: "break_generator.png",
  survivor_injured: "survivant_injured.png",
  inside_terror_radius: "be_in_terror_rayon.png",
  after_blind: "be_blind.png",
  after_break_action: "break_generator.png",
  survivor_unhooked: "survivant_unhook.png",
  survivor_lost_health_state: "survivant_injured.png",
  generator_at_90_percent: "generator_70_progression.png",
  four_survivors_injured: "survivant_injured.png"
};

export function perkIconUrl(perk: Perk): string | null {
  return resolveAsset(perk.icon, perkImages);
}

export function killerPortraitUrl(killer: Killer): string | null {
  return resolveAsset(killer.portrait, portraitImages);
}

export function killerPropertyIconUrl(fileName: string): string | null {
  return killerPropertyImages.get(fileName) ?? null;
}

export function killerConditionIconUrl(condition: string): string | null {
  const fileName = conditionImageNames[condition];
  return fileName ? killerConditionImages.get(fileName) ?? null : null;
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
