import type { Killer } from "../domain/killer.js";
import type { Perk } from "../domain/perk.js";
import type { PerkCategory } from "../domain/category.js";
import type { BuildCalculation, BuildScenario } from "./build-calculator.js";
import { buildAssistantContext, type AssistantBuildContext } from "./openai-build-assistant.js";
import { normalizeServerUrl } from "./assistant-provider.js";

export interface CurrentBuildExport {
  schemaVersion: 1;
  updatedAt: string;
  build: { id: string | null; name: string; killerId: string | null; perkIds: string[] };
  scenario: BuildScenario;
  assistantContext: AssistantBuildContext | null;
}

export function createCurrentBuildExport(input: {
  activeBuildId: string | null;
  buildName: string;
  killer: Killer | null;
  perks: readonly Perk[];
  scenario: BuildScenario;
  calculation: BuildCalculation | null;
}): CurrentBuildExport {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    build: {
      id: input.activeBuildId,
      name: input.buildName,
      killerId: input.killer?.id ?? null,
      perkIds: input.perks.map((perk) => perk.id)
    },
    scenario: input.scenario,
    assistantContext: input.killer && input.calculation
      ? buildAssistantContext({ killer: input.killer, perks: input.perks, scenario: input.scenario, calculation: input.calculation })
      : null
  };
}

export async function syncCurrentBuildFile(serverUrl: string, currentBuild: CurrentBuildExport): Promise<void> {
  const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/local-data/current-build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(currentBuild)
  });
  if (!response.ok) throw new Error(await responseError(response));
}

export async function updateNativePerk(
  serverUrl: string,
  perkId: string,
  changes: { descriptionHtml?: string; categories?: readonly PerkCategory[] }
): Promise<Perk> {
  const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/local-data/perk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ perkId, changes })
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isPerkResponse(payload)) throw new Error(isError(payload) ? payload.error : "Modification native indisponible.");
  return payload.perk;
}

async function responseError(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  return isError(payload) ? payload.error : `Erreur HTTP ${response.status}`;
}

function isPerkResponse(value: unknown): value is { perk: Perk } {
  return typeof value === "object" && value !== null && "perk" in value
    && typeof value.perk === "object" && value.perk !== null && "id" in value.perk && typeof value.perk.id === "string";
}

function isError(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string";
}
