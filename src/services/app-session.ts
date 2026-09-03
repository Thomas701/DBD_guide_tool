import type { BuildScenario, PerkRuntimeState, ScenarioConditionValue } from "./build-calculator.js";

export const APP_SESSION_STORAGE_KEY = "dbd-build-tool.current-session";

export type AppView = "build" | "killers" | "perks";

export interface AppSession {
  activeView: AppView;
  selectedKillerId: string | null;
  selectedPerkId: string | null;
  equippedPerkIds: string[];
  activeBuildId: string | null;
  buildName: string;
  conversationKey: string;
  scenario: BuildScenario;
  paneLayout: { left: number; right: number; center: number };
  sidebarLayout: { killer: number; perks: number; rightTop: number };
}

export const DEFAULT_APP_SESSION: AppSession = {
  activeView: "build",
  selectedKillerId: null,
  selectedPerkId: null,
  equippedPerkIds: [],
  activeBuildId: null,
  buildName: "",
  conversationKey: "empty-build",
  scenario: { conditions: { not_in_chase: true }, perkStates: {} },
  paneLayout: { left: 19, right: 25, center: 52 },
  sidebarLayout: { killer: 198, perks: 286, rightTop: 276 }
};

export function readAppSession(raw: string | null, knownKillerIds: ReadonlySet<string>, knownPerkIds: ReadonlySet<string>): AppSession {
  if (!raw) return cloneDefault();
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return cloneDefault();
    const killerId = knownId(value.selectedKillerId, knownKillerIds);
    const equippedPerkIds = Array.isArray(value.equippedPerkIds)
      ? [...new Set(value.equippedPerkIds.filter((id): id is string => typeof id === "string" && knownPerkIds.has(id)))].slice(0, 4)
      : [];
    return {
      activeView: value.activeView === "killers" || value.activeView === "perks" ? value.activeView : "build",
      selectedKillerId: killerId,
      selectedPerkId: knownId(value.selectedPerkId, knownPerkIds),
      equippedPerkIds,
      activeBuildId: nullableString(value.activeBuildId),
      buildName: typeof value.buildName === "string" ? value.buildName.slice(0, 80) : "",
      conversationKey: typeof value.conversationKey === "string" && value.conversationKey ? value.conversationKey : "empty-build",
      scenario: readScenario(value.scenario),
      paneLayout: readNumberLayout(value.paneLayout, DEFAULT_APP_SESSION.paneLayout),
      sidebarLayout: readNumberLayout(value.sidebarLayout, DEFAULT_APP_SESSION.sidebarLayout)
    };
  } catch {
    return cloneDefault();
  }
}

function readScenario(value: unknown): BuildScenario {
  if (!isRecord(value)) return { conditions: { not_in_chase: true }, perkStates: {} };
  const conditions = isRecord(value.conditions)
    ? Object.fromEntries(Object.entries(value.conditions).filter((entry): entry is [string, ScenarioConditionValue] => isConditionValue(entry[1])))
    : {};
  const perkStates = isRecord(value.perkStates)
    ? Object.fromEntries(Object.entries(value.perkStates).filter((entry): entry is [string, PerkRuntimeState] => entry[1] === "active" || entry[1] === "inactive" || entry[1] === "cooldown"))
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneDefault(): AppSession {
  return {
    ...DEFAULT_APP_SESSION,
    equippedPerkIds: [],
    scenario: { conditions: { ...DEFAULT_APP_SESSION.scenario.conditions }, perkStates: {} },
    paneLayout: { ...DEFAULT_APP_SESSION.paneLayout },
    sidebarLayout: { ...DEFAULT_APP_SESSION.sidebarLayout }
  };
}
