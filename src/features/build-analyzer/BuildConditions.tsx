import { useMemo } from "react";

import { killerConditionIconUrl } from "../../app/assets.js";
import { conditionLabels } from "../../app/labels.js";
import { KNOWN_CONDITIONS } from "../../domain/condition.js";
import type { Perk } from "../../domain/perk.js";
import {
  collectBuildConditions,
  perkNeedsRuntimeState,
  type BuildScenario,
  type PerkRuntimeState
} from "../../services/build-calculator.js";

interface BuildConditionsProps {
  perks: readonly Perk[];
  scenario: BuildScenario;
  onConditionChange: (condition: string, active: boolean) => void;
  onPerkStateChange: (perkId: string, state: PerkRuntimeState) => void;
  onReset: () => void;
}

export function BuildConditions({
  perks,
  scenario,
  onConditionChange,
  onPerkStateChange,
  onReset
}: BuildConditionsProps) {
  const conditions = useMemo(() => collectBuildConditions(perks), [perks]);
  const runtimePerks = perks.filter(perkNeedsRuntimeState);
  const hasOptions = conditions.length > 0 || runtimePerks.length > 0;

  return (
    <section className="analyzer-panel conditions-panel" aria-labelledby="active-conditions-title">
      <div className="compact-section-heading">
        <div>
          <span className="section-icon" aria-hidden="true">⌁</span>
          <h2 id="active-conditions-title">Active Conditions</h2>
        </div>
        {hasOptions && <button className="text-button" type="button" onClick={onReset}>Reset</button>}
      </div>

      {!hasOptions ? (
        <p className="panel-empty">Aucune condition pour les perks équipées.</p>
      ) : (
        <div className="condition-toggle-list">
          {conditions.map((condition) => {
            const active = scenario.conditions[condition] === true;
            const icon = killerConditionIconUrl(condition);
            return (
              <label className={`condition-toggle${active ? " active" : ""}`} key={condition}>
                <span className={`condition-icon${icon ? "" : " empty"}`} aria-hidden="true">
                  {icon && <img src={icon} alt="" />}
                </span>
                <span>{conditionLabel(condition)}</span>
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(event) => onConditionChange(condition, event.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true"><span /></span>
              </label>
            );
          })}

          {runtimePerks.map((perk) => (
            hasCooldown(perk) ? (
              <label className="runtime-condition" key={perk.id}>
                <span className="condition-icon empty" aria-hidden="true" />
                <span>
                  <strong>{perk.name.fr ?? perk.name.en ?? perk.id}</strong>
                  <small>État de déclenchement</small>
                </span>
                <select
                  value={scenario.perkStates[perk.id] ?? "inactive"}
                  onChange={(event) => onPerkStateChange(perk.id, event.target.value as PerkRuntimeState)}
                >
                  <option value="inactive">Inactif</option>
                  <option value="active">Actif</option>
                  <option value="cooldown">Cooldown</option>
                </select>
              </label>
            ) : (
              <label className={`condition-toggle runtime-toggle${(scenario.perkStates[perk.id] ?? "active") === "active" ? " active" : ""}`} key={perk.id}>
                <span className="condition-icon empty" aria-hidden="true" />
                <span>
                  <strong>{perk.name.fr ?? perk.name.en ?? perk.id}</strong>
                  <small>État de déclenchement</small>
                </span>
                <input
                  type="checkbox"
                  checked={(scenario.perkStates[perk.id] ?? "active") === "active"}
                  onChange={(event) => onPerkStateChange(perk.id, event.target.checked ? "active" : "inactive")}
                />
                <span className="toggle-track" aria-hidden="true"><span /></span>
              </label>
            )
          ))}
        </div>
      )}
    </section>
  );
}

export function conditionLabel(condition: string): string {
  return KNOWN_CONDITIONS.includes(condition as (typeof KNOWN_CONDITIONS)[number])
    ? conditionLabels[condition as (typeof KNOWN_CONDITIONS)[number]]
    : condition.replaceAll("_", " ");
}

function hasCooldown(perk: Perk): boolean {
  return perk.cooldown !== null || perk.effects.some((effect) => effect.cooldown != null);
}
