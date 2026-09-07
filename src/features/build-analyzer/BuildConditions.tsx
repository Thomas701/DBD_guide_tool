import type { CSSProperties } from "react";

import { conditionIconBackgroundUrl, killerConditionIconUrl } from "../../app/assets.js";
import { conditionLabels } from "../../app/labels.js";
import { KNOWN_CONDITIONS } from "../../domain/condition.js";
import type { Perk } from "../../domain/perk.js";
import { collectBuildConditions, perkNeedsRuntimeState, type BuildScenario, type PerkRuntimeState } from "../../services/build-calculator.js";

interface PerkConditionsProps {
  perk: Perk;
  scenario: BuildScenario;
  onConditionChange: (condition: string, active: boolean) => void;
  onPerkStateChange: (perkId: string, state: PerkRuntimeState) => void;
}

export function PerkConditions({ perk, scenario, onConditionChange, onPerkStateChange }: PerkConditionsProps) {
  const conditions = collectBuildConditions([perk]);
  const hasRuntimeState = perkNeedsRuntimeState(perk);

  return (
    <div className="perk-condition-list">
      <ul>
        {conditions.map((condition) => {
          const active = scenario.conditions[condition] === true;
          const icon = killerConditionIconUrl(condition);
          const iconStyle = icon && conditionIconBackgroundUrl
            ? { backgroundImage: `url(${conditionIconBackgroundUrl})` } as CSSProperties
            : undefined;
          return (
            <li key={condition}>
              <label className={`condition-toggle${active ? " active" : ""}`}>
                <span className={`condition-icon${icon ? " has-icon" : " empty"}`} style={iconStyle} aria-hidden="true">
                  {icon && <img src={icon} alt="" />}
                </span>
                <span>{conditionLabel(condition)}</span>
                <input type="checkbox" checked={active} onChange={(event) => onConditionChange(condition, event.target.checked)} />
                <span className="toggle-track" aria-hidden="true"><span /></span>
              </label>
            </li>
          );
        })}

        {hasRuntimeState && (
          <li>
            <label className={`condition-toggle runtime-toggle${(scenario.perkStates[perk.id] ?? "inactive") === "active" ? " active" : ""}`}>
              <span className="condition-icon empty" aria-hidden="true" />
              <span><strong>{perk.name.fr ?? perk.name.en ?? perk.id}</strong><small>État de déclenchement</small></span>
              <input type="checkbox" checked={(scenario.perkStates[perk.id] ?? "inactive") === "active"} onChange={(event) => onPerkStateChange(perk.id, event.target.checked ? "active" : "inactive")} />
              <span className="toggle-track" aria-hidden="true"><span /></span>
            </label>
          </li>
        )}
      </ul>
    </div>
  );
}

export function conditionLabel(condition: string): string {
  return KNOWN_CONDITIONS.includes(condition as (typeof KNOWN_CONDITIONS)[number])
    ? conditionLabels[condition as (typeof KNOWN_CONDITIONS)[number]]
    : condition.replaceAll("_", " ");
}

