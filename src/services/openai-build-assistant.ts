import type { Killer } from "../domain/killer.js";
import type { Perk } from "../domain/perk.js";
import type { RichDescription, RichInlineNode } from "../domain/rich-description.js";
import type { BuildCalculation, BuildScenario } from "./build-calculator.js";

export interface AssistantHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantBuildContext {
  killer: {
    name: string;
    speed: number;
    terrorRadius: number;
    size: Killer["size"];
    tier: Killer["tier"];
    difficulty: Killer["difficulty"];
  };
  perks: Array<{
    name: string;
    categories: Perk["categories"];
    description: string;
    effects: Perk["effects"];
  }>;
  currentState: {
    activeConditions: BuildScenario["conditions"];
    perkStates: BuildScenario["perkStates"];
  };
  calculatedData: {
    affectedStats: Array<Record<string, unknown>>;
    qualitativeEffects: Array<Record<string, unknown>>;
    unresolvedEffects: Array<Record<string, unknown>>;
  };
}

export function buildAssistantContext({ killer, perks, scenario, calculation }: {
  killer: Killer;
  perks: readonly Perk[];
  scenario: BuildScenario;
  calculation: BuildCalculation;
}): AssistantBuildContext {
  return {
    killer: {
      name: killer.name.fr ?? killer.name.en ?? killer.id,
      speed: killer.speed,
      terrorRadius: killer.terrorRadius,
      size: killer.size,
      tier: killer.tier,
      difficulty: killer.difficulty
    },
    perks: perks.map((perk) => ({
      name: perk.name.fr ?? perk.name.en ?? perk.id,
      categories: perk.categories,
      effects: perk.effects,
      description: richDescriptionToText(perk.description.fr ?? perk.description.en)
    })),
    currentState: {
      activeConditions: scenario.conditions,
      perkStates: scenario.perkStates
    },
    calculatedData: {
      affectedStats: calculation.affectedStats.map((stat) => ({
        key: stat.key,
        label: stat.label,
        base: stat.base,
        final: stat.final,
        delta: stat.delta,
        deltaPercent: stat.deltaPercent,
        unit: stat.unit,
        effects: stat.effects.map((effect) => ({
          perk: effect.perkName,
          operation: effect.operation,
          value: effect.value,
          unit: effect.unit,
          before: effect.before,
          after: effect.after,
          condition: effect.reasons,
          status: effect.status
        }))
      })),
      qualitativeEffects: calculation.qualitativeEffects.map((effect) => ({
        label: effect.statLabel,
        perk: effect.perkName,
        condition: effect.reasons,
        status: effect.status,
        duration: effect.duration
      })),
      unresolvedEffects: calculation.unresolvedEffects.map((effect) => ({
        perk: effect.perkName,
        stat: effect.stat,
        reason: effect.reasons.at(-1)
      }))
    }
  };
}

export async function askConnectedAssistant(endpoint: string, message: string, context: Record<string, unknown>, history: readonly AssistantHistoryItem[]): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, context, history: history.slice(-8) })
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isAnswer(payload)) throw new Error(isError(payload) ? payload.error : "Le service OpenAI n’a pas renvoyé de réponse exploitable.");
  return payload.answer;
}

function isAnswer(value: unknown): value is { answer: string } {
  return typeof value === "object" && value !== null && "answer" in value && typeof value.answer === "string";
}

function isError(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string";
}

export function richDescriptionToText(description: RichDescription | null): string {
  if (!description) return "";
  return description.blocks.map((block) => {
    if (block.type === "list") {
      return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${inlineText(item)}`).join("\n");
    }
    return inlineText(block.children);
  }).filter(Boolean).join("\n\n");
}

function inlineText(nodes: readonly RichInlineNode[]): string {
  return nodes.map((node) => node.type === "text" ? node.value : node.alt).join("").trim();
}
