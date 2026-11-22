import type { BuildScenario, PerkRuntimeState, ScenarioConditionValue } from "./build-calculator.js";
import type { PerkSide } from "../domain/perk.js";

export const APP_SESSION_STORAGE_KEY = "dbd-build-tool.current-session";

export type AppView = "build" | "killers" | "perks" | "constants" | "tiers" | "blindtest" | "statistics" | "administration" | "leaderboard";

type CatalogScrollPositions = Record<"killers" | "perks" | "constants", number>;

export interface BuildSession {
  selectedKillerId: string | null;
  selectedPerkId: string | null;
  equippedPerkIds: string[];
  activeBuildId: string | null;
  buildName: string;
  conversationKey: string;
  scenario: BuildScenario;
}

export interface AppSession extends BuildSession {
  activeView: AppView;
  side: PerkSide;
  soundEnabled: boolean;
  musicVolume: number;
  buildSessions: Record<PerkSide, BuildSession>;
  paneLayout: { left: number; right: number; center: number };
  sidebarLayout: { killer: number; perks: number; rightTop: number };
  catalogScrollPositions: CatalogScrollPositions;
}

export const DEFAULT_APP_SESSION: AppSession = {
  activeView: "build",
  side: "killer",
  soundEnabled: true,
  musicVolume: 0.35,
  selectedKillerId: null,
  selectedPerkId: null,
  equippedPerkIds: [],
  activeBuildId: null,
  buildName: "",
  conversationKey: "empty-build",
  scenario: { conditions: { not_in_chase: true }, perkStates: {} },
  buildSessions: { killer: emptyBuildSession(), survivor: emptyBuildSession() },
  paneLayout: { left: 19, right: 25, center: 52 },
  sidebarLayout: { killer: 198, perks: 286, rightTop: 276 },
  catalogScrollPositions: { killers: 0, perks: 0, constants: 0 }
};

export function readAppSession(raw: string | null, knownKillerIds: ReadonlySet<string>, knownPerkIds: ReadonlySet<string>): AppSession {
  if (!raw) return cloneDefault();
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return cloneDefault();
    const side = value.side === "survivor" ? "survivor" : "killer";
    const current = readBuildSession(value, knownKillerIds, knownPerkIds);
    const stored = isRecord(value.buildSessions) ? value.buildSessions : {};
    const buildSessions = {
      killer: readBuildSession(stored.killer, knownKillerIds, knownPerkIds),
      survivor: readBuildSession(stored.survivor, knownKillerIds, knownPerkIds),
      [side]: current
    };
    return {
      ...current,
      activeView: value.activeView === "killers" || value.activeView === "perks" || value.activeView === "constants" || value.activeView === "tiers" || value.activeView === "blindtest" || value.activeView === "statistics" || value.activeView === "administration" || value.activeView === "leaderboard" ? value.activeView : "build",
      side,
      soundEnabled: typeof value.soundEnabled === "boolean" ? value.soundEnabled : DEFAULT_APP_SESSION.soundEnabled,
      musicVolume: clamp(value.musicVolume, DEFAULT_APP_SESSION.musicVolume, 0, 1),
      buildSessions,
      paneLayout: readNumberLayout(value.paneLayout, DEFAULT_APP_SESSION.paneLayout),
      sidebarLayout: readNumberLayout(value.sidebarLayout, DEFAULT_APP_SESSION.sidebarLayout),
      catalogScrollPositions: readNumberLayout(value.catalogScrollPositions, DEFAULT_APP_SESSION.catalogScrollPositions)
    };
  } catch {
    return cloneDefault();
  }
}

function readBuildSession(value: unknown, knownKillerIds: ReadonlySet<string>, knownPerkIds: ReadonlySet<string>): BuildSession {
  if (!isRecord(value)) return emptyBuildSession();
  return {
    selectedKillerId: knownId(value.selectedKillerId, knownKillerIds),
    selectedPerkId: knownId(value.selectedPerkId, knownPerkIds),
    equippedPerkIds: Array.isArray(value.equippedPerkIds)
      ? [...new Set(value.equippedPerkIds.filter((id): id is string => typeof id === "string" && knownPerkIds.has(id)))].slice(0, 4) : [],
    activeBuildId: nullableString(value.activeBuildId),
    buildName: typeof value.buildName === "string" ? value.buildName.slice(0, 80) : "",
    conversationKey: typeof value.conversationKey === "string" && value.conversationKey ? value.conversationKey : "empty-build",
    scenario: readScenario(value.scenario)
  };
}

function emptyBuildSession(): BuildSession {
  return { selectedKillerId: null, selectedPerkId: null, equippedPerkIds: [], activeBuildId: null, buildName: "", conversationKey: "empty-build", scenario: { conditions: { not_in_chase: true }, perkStates: {} } };
}

function readScenario(value: unknown): BuildScenario {
  if (!isRecord(value)) return { conditions: { not_in_chase: true }, perkStates: {} };
  const conditions = isRecord(value.conditions)
    ? Object.fromEntries(Object.entries(value.conditions).filter((entry): entry is [string, ScenarioConditionValue] => isConditionValue(entry[1])))
    : {};
  const perkStates = isRecord(value.perkStates)
    ? Object.fromEntries(Object.entries(value.perkStates).flatMap(([id, state]): [string, PerkRuntimeState][] => state === "active" ? [[id, "active"]] : state === "inactive" || state === "cooldown" ? [[id, "inactive"]] : []))
    : {};
  return { conditions, perkStates };
}

function isConditionValue(value: unknown): value is ScenarioConditionValue {
  return typeof value === "boolean" || (isRecord(value) && Object.values(value).every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean"));
}

function readNumberLayout<T extends Record<string, number>>(value: unknown, defaults: T): T {
  if (!isRecord(value)) return { ...defaults };
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, finiteNumber(value[key], fallback)])) as T;
}

function knownId(value: unknown, knownIds: ReadonlySet<string>): string | null {
  return typeof value === "string" && knownIds.has(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, finiteNumber(value, fallback)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneDefault(): AppSession {
  return {
    ...DEFAULT_APP_SESSION,
    buildSessions: { killer: emptyBuildSession(), survivor: emptyBuildSession() },
    equippedPerkIds: [],
    scenario: { conditions: { ...DEFAULT_APP_SESSION.scenario.conditions }, perkStates: {} },
    paneLayout: { ...DEFAULT_APP_SESSION.paneLayout },
    sidebarLayout: { ...DEFAULT_APP_SESSION.sidebarLayout },
    catalogScrollPositions: { ...DEFAULT_APP_SESSION.catalogScrollPositions }
  };
}
