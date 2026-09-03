import { useMemo } from "react";

import type { Perk } from "../../domain/perk.js";
import {
  collectBuildConditions,
  type BuildCalculation,
  type BuildScenario,
  type CalculatedStat,
  type EffectCalculation
} from "../../services/build-calculator.js";
import { conditionLabel } from "../build-analyzer/BuildConditions.js";

interface BuildSummaryProps {
  calculation: BuildCalculation;
  perks: readonly Perk[];
  scenario: BuildScenario;
}

export function BuildSummary({ calculation, perks, scenario }: BuildSummaryProps) {
  const conditions = useMemo(() => collectBuildConditions(perks), [perks]);
  const strengths = calculation.affectedStats.filter((stat) => (stat.benefit ?? 0) > 0).slice(0, 3);
  const penalties = calculation.affectedStats.filter((stat) => (stat.benefit ?? 0) < 0).slice(0, 2);
  const inactiveConditional = calculation.inactiveEffects.filter(isConditionalEffect);
  const interactions = buildInteractions(calculation);
  const categoryCounts = countCategories(calculation);

  return (
    <div className="build-summary-content" aria-labelledby="build-summary-title">
      <div className="compact-section-heading">
        <div>
          <span className="section-icon" aria-hidden="true">▤</span>
          <h2 id="build-summary-title">Build Summary</h2>
        </div>
      </div>

      <div className="summary-columns">
        <SummaryList title="Strengths" tone="positive" items={
          strengths.length > 0
            ? strengths.map((stat) => summaryStat(stat, true))
            : ["Aucun gain numérique actif dans ce scénario."]
        } />
        <SummaryList title="Weaknesses" tone="negative" items={[
          ...penalties.map((stat) => summaryStat(stat, false)),
          ...(inactiveConditional.length > 0 ? [`${uniquePerks(inactiveConditional)} perk(s) attendent une condition.`] : []),
          ...(calculation.unresolvedEffects.length > 0 ? [`${calculation.unresolvedEffects.length} effet(s) restent partiels.`] : [])
        ].slice(0, 3).concat(
          penalties.length === 0 && inactiveConditional.length === 0 && calculation.unresolvedEffects.length === 0
            ? ["Aucune pénalité calculée dans ce scénario."] : []
        )} />
      </div>

      <div className="summary-block">
        <h3>Perk Interactions</h3>
        {interactions.length > 0 ? (
          <ul>{interactions.map((interaction) => <li key={interaction}>{interaction}</li>)}</ul>
        ) : (
          <p>Aucun cumul entre plusieurs perks sur une même statistique.</p>
        )}
      </div>

      <div className="summary-block">
        <h3>Condition Coverage</h3>
        {conditions.length > 0 ? (
          <div className="condition-coverage-list">
            {conditions.map((condition) => {
              const active = scenario.conditions[condition] === true;
              return <span className={active ? "active" : "inactive"} key={condition}><i />{conditionLabel(condition)}</span>;
            })}
          </div>
        ) : <p>Ce build ne dépend d’aucune condition structurée.</p>}
      </div>

      <div className="summary-block affected-categories">
        <h3>Affected Stat Categories</h3>
        {categoryCounts.length > 0 ? (
          <div className="category-badges">
            {categoryCounts.map(([category, count]) => <span key={category}>{category}<b>{count}</b></span>)}
          </div>
        ) : <p>Aucune catégorie affectée.</p>}
      </div>
    </div>
  );
}

function SummaryList({ title, tone, items }: { title: string; tone: "positive" | "negative"; items: string[] }) {
  return (
    <div className={`summary-list ${tone}`}>
      <h3>{title}</h3>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  );
}

function summaryStat(stat: CalculatedStat, positive: boolean): string {
  const amount = new Intl.NumberFormat("fr", { maximumFractionDigits: 3 }).format(Math.abs(stat.benefit ?? stat.delta));
  return `${stat.label} : ${amount} ${stat.unit} ${positive ? "gagné" : "perdu"}.`;
}

function isConditionalEffect(effect: EffectCalculation): boolean {
  return effect.reasons.some((reason) => reason.startsWith("Condition"));
}

function uniquePerks(effects: readonly EffectCalculation[]): number {
  return new Set(effects.map((effect) => effect.perkId)).size;
}

function buildInteractions(calculation: BuildCalculation): string[] {
  const byStat = new Map<string, EffectCalculation[]>();
  calculation.activeEffects.forEach((effect) => {
    const key = effect.statKey ?? effect.stat;
    byStat.set(key, [...(byStat.get(key) ?? []), effect]);
  });
  return [...byStat.values()].flatMap((effects) => {
    const names = [...new Set(effects.map((effect) => effect.perkName))];
    if (names.length < 2) return [];
    return [`${names.join(" + ")} modifient ${effects[0]?.statLabel ?? "la même statistique"}.`];
  }).slice(0, 3);
}

function countCategories(calculation: BuildCalculation): Array<[string, number]> {
  const counts = new Map<string, number>();
  calculation.affectedStats.forEach((stat) => counts.set(stat.theme, (counts.get(stat.theme) ?? 0) + 1));
  calculation.qualitativeEffects.forEach((effect) => counts.set(effect.theme, (counts.get(effect.theme) ?? 0) + 1));
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}
