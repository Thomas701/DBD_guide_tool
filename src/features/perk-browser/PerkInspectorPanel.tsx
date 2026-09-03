import { useEffect, useState } from "react";

import { killerPortraitUrl, perkIconUrl } from "../../app/assets.js";
import { perkOwner } from "../../app/catalog.js";
import { categoryLabels } from "../../app/labels.js";
import { RichDescription } from "../../components/RichDescription.js";
import { RichDescriptionEditor } from "../../components/RichDescriptionEditor.js";
import { PERK_CATEGORIES, type PerkCategory } from "../../domain/category.js";
import type { Killer } from "../../domain/killer.js";
import type { Perk } from "../../domain/perk.js";

type EditMode = "native" | "local";

interface PerkInspectorPanelProps {
  perk: Perk;
  owner: Killer | null;
  descriptionOverride: string | null;
  categoryOverride: readonly PerkCategory[] | null;
  nativeCategories: readonly PerkCategory[];
  canEquip: boolean;
  isEquipped: boolean;
  buildIsFull: boolean;
  onClose: () => void;
  onResetDescriptionOverride: (perkId: string) => void;
  onSaveDescriptionOverride: (perkId: string, html: string) => void;
  onSaveNativeDescription: (perkId: string, html: string) => Promise<void>;
  onResetCategoryOverride: (perkId: string) => void;
  onSaveCategoryOverride: (perkId: string, categories: readonly PerkCategory[]) => void;
  onSaveNativeCategories: (perkId: string, categories: readonly PerkCategory[]) => Promise<void>;
  onTogglePerk: (perkId: string) => void;
}

