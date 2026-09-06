import { useState } from "react";

import { perkIconUrl } from "../../app/assets.js";
import { MAX_BUILD_PERKS } from "../../domain/build.js";
import type { Perk } from "../../domain/perk.js";
import { collectBuildConditions, perkNeedsRuntimeState, type BuildScenario, type PerkRuntimeState } from "../../services/build-calculator.js";
import { PerkConditions } from "../build-analyzer/BuildConditions.js";

interface BuildEditorProps {
  perks: readonly Perk[];
  selectedPerkId: string | null;
  compact?: boolean;
  onRemove: (perkId: string) => void;
  onBrowse: (perkId: string | null) => void;
  scenario: BuildScenario;
  onConditionChange: (condition: string, active: boolean) => void;
  onPerkStateChange: (perkId: string, state: PerkRuntimeState) => void;
}

export function BuildEditor({ perks, selectedPerkId, compact = false, onRemove, onBrowse, scenario, onConditionChange, onPerkStateChange }: BuildEditorProps) {
  const [openConditions, setOpenConditions] = useState<Record<string, boolean>>({});
  const slots = Array.from({ length: MAX_BUILD_PERKS }, (_, index) => perks[index] ?? null);

  function toggleConditions(perkId: string): void {
    setOpenConditions((current) => ({ ...current, [perkId]: !current[perkId] }));
  }

  if (compact) {
    return (
      <div className="build-editor compact-build-editor compact-perk-icon-row" aria-label="Perks du build">
        {slots.map((perk, index) => {
          if (!perk) return <button className="compact-perk-icon empty" type="button" key={`empty-${index}`} onClick={() => onBrowse(null)} aria-label={`Ajouter la perk ${index + 1}`}>
            <span className="empty-perk-diamond" aria-hidden="true"><b>{index + 1}</b></span>
          </button>;
          const name = perk.name.fr ?? perk.name.en ?? perk.id;
          const isSelected = selectedPerkId === perk.id;
          return (
            <div className={`compact-perk-icon${isSelected ? " selected" : ""}`} key={perk.id}>
              <button className="compact-perk-icon-main" type="button" onClick={() => onBrowse(perk.id)} aria-pressed={isSelected} aria-label={`Sélectionner ${name}`} title={name}>
              <span className="perk-icon build-icon">
                {perkIconUrl(perk) ? <img src={perkIconUrl(perk) ?? ""} alt="" /> : <span className="image-placeholder" aria-hidden="true">?</span>}
              </span>
              </button>
              {isSelected && <svg className="perk-selection-path" viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,2 98,50 50,98 2,50" /></svg>}
              <button className="compact-perk-icon-remove" type="button" onClick={() => onRemove(perk.id)} aria-label={`Retirer ${name} du build`}>×</button>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="build-editor compact-build-editor">
      <div className="compact-perk-slots" aria-label="Emplacements de perks">
        {slots.map((perk, index) => {
          if (!perk) return (
            <button className="compact-perk-slot empty" type="button" key={`empty-${index}`} onClick={() => onBrowse(null)}>
              <span className="empty-perk-diamond" aria-hidden="true"><b>{index + 1}</b></span>
              <span>Ajouter une perk</span>
            </button>
          );

          const hasConditions = collectBuildConditions([perk]).length > 0 || perkNeedsRuntimeState(perk);
          const name = perk.name.fr ?? perk.name.en ?? perk.id;
          const conditionsOpen = openConditions[perk.id] === true;
          const content = <>
            <span className="perk-icon build-icon">
              {perkIconUrl(perk) ? <img src={perkIconUrl(perk) ?? ""} alt="" /> : <span className="image-placeholder" aria-hidden="true">?</span>}
            </span>
            <span><strong>{name}</strong>{hasConditions && <small>Afficher les conditions</small>}</span>
          </>;

          const isSelected = selectedPerkId === perk.id;

          return (
            <article className={`compact-perk-slot filled${isSelected ? " selected" : ""}`} key={perk.id}>
              <button
                className="perk-slot-main"
                type="button"
                onClick={() => onBrowse(perk.id)}
                aria-label={`${isSelected ? "Désélectionner" : "Sélectionner"} ${name}`}
                aria-pressed={isSelected}
              >
                {content}
              </button>
              {hasConditions && (
                <>
                  <button
                    className="perk-condition-toggle"
                    type="button"
                    aria-label={`Afficher les conditions de ${name}`}
                    aria-expanded={conditionsOpen}
                    onClick={() => toggleConditions(perk.id)}
                  >
                    <span className="perk-slot-chevron" aria-hidden="true" />
                  </button>
                  <div className={`perk-condition-region${conditionsOpen ? " expanded" : ""}`} aria-hidden={!conditionsOpen}>
                    <PerkConditions perk={perk} scenario={scenario} onConditionChange={onConditionChange} onPerkStateChange={onPerkStateChange} />
                  </div>
                </>
              )}
              <button className="perk-slot-remove" type="button" onClick={() => onRemove(perk.id)} aria-label={`Retirer ${name}`}>×</button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
