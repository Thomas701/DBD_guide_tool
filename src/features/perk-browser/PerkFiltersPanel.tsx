import { useMemo } from "react";

import { categoryLabels } from "../../app/labels.js";
import { PERK_CATEGORIES, type PerkCategory } from "../../domain/category.js";
import type { Killer } from "../../domain/killer.js";
import { DEFAULT_PERK_FILTERS, type CategoryMatchMode, type CooldownFilter, type PerkFilters } from "../../services/perk-filter.js";

interface PerkFiltersPanelProps {
  killers: readonly Killer[];
  filters: PerkFilters;
  detailsOpen: { characters: boolean; categories: boolean };
  onChange: (filters: PerkFilters) => void;
  onDetailsOpenChange: (detail: "characters" | "categories", open: boolean) => void;
}

export function PerkFiltersPanel({ killers, filters, detailsOpen, onChange, onDetailsOpenChange }: PerkFiltersPanelProps) {
  const sortedKillers = useMemo(() => [...killers].sort((left, right) => (left.name.fr ?? left.id).localeCompare(right.name.fr ?? right.id, "fr")), [killers]);
  const update = (change: (current: PerkFilters) => PerkFilters): void => onChange(change(filters));
  const toggleCategory = (category: PerkCategory, checked: boolean): void => update((current) => ({ ...current, categories: checked ? [...current.categories, category] : current.categories.filter((value) => value !== category) }));
  const toggleCharacter = (characterId: string | null, checked: boolean): void => update((current) => ({ ...current, characterIds: checked ? [...current.characterIds, characterId] : current.characterIds.filter((value) => value !== characterId) }));

  return <aside className="filter-panel sidebar-perk-filter-panel" aria-label="Filtres des perks">
    <div className="filter-title"><h3>Filtres</h3><button className="text-button" type="button" onClick={() => onChange({ ...DEFAULT_PERK_FILTERS, categories: [] })}>Réinitialiser</button></div>
    <label className="field"><span>Recherche</span><input type="search" value={filters.query} onChange={(event) => update((current) => ({ ...current, query: event.target.value }))} placeholder="Perk ou tueur…" /></label>
    <details className="character-filter" open={detailsOpen.characters} onToggle={(event) => onDetailsOpenChange("characters", event.currentTarget.open)}><summary>Tueurs{filters.characterIds.length > 0 ? ` (${filters.characterIds.length})` : ""}</summary><div className="character-options" role="group" aria-label="Tueurs des perks">
      <label><input type="checkbox" checked={filters.characterIds.includes(null)} onChange={(event) => toggleCharacter(null, event.target.checked)} /><span>Perks générales</span></label>
      {sortedKillers.map((killer) => <label key={killer.id}><input type="checkbox" checked={filters.characterIds.includes(killer.id)} onChange={(event) => toggleCharacter(killer.id, event.target.checked)} /><span>{killer.name.fr ?? killer.name.en}</span></label>)}
    </div></details>
    <details className="category-filter" open={detailsOpen.categories} onToggle={(event) => onDetailsOpenChange("categories", event.currentTarget.open)}><summary>Catégories{filters.categories.length > 0 ? ` (${filters.categories.length})` : ""}</summary><fieldset className="segmented-field"><div className="category-match-control"><div className="segmented-control">
      {(["any", "all"] as CategoryMatchMode[]).map((mode) => <label key={mode}><input type="radio" name="category-mode" value={mode} checked={filters.categoryMode === mode} onChange={() => update((current) => ({ ...current, categoryMode: mode }))} /><span>{mode === "any" ? "Au moins une" : "Toutes"}</span></label>)}
    </div><span className="filter-help" tabIndex={0} aria-label="Aide sur la correspondance des catégories">?<span role="tooltip">Choisissez si une perk doit correspondre à une seule catégorie cochée ou à toutes.</span></span></div></fieldset>
    <div className="category-options" role="group" aria-label="Catégories de perks">{SORTED_PERK_CATEGORIES.map((category) => <label key={category}><input type="checkbox" checked={filters.categories.includes(category)} onChange={(event) => toggleCategory(category, event.target.checked)} /><span>{categoryLabels[category]}</span></label>)}</div></details>
    <label className="field"><span>Cooldown</span><select value={filters.cooldown} onChange={(event) => update((current) => ({ ...current, cooldown: event.target.value as CooldownFilter }))}><option value="any">Tous</option><option value="with">Avec cooldown</option><option value="without">Sans cooldown</option></select></label>
  </aside>;
}

const SORTED_PERK_CATEGORIES = [...PERK_CATEGORIES].sort((left, right) => categoryLabels[left].localeCompare(categoryLabels[right], "fr"));
