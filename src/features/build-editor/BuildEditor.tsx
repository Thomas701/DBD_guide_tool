import { perkIconUrl } from "../../app/assets.js";
import { MAX_BUILD_PERKS } from "../../domain/build.js";
import type { Perk } from "../../domain/perk.js";

interface BuildEditorProps {
  perks: readonly Perk[];
  onRemove: (perkId: string) => void;
  onBrowse: (perkId: string | null) => void;
}

export function BuildEditor({ perks, onRemove, onBrowse }: BuildEditorProps) {
  const slots = Array.from({ length: MAX_BUILD_PERKS }, (_, index) => perks[index] ?? null);

  return (
    <div className="build-editor compact-build-editor">
      <div className="compact-perk-slots" aria-label="Emplacements de perks">
        {slots.map((perk, index) => perk ? (
          <article className="compact-perk-slot filled" key={perk.id}>
            <button className="perk-slot-main" type="button" onClick={() => onBrowse(perk.id)} aria-label={`Voir ${perk.name.fr ?? perk.name.en ?? perk.id}`}>
              <span className="perk-icon build-icon">
                {perkIconUrl(perk) ? <img src={perkIconUrl(perk) ?? ""} alt="" /> : <span className="image-placeholder" aria-hidden="true">?</span>}
              </span>
              <span>
                <strong>{perk.name.fr ?? perk.name.en ?? perk.id}</strong>
              </span>
            </button>
            <button className="perk-slot-remove" type="button" onClick={() => onRemove(perk.id)} aria-label={`Retirer ${perk.name.fr ?? perk.name.en ?? perk.id}`}>×</button>
          </article>
        ) : (
          <button className="compact-perk-slot empty" type="button" key={`empty-${index}`} onClick={() => onBrowse(null)}>
            <span className="empty-perk-diamond" aria-hidden="true"><b>{index + 1}</b></span>
            <span>Ajouter une perk</span>
          </button>
        ))}
      </div>
    </div>
  );
}