export function PerkInspectorPanel({
  perk,
  owner,
  descriptionOverride,
  categoryOverride,
  nativeCategories,
  canEquip,
  isEquipped,
  buildIsFull,
  onClose,
  onResetDescriptionOverride,
  onSaveDescriptionOverride,
  onSaveNativeDescription,
  onResetCategoryOverride,
  onSaveCategoryOverride,
  onSaveNativeCategories,
  onTogglePerk,
}: PerkInspectorPanelProps) {
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isEditingCategories, setIsEditingCategories] = useState(false);
  const [editMode, setEditMode] = useState<EditMode>("local");
  const [draftCategories, setDraftCategories] = useState<PerkCategory[]>([]);
  const [categorySaveError, setCategorySaveError] = useState<string | null>(null);
  const [isSavingCategories, setIsSavingCategories] = useState(false);
  const icon = perkIconUrl(perk);
  const portrait = owner ? killerPortraitUrl(owner) : null;
  const selectedDescription = perk.description.fr ?? perk.description.en ?? null;
  const nativeDescriptionHtml = perk.nativeDescriptionHtml ?? null;
  const displayedDescriptionHtml = descriptionOverride ?? nativeDescriptionHtml;

  useEffect(() => {
    setIsEditingDescription(false);
    setIsEditingCategories(false);
    setEditMode("local");
  }, [perk.id]);

  function changeEditMode(mode: EditMode): void {
    setEditMode(mode);
    setDraftCategories(mode === "native" ? [...nativeCategories] : [...(categoryOverride ?? nativeCategories)]);
    setCategorySaveError(null);
  }

  function openCategoryEditor(): void {
    setDraftCategories(editMode === "native" ? [...nativeCategories] : [...(categoryOverride ?? nativeCategories)]);
    setCategorySaveError(null);
    setIsEditingCategories((current) => !current);
  }

  function toggleDraftCategory(category: PerkCategory, checked: boolean): void {
    setDraftCategories((current) => checked
      ? [...current, category]
      : current.filter((value) => value !== category));
  }

  async function saveCategories(): Promise<void> {
    setIsSavingCategories(true);
    setCategorySaveError(null);
    try {
      if (editMode === "native") await onSaveNativeCategories(perk.id, draftCategories);
      else onSaveCategoryOverride(perk.id, draftCategories);
      setIsEditingCategories(false);
    } catch (error) {
      setCategorySaveError(error instanceof Error ? error.message : "Enregistrement impossible.");
    } finally {
      setIsSavingCategories(false);
    }
  }

  return (
    <section className="analyzer-panel build-manager perk-inspector-panel" aria-label="Détails de la perk">
      <div className="details-identity perk-inspector-identity">
        {portrait && (
          <span className="inspector-owner-background" aria-hidden="true">
            <img src={portrait} alt="" loading="lazy" />
          </span>
        )}
        <span className="perk-icon large">
          {icon ? <img src={icon} alt="" /> : <span className="image-placeholder" aria-hidden="true">?</span>}
        </span>
        <div className="perk-inspector-title">
          <h3>{perk.name.fr ?? perk.name.en ?? perk.id}</h3>
          {perk.name.en && perk.name.en !== perk.name.fr && <p>{perk.name.en}</p>}
          <div className="perk-owner-chip">
            <span>{perkOwner(perk)}</span>
          </div>
        </div>
        <button className="manager-icon-button inspector-close-button" type="button" onClick={onClose} aria-label="Fermer les détails de la perk" title="Fermer">
          <CloseIcon />
        </button>
      </div>

      <div className="inspector-section-heading categories-section-heading">
        <div className="inspector-heading-controls">
          <p className="description-section-title">Catégories</p>
          <button className={`manager-icon-button category-edit-button${isEditingCategories ? " active" : ""}`} type="button" onClick={openCategoryEditor} aria-label="Modifier les catégories" title="Modifier les catégories">
            <CategoryEditIcon />
          </button>
          {categoryOverride !== null && (
            <button className="manager-icon-button reset-override-button" type="button" onClick={() => onResetCategoryOverride(perk.id)} aria-label="Rétablir les catégories natives" title="Rétablir les catégories natives">
              <ResetIcon />
            </button>
          )}
        </div>
        {categoryOverride !== null && <span className="description-override-badge">Version locale</span>}
      </div>

      {isEditingCategories ? (
        <div className="category-editor">
          <EditModeToggle mode={editMode} onChange={changeEditMode} />
          <div className="category-editor-options">
            {PERK_CATEGORIES.map((category) => (
              <label key={category}>
                <input type="checkbox" checked={draftCategories.includes(category)} onChange={(event) => toggleDraftCategory(category, event.target.checked)} />
                <span>{categoryLabels[category]}</span>
              </label>
            ))}
          </div>
          {categorySaveError && <p className="description-editor-error" role="alert">{categorySaveError}</p>}
          <div className="description-editor-actions">
            <button className="secondary-button compact-button" type="button" onClick={() => setIsEditingCategories(false)} disabled={isSavingCategories}>Annuler</button>
            <button className="primary-button compact-button" type="button" onClick={() => void saveCategories()} disabled={isSavingCategories}>{isSavingCategories ? "Enregistrement…" : "Enregistrer"}</button>
          </div>
        </div>
      ) : (
        <div className="badge-row details-badges">
          {perk.categories.length > 0
            ? perk.categories.map((category) => <span className="badge" key={category}>{categoryLabels[category]}</span>)
            : <span className="empty-copy">Aucune catégorie.</span>}
        </div>
      )}

      <button
        className="primary-button details-build-button"
        type="button"
        onClick={() => onTogglePerk(perk.id)}
        disabled={!canEquip || (!isEquipped && buildIsFull)}
      >
        {!canEquip ? "Choisir un tueur" : isEquipped ? "Retirer du build" : buildIsFull ? "Build complet" : "Ajouter au build"}
      </button>

      <div className="inspector-section-heading description-section-heading">
        <div className="inspector-heading-controls">
          <p className="description-section-title">Description</p>
          <button
            className={`manager-icon-button description-edit-button${isEditingDescription ? " active" : ""}`}
            type="button"
            onClick={() => setIsEditingDescription((current) => !current)}
            aria-label={isEditingDescription ? "Fermer l’éditeur de description" : "Modifier la description"}
            title={isEditingDescription ? "Fermer l’éditeur" : "Modifier la description"}
          >
            <PencilIcon />
          </button>
          {descriptionOverride && (
            <button className="manager-icon-button reset-override-button" type="button" onClick={() => onResetDescriptionOverride(perk.id)} aria-label="Rétablir la description native" title="Rétablir la description native">
              <ResetIcon />
            </button>
          )}
        </div>
        {descriptionOverride && <span className="description-override-badge">Version locale</span>}
      </div>

      {isEditingDescription ? (
        <div className="inspector-editor-stack">
          <EditModeToggle mode={editMode} onChange={changeEditMode} />
          <RichDescriptionEditor
            description={selectedDescription}
            initialHtml={editMode === "native" ? nativeDescriptionHtml : descriptionOverride ?? nativeDescriptionHtml}
            onCancel={() => setIsEditingDescription(false)}
            onSave={async (html) => {
              if (editMode === "native") await onSaveNativeDescription(perk.id, html);
              else onSaveDescriptionOverride(perk.id, html);
              setIsEditingDescription(false);
            }}
          />
        </div>
      ) : (
        <RichDescription description={selectedDescription} editableHtml={displayedDescriptionHtml} />
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

function EditModeToggle({ mode, onChange }: { mode: EditMode; onChange: (mode: EditMode) => void }) {
  return (
    <div className="edit-mode-toggle" role="group" aria-label="Emplacement de l’enregistrement">
      <button type="button" className={mode === "native" ? "active" : ""} aria-pressed={mode === "native"} onClick={() => onChange("native")}>Natif</button>
      <button type="button" className={mode === "local" ? "active" : ""} aria-pressed={mode === "local"} onClick={() => onChange("local")}>Local</button>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4v6h6" />
      <path d="M5.5 15a7 7 0 1 0 1.2-7.9L4 10" />
    </svg>
  );
}

function CategoryEditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" />
      <path d="M4 17h2" /><path d="M10 17h10" /><circle cx="8" cy="17" r="2" />
    </svg>
  );
}
