import { useEffect, useState } from "react";

import { killerPortraitUrl, perkIconUrl } from "../../app/assets.js";
import { perkOwner } from "../../app/catalog.js";
import { categoryLabels } from "../../app/labels.js";
import { RichDescription } from "../../components/RichDescription.js";
import { RichDescriptionEditor } from "../../components/RichDescriptionEditor.js";
import type { Killer } from "../../domain/killer.js";
import type { Perk } from "../../domain/perk.js";

interface PerkInspectorPanelProps {
  perk: Perk;
  owner: Killer | null;
  descriptionOverride: string | null;
  canEquip: boolean;
  isEquipped: boolean;
  buildIsFull: boolean;
  onClose: () => void;
  onResetDescriptionOverride: (perkId: string) => void;
  onSaveDescriptionOverride: (perkId: string, html: string) => void;
  onTogglePerk: (perkId: string) => void;
}

export function PerkInspectorPanel({
  perk,
  owner,
  descriptionOverride,
  canEquip,
  isEquipped,
  buildIsFull,
  onClose,
  onResetDescriptionOverride,
  onSaveDescriptionOverride,
  onTogglePerk,
}: PerkInspectorPanelProps) {
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const icon = perkIconUrl(perk);
  const portrait = owner ? killerPortraitUrl(owner) : null;
  const selectedDescription = perk.description.fr ?? perk.description.en ?? null;

  useEffect(() => {
    setIsEditingDescription(false);
  }, [perk.id]);

  return (
    <section className="analyzer-panel build-manager perk-inspector-panel" aria-labelledby="perk-inspector-title">
      <div className="compact-section-heading">
        <div>
          <span className="section-icon" aria-hidden="true">◈</span>
          <h2 id="perk-inspector-title">Perk Details</h2>
        </div>
        <button className="manager-icon-button" type="button" onClick={onClose} aria-label="Fermer les détails de la perk" title="Fermer">
          <CloseIcon />
        </button>
      </div>

      <div className="details-identity perk-inspector-identity">
        <span className="perk-icon large">
          {icon ? <img src={icon} alt="" /> : <span className="image-placeholder" aria-hidden="true">?</span>}
        </span>
        <div>
          <h3>{perk.name.fr ?? perk.name.en ?? perk.id}</h3>
          {perk.name.en && perk.name.en !== perk.name.fr && <p>{perk.name.en}</p>}
          <div className="perk-owner-chip">
            {portrait && (
              <span className="owner-portrait large" aria-hidden="true">
                <img src={portrait} alt="" loading="lazy" />
              </span>
            )}
            <span>{perkOwner(perk)}</span>
          </div>
        </div>
      </div>

      <div className="badge-row details-badges">
        {perk.categories.map((category) => (
          <span className="badge" key={category}>{categoryLabels[category]}</span>
        ))}
      </div>

      <div className="details-meta">
        <span>{perk.cooldown === null ? "Aucun cooldown" : `Cooldown : ${perk.cooldown} s`}</span>
        <span>{perk.icon ? "Icône disponible" : "Icône non résolue"}</span>
        <span>{perk.analysisReadiness === "ready"
          ? "Analyse disponible"
          : perk.analysisReadiness === "partial" ? "Analyse partielle" : "Analyse à compléter"}</span>
      </div>

      <button
        className="primary-button details-build-button"
        type="button"
        onClick={() => onTogglePerk(perk.id)}
        disabled={!canEquip || (!isEquipped && buildIsFull)}
      >
        {!canEquip ? "Choisir un tueur" : isEquipped ? "Retirer du build" : buildIsFull ? "Build complet" : "Ajouter au build"}
      </button>

      <div className="description-section-heading">
        <p className="description-section-title">Description</p>
        <div className="description-section-actions">
          {descriptionOverride && <span className="description-override-badge">Version locale</span>}
          <button
            className="secondary-button compact-button"
            type="button"
            onClick={() => setIsEditingDescription((current) => !current)}
          >
            {isEditingDescription ? "Fermer l'éditeur" : "Modifier la description"}
          </button>
        </div>
      </div>

      {isEditingDescription ? (
        <RichDescriptionEditor
          description={selectedDescription}
          initialHtml={descriptionOverride}
          onCancel={() => setIsEditingDescription(false)}
          onSave={(html) => {
            onSaveDescriptionOverride(perk.id, html);
            setIsEditingDescription(false);
          }}
          {...(descriptionOverride
            ? {
              onReset: () => {
                onResetDescriptionOverride(perk.id);
                setIsEditingDescription(false);
              }
            }
            : {})}
        />
      ) : (
        <RichDescription description={selectedDescription} editableHtml={descriptionOverride} />
      )}
    </section>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}