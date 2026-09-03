import { useMemo, useState } from "react";

import { killerPortraitUrl, killerPropertyIconUrl } from "../../app/assets.js";
import { difficultyLabels, sizeLabels } from "../../app/labels.js";
import type { Killer } from "../../domain/killer.js";
import {
  DEFAULT_KILLER_OPTIONS,
  selectKillers,
  type KillerListOptions,
  type KillerSortKey
} from "../../services/killer-selector.js";

interface KillerSelectorProps {
  killers: readonly Killer[];
  selectedKillerId: string | null;
  onSelect: (killer: Killer) => void;
}

const propertyIcons = {
  speed: killerPropertyIconUrl("speed.png"),
  terrorRadius: killerPropertyIconUrl("terror_rayon.png"),
  size: killerPropertyIconUrl("size.png"),
  difficulty: killerPropertyIconUrl("difficulty.png")
};

export function KillerSelector({ killers, selectedKillerId, onSelect }: KillerSelectorProps) {
  const [options, setOptions] = useState<KillerListOptions>({ ...DEFAULT_KILLER_OPTIONS });
  const [listView, setListView] = useState(false);
  const visibleKillers = useMemo(() => selectKillers(killers, options), [killers, options]);

  return (
    <section className="page-shell selector-page embedded-selector-page">
      <section className="intro-block" aria-labelledby="killer-selector-title">
        <h1 id="killer-selector-title" tabIndex={-1}>Choisir un tueur <span className="catalog-title-count">{killers.length} tueurs</span></h1>
      </section>

      <section className="toolbar" aria-label="Recherche et tri des tueurs">
        <label className="field search-field">
          <span>Rechercher</span>
          <input
            type="search"
            value={options.query}
            onChange={(event) => setOptions((current) => ({ ...current, query: event.target.value }))}
            placeholder="Nom français ou anglais…"
          />
        </label>
        <label className="field">
          <span>Trier par</span>
          <select
            value={options.sortBy}
            onChange={(event) => setOptions((current) => ({
              ...current,
              sortBy: event.target.value as KillerSortKey
            }))}
          >
            <option value="tier">Tier</option>
            <option value="difficulty">Difficulté</option>
            <option value="speed">Vitesse</option>
            <option value="terrorRadius">Rayon de terreur</option>
            <option value="name">Nom</option>
          </select>
        </label>
        <button
          className="secondary-button direction-button"
          type="button"
          onClick={() => setOptions((current) => ({
            ...current,
            direction: current.direction === "asc" ? "desc" : "asc"
          }))}
          aria-label={options.direction === "asc" ? "Passer au tri descendant" : "Passer au tri ascendant"}
        >
          {options.direction === "asc" ? "Croissant ↑" : "Décroissant ↓"}
        </button>
        <button
          className="secondary-button view-toggle"
          type="button"
          aria-pressed={listView}
          onClick={() => setListView((current) => !current)}
        >
          {listView ? "Vue en blocs" : "Vue en liste"}
        </button>
      </section>

      {visibleKillers.length > 0 ? (
        <section className={`killer-grid${listView ? " killer-list" : ""}`} aria-label="Liste des tueurs">
          {visibleKillers.map((killer) => {
            const portrait = killerPortraitUrl(killer);
            const isSelected = killer.id === selectedKillerId;
            return (
              <button
                className={`killer-card${isSelected ? " selected" : ""}`}
                type="button"
                key={killer.id}
                onClick={() => onSelect(killer)}
                aria-pressed={isSelected}
              >
                <span className="killer-portrait">
                  {portrait ? (
                    <img src={portrait} alt="" loading="lazy" />
                  ) : (
                    <span className="image-placeholder" aria-hidden="true">?</span>
                  )}
                  <span className="tier-mark">{killer.tier}</span>
                </span>
                <span className="killer-card-body">
                  <strong>{killer.name.fr ?? killer.name.en ?? killer.id}</strong>
                  {killer.name.en && killer.name.en !== killer.name.fr && <small>{killer.name.en}</small>}
                  <span className="stat-row">
                    <span className="property-item">
                      <span className="property-main">
                        {propertyIcons.speed && <img className="property-icon" src={propertyIcons.speed} alt="" />}
                        <span><b>{killer.speed.toFixed(1)}</b> m/s</span>
                      </span>
                      <span className="property-label">Vitesse</span>
                    </span>
                    <span className="property-item">
                      <span className="property-main">
                        {propertyIcons.terrorRadius && <img className="property-icon" src={propertyIcons.terrorRadius} alt="" />}
                        <span><b>{killer.terrorRadius}</b> m</span>
                      </span>
                      <span className="property-label">Rayon de terreur</span>
                    </span>
                  </span>
                  <span className="meta-row">
                    <span className="property-item">
                      <span className="property-main">
                        {propertyIcons.size && <img className="property-icon" src={propertyIcons.size} alt="" />}
                        <span>{sizeLabels[killer.size]}</span>
                      </span>
                      <span className="property-label">Taille</span>
                    </span>
                    <span className="property-item">
                      <span className="property-main">
                        {propertyIcons.difficulty && <img className="property-icon" src={propertyIcons.difficulty} alt="" />}
                        <span>{difficultyLabels[killer.difficulty]}</span>
                      </span>
                      <span className="property-label">Difficulté</span>
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </section>
      ) : (
        <p className="empty-state">Aucun tueur ne correspond à cette recherche.</p>
      )}
    </section>
  );
}
