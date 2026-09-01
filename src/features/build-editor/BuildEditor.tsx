import { perkIconUrl } from "../../app/assets.js";
import { MAX_BUILD_PERKS } from "../../domain/build.js";
import type { Perk } from "../../domain/perk.js";

interface BuildEditorProps {
  perks: readonly Perk[];
  onRemove: (perkId: string) => void;
  onClear: () => void;
  onBrowse: () => void;
}

export function BuildEditor({ perks, onRemove, onClear, onBrowse }: BuildEditorProps) {
  const slots = Array.from({ length: MAX_BUILD_PERKS }, (_, index) => perks[index] ?? null);

  return (
    <section className="analyzer-panel build-editor compact-build-editor" aria-labelledby="build-editor-title">
      <div className="compact-section-heading">
        <div>
          <span className="section-icon" aria-hidden="true">◈</span>
          <h2 id="build-editor-title">Selected Perks</h2>
        </div>
        <button className="text-button" type="button" onClick={onClear} disabled={perks.length === 0}>Vider</button>
      </div>

      <div className="compact-perk-slots" aria-label="Emplacements de perks">
        {slots.map((perk, index) => perk ? (
          <article className="compact-perk-slot filled" key={perk.id}>
            <span className="perk-slot-index">{index + 1}</span>
            <button className="perk-slot-main" type="button" onClick={onBrowse} aria-label={`Changer ${perk.name.fr ?? perk.name.en ?? perk.id}`}>
              <span className="perk-icon build-icon">
                {perkIconUrl(perk) ? <img src={perkIconUrl(perk) ?? ""} alt="" /> : <span className="image-placeholder" aria-hidden="true">?</span>}
              </span>
              <span>
                <strong>{perk.name.fr ?? perk.name.en ?? perk.id}</strong>
                <small>{perk.analysisReadiness === "ready" ? "Analyse disponible" : "Analyse partielle"}</small>
              </span>
            </button>
            <button className="perk-slot-remove" type="button" onClick={() => onRemove(perk.id)} aria-label={`Retirer ${perk.name.fr ?? perk.name.en ?? perk.id}`}>×</button>
          </article>
        ) : (
          <button className="compact-perk-slot empty" type="button" key={`empty-${index}`} onClick={onBrowse}>
            <span className="perk-slot-index">{index + 1}</span>
            <span className="empty-perk-diamond" aria-hidden="true">◇</span>
            <span>Ajouter une perk</span>
          </button>
        ))}
      </div>
    </section>
  );
}
