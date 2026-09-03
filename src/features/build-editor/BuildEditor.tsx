import { perkIconUrl } from "../../app/assets.js";
import { MAX_BUILD_PERKS } from "../../domain/build.js";
import type { Perk } from "../../domain/perk.js";
import { collectBuildConditions, perkNeedsRuntimeState, type BuildScenario, type PerkRuntimeState } from "../../services/build-calculator.js";
import { PerkConditions } from "../build-analyzer/BuildConditions.js";

interface BuildEditorProps {
  perks: readonly Perk[];
  onRemove: (perkId: string) => void;
  onBrowse: (perkId: string | null) => void;
  scenario: BuildScenario;
  onConditionChange: (condition: string, active: boolean) => void;
  onPerkStateChange: (perkId: string, state: PerkRuntimeState) => void;
}

export function BuildEditor({ perks, onRemove, onBrowse, scenario, onConditionChange, onPerkStateChange }: BuildEditorProps) {
  const slots = Array.from({ length: MAX_BUILD_PERKS }, (_, index) => perks[index] ?? null);

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
          const content = <>
            <span className="perk-icon build-icon">
              {perkIconUrl(perk) ? <img src={perkIconUrl(perk) ?? ""} alt="" /> : <span className="image-placeholder" aria-hidden="true">?</span>}
            </span>
            <span><strong>{name}</strong>{hasConditions && <small>Afficher les conditions</small>}</span>
          </>;

          return (
            <article className="compact-perk-slot filled" key={perk.id}>
              <button className="perk-slot-main" type="button" onClick={() => onBrowse(perk.id)} aria-label={`Voir ${name}`}>{content}</button>
              {hasConditions && (
                <details className="perk-condition-details">
                  <summary aria-label={`Afficher les conditions de ${name}`}><span aria-hidden="true">▶</span></summary>
                  <PerkConditions perk={perk} scenario={scenario} onConditionChange={onConditionChange} onPerkStateChange={onPerkStateChange} />
                </details>
              )}
              <button className="perk-slot-remove" type="button" onClick={() => onRemove(perk.id)} aria-label={`Retirer ${name}`}>×</button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
