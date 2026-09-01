import { useMemo, useState } from "react";

import { killerPortraitUrl, perkIconUrl } from "../../app/assets.js";
import { perkOwner } from "../../app/catalog.js";
import { categoryLabels } from "../../app/labels.js";
import { PERK_CATEGORIES, type PerkCategory } from "../../domain/category.js";
import { MAX_BUILD_PERKS } from "../../domain/build.js";
import type { Killer } from "../../domain/killer.js";
import type { Perk } from "../../domain/perk.js";
import {
  DEFAULT_PERK_FILTERS,
  filterPerks,
  type CategoryMatchMode,
  type CooldownFilter,
  type PerkFilters
} from "../../services/perk-filter.js";

interface PerkBrowserProps {
  perks: readonly Perk[];
  killers: readonly Killer[];
  equippedPerkIds: readonly string[];
  canEquip?: boolean;
  selectedPerkId: string | null;
  onSelectPerk: (perkId: string | null) => void;
  onTogglePerk: (perkId: string) => void;
}

export function PerkBrowser({
  perks,
  killers,
  equippedPerkIds,
  canEquip = true,
  selectedPerkId,
  onSelectPerk,
  onTogglePerk,
}: PerkBrowserProps) {
  const [filters, setFilters] = useState<PerkFilters>({
    ...DEFAULT_PERK_FILTERS,
    categories: []
  });
  const [filtersVisible, setFiltersVisible] = useState(true);
  const visiblePerks = useMemo(() => filterPerks(perks, filters, killers), [perks, filters, killers]);
  const sortedKillers = useMemo(() => [...killers].sort((left, right) =>
    (left.name.fr ?? left.id).localeCompare(right.name.fr ?? right.id, "fr")
  ), [killers]);
  const killerById = useMemo(() => new Map(killers.map((killer) => [killer.id, killer])), [killers]);
  const equippedPerkSet = new Set(equippedPerkIds);
  const buildIsFull = equippedPerkIds.length >= MAX_BUILD_PERKS;

  function toggleCategory(category: PerkCategory, checked: boolean): void {
    setFilters((current) => ({
      ...current,
      categories: checked
        ? [...current.categories, category]
        : current.categories.filter((value) => value !== category)
    }));
  }

  function toggleCharacter(characterId: string | null, checked: boolean): void {
    setFilters((current) => ({
      ...current,
      characterIds: checked
        ? [...current.characterIds, characterId]
        : current.characterIds.filter((value) => value !== characterId)
    }));
  }

  function resetFilters(): void {
    setFilters({ ...DEFAULT_PERK_FILTERS, categories: [] });
  }

  function toggleDetails(perkId: string): void {
    onSelectPerk(selectedPerkId === perkId ? null : perkId);
  }

  return (
    <section className="browser-section" aria-labelledby="perk-library-title">
      <div className="section-heading">
        <div>
          <button
            className="filter-panel-toggle"
            type="button"
            aria-label={filtersVisible ? "Masquer les filtres" : "Afficher les filtres"}
            aria-pressed={filtersVisible}
            title={filtersVisible ? "Masquer les filtres" : "Afficher les filtres"}
            onClick={() => setFiltersVisible((current) => !current)}
          >
            ⋮
          </button>
          <h2 id="perk-library-title">Perks de tueur</h2>
        </div>
        <div className="catalog-heading-actions">
          <p className="result-count" aria-live="polite">
            {visiblePerks.length} sur {perks.filter((perk) => perk.side === "killer").length}
          </p>
        </div>
      </div>

      <div className={`library-layout${filtersVisible ? "" : " filters-collapsed"}`}>
        {filtersVisible && <aside className="filter-panel" aria-label="Filtres des perks">
          <div className="filter-title">
            <h3>Filtres</h3>
            <button className="text-button" type="button" onClick={resetFilters}>Réinitialiser</button>
          </div>

          <label className="field">
            <span>Recherche</span>
            <input
              type="search"
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="Perk ou tueur…"
            />
          </label>

          <details className="character-filter">
            <summary>
              Tueurs{filters.characterIds.length > 0 ? ` (${filters.characterIds.length})` : ""}
            </summary>
            <div className="character-options" role="group" aria-label="Tueurs des perks">
              <label>
                <input
                  type="checkbox"
                  checked={filters.characterIds.includes(null)}
                  onChange={(event) => toggleCharacter(null, event.target.checked)}
                />
                <span>Perks générales</span>
              </label>
              {sortedKillers.map((killer) => (
                <label key={killer.id}>
                  <input
                    type="checkbox"
                    checked={filters.characterIds.includes(killer.id)}
                    onChange={(event) => toggleCharacter(killer.id, event.target.checked)}
                  />
                  <span>{killer.name.fr ?? killer.name.en}</span>
                </label>
              ))}
            </div>
          </details>

          <details className="category-filter">
            <summary>
              Catégories{filters.categories.length > 0 ? ` (${filters.categories.length})` : ""}
            </summary>
            <fieldset className="segmented-field">
              <div className="category-match-control">
              <div className="segmented-control">
                {(["any", "all"] as CategoryMatchMode[]).map((mode) => (
                  <label key={mode}>
                    <input
                      type="radio"
                      name="category-mode"
                      value={mode}
                      checked={filters.categoryMode === mode}
                      onChange={() => setFilters((current) => ({ ...current, categoryMode: mode }))}
                    />
                    <span>{mode === "any" ? "Au moins une" : "Toutes"}</span>
                  </label>
                ))}
              </div>
              <span className="filter-help" tabIndex={0} aria-label="Aide sur la correspondance des catégories">
                ?
                <span role="tooltip">Choisissez si une perk doit correspondre à une seule catégorie cochée ou à toutes.</span>
              </span>
              </div>
            </fieldset>
            <div className="category-options" role="group" aria-label="Catégories de perks">
              {SORTED_PERK_CATEGORIES.map((category) => (
                <label key={category}>
                  <input
                    type="checkbox"
                    checked={filters.categories.includes(category)}
                    onChange={(event) => toggleCategory(category, event.target.checked)}
                  />
                  <span>{categoryLabels[category]}</span>
                </label>
              ))}
            </div>
          </details>

          <label className="field">
            <span>Cooldown</span>
            <select
              value={filters.cooldown}
              onChange={(event) => setFilters((current) => ({
                ...current,
                cooldown: event.target.value as CooldownFilter
              }))}
            >
              <option value="any">Tous</option>
              <option value="with">Avec cooldown</option>
              <option value="without">Sans cooldown</option>
            </select>
          </label>
        </aside>}

        <div className="perk-results">
          {visiblePerks.length > 0 ? (
            <div className="perk-grid" aria-label="Liste des perks filtrées">
              {visiblePerks.map((perk) => {
                const icon = perkIconUrl(perk);
                const owner = perk.characterId ? killerById.get(perk.characterId) ?? null : null;
                const ownerPortrait = owner ? killerPortraitUrl(owner) : null;
                const isSelected = selectedPerkId === perk.id;
                const isEquipped = equippedPerkSet.has(perk.id);
                return (
                  <article className={`perk-card${isSelected ? " selected" : ""}${isEquipped ? " equipped" : ""}`} key={perk.id}>
                    {ownerPortrait && (
                      <span className="owner-portrait" aria-hidden="true">
                        <img src={ownerPortrait} alt="" loading="lazy" />
                      </span>
                    )}
                    <button
                      className="perk-card-details"
                      type="button"
                      onClick={() => toggleDetails(perk.id)}
                      aria-expanded={isSelected}
                    >
                      <span className="perk-icon">
                        {icon ? <img src={icon} alt="" loading="lazy" /> : <span className="image-placeholder" aria-hidden="true">?</span>}
                      </span>
                      <span className="perk-card-copy">
                        <strong>{perk.name.fr ?? perk.name.en ?? perk.id}</strong>
                        {perk.name.en && perk.name.en !== perk.name.fr && <small>{perk.name.en}</small>}
                        <span className="owner-name">{perkOwner(perk)}</span>
                      </span>
                    </button>
                    <button
                      className="perk-toggle-button"
                      type="button"
                      onClick={() => onTogglePerk(perk.id)}
                      disabled={!canEquip || (!isEquipped && buildIsFull)}
                      aria-pressed={isEquipped}
                    >
                      {!canEquip ? "Choisir un tueur" : isEquipped ? "Retirer du build" : buildIsFull ? "Build complet" : "Ajouter au build"}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="empty-state">Aucune perk ne correspond à l’ensemble de ces filtres.</p>
          )}
        </div>
      </div>
    </section>
  );
}

const SORTED_PERK_CATEGORIES = [...PERK_CATEGORIES].sort((left, right) =>
  categoryLabels[left].localeCompare(categoryLabels[right], "fr")
);
