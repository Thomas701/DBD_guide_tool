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

const logoModules = import.meta.glob(
  "../../DBDImages-main/DBDImages-main/images/logo/*.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;

const killerThemeModules = import.meta.glob(
  "../../DBDImages-main/DBDImages-main/images/killer_theme/*.ogg",
  { query: "?url", import: "default" }
) as Record<string, () => Promise<string>>;

const terrorRadiusModules = import.meta.glob(
  "../../DBDImages-main/DBDImages-main/images/killer_terror_radius/*.ogg",
  { query: "?url", import: "default" }
) as Record<string, () => Promise<string>>;

const perkImages = byFileName(perkModules);
const portraitImages = byFileName(portraitModules);
const killerPropertyImages = byFileName(killerPropertyModules);
const killerConditionImages = byFileName(killerConditionModules);
const logoImages = byFileName(logoModules);
const killerThemes = byFileName(killerThemeModules);
const terrorRadiusTracks = byFileName(terrorRadiusModules);
export const conditionIconBackgroundUrl = Object.values(conditionBackgroundModules)[0] ?? null;
export const appLogoUrl = logoImages.get("logo_dbd_build_analyser.png") ?? Object.values(logoModules)[0] ?? null;
export const entityPortraitUrl = portraitImages.get("entity.png") ?? null;

const conditionImageNames: Record<string, string> = {
  not_in_chase: "stop_chase.png",
  chase_abandoned: "stop_chase.png",
  carrying_survivor: "survivant_transport.png",
  near_completed_generator: "generator_70_progression.png",
  generator_at_70_percent: "generator_70_progression.png",
  generator_damaged: "break_generator.png",
  survivor_injured: "survivant_injured.png",
  blood_pool_present: "blood_marker.png",
  inside_terror_radius: "be_in_terror_rayon.png",
  after_blind: "be_blind.png",
  blind_attempted: "be_blind.png",
  after_break_action: "break_generator.png",
  pallet_stunned: "palette_stun.png",
  pallet_break: "palette_destruction.png",
  wall_break: "porte_destruction.png",
  survivor_unhooked: "survivant_unhook.png",
  survivor_lost_health_state: "survivant_injured.png",
  generator_at_90_percent: "generator_70_progression.png",
  skill_check_failed: "test_habilité.png",
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

export function killerThemeUrl(killerId: string): Promise<string | null> {
  return matchingAudio(killerThemes, themeAudioId(killerId), "Theme_Music.ogg");
}

export function killerTerrorRadiusUrl(killerId: string): Promise<string | null> {
  return matchingAudio(terrorRadiusTracks, terrorAudioId(killerId), ".ogg");
}

export async function originalKillerThemeUrl(): Promise<string | null> {
  return killerThemes.get("Original_Killer_Theme.ogg")?.() ?? null;
}

async function matchingAudio(tracks: Map<string, () => Promise<string>>, killerId: string, suffix: string): Promise<string | null> {
  const id = normalizeAssetName(killerId);
  const loader = [...tracks].find(([name]) => normalizeAssetName(name).includes(id) && name.endsWith(suffix))?.[1];
  return loader ? loader() : null;
}

function terrorAudioId(killerId: string): string {
  return ({ myers: "shape", "good-guy": "chucky", darklord: "dark_lord", ghostface: "ghost_face", onryo: "onryo", xenomorph: "xenomorph" } as Record<string, string>)[killerId] ?? killerId;
}

function themeAudioId(killerId: string): string {
  return ({ "good-guy": "chucky", slasher: "jason", onryo: "oryo", hag: "harpie" } as Record<string, string>)[killerId] ?? killerId;
}

function normalizeAssetName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function byFileName<T>(modules: Record<string, T>): Map<string, T> {
  return new Map(Object.entries(modules).map(([path, url]) => [fileName(path), url]));
}

function resolveAsset(path: string | null, assets: Map<string, string>): string | null {
  if (!path) return null;
  return assets.get(fileName(path)) ?? null;
}

function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").at(-1) ?? path;
}
