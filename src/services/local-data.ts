import type { Killer } from "../domain/killer.js";
import type { Perk } from "../domain/perk.js";
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

export async function createNativeChatCopy(serverUrl: string, question: string, currentBuild: CurrentBuildExport): Promise<{ text: string; characters: number }> {
  const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/local-data/copy-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, currentBuild })
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isCopyResponse(payload)) throw new Error(isError(payload) ? payload.error : "Contexte local indisponible.");
  return payload;
}

async function responseError(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  return isError(payload) ? payload.error : `Erreur HTTP ${response.status}`;
}

function isCopyResponse(value: unknown): value is { text: string; characters: number } {
  return typeof value === "object" && value !== null && "text" in value && typeof value.text === "string" && "characters" in value && typeof value.characters === "number";
}

function isError(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string";
}
