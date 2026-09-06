import { useEffect, useMemo } from "react";

import { entityPortraitUrl, killerPortraitUrl, perkIconUrl } from "../../app/assets.js";
import { perkOwner } from "../../app/catalog.js";
import { MAX_BUILD_PERKS } from "../../domain/build.js";
import type { Killer } from "../../domain/killer.js";
import type { Perk } from "../../domain/perk.js";
import { DEFAULT_PERK_FILTERS, filterPerks, type PerkFilters } from "../../services/perk-filter.js";

interface PerkBrowserProps {
  perks: readonly Perk[];
  killers: readonly Killer[];
  filters: PerkFilters;
  equippedPerkIds: readonly string[];
  canEquip?: boolean;
  selectedPerkId: string | null;
  scrollToPerkId?: string | null;
  onFiltersChange: (filters: PerkFilters) => void;
  onSelectPerk: (perkId: string | null) => void;
  onTogglePerk: (perkId: string) => void;
}

export function PerkBrowser({ perks, killers, filters, equippedPerkIds, canEquip = true, selectedPerkId, scrollToPerkId = null, onFiltersChange, onSelectPerk, onTogglePerk }: PerkBrowserProps) {
  const visiblePerks = useMemo(() => filterPerks(perks, filters, killers), [perks, filters, killers]);
  const killerById = useMemo(() => new Map(killers.map((killer) => [killer.id, killer])), [killers]);
  const equippedPerkSet = new Set(equippedPerkIds);
  const buildIsFull = equippedPerkIds.length >= MAX_BUILD_PERKS;
  const totalKillerPerks = perks.filter((perk) => perk.side === "killer").length;

  useEffect(() => {
    if (!scrollToPerkId) return;
    if (!visiblePerks.some((perk) => perk.id === scrollToPerkId)) {
      onFiltersChange({ ...DEFAULT_PERK_FILTERS, categories: [] });
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const perkCard = document.querySelector<HTMLElement>(`[data-perk-id="${CSS.escape(scrollToPerkId)}"]`);
      const catalogPanel = perkCard?.closest<HTMLElement>(".workspace-catalog-panel");
      if (!perkCard || !catalogPanel) return;
      const cardBounds = perkCard.getBoundingClientRect();
      const panelBounds = catalogPanel.getBoundingClientRect();
      catalogPanel.scrollBy({ top: cardBounds.top - panelBounds.top - (catalogPanel.clientHeight - cardBounds.height) / 2, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scrollToPerkId, visiblePerks, onFiltersChange]);

  return <section className="browser-section" aria-labelledby="perk-library-title">
    <div className="section-heading"><div><h2 id="perk-library-title">Sélectionne tes perks <span className="catalog-title-count">{totalKillerPerks} perks</span></h2></div></div>
    <div className="perk-results">
      {visiblePerks.length > 0 ? <div className="perk-grid" aria-label="Liste des perks filtrées">
        {visiblePerks.map((perk) => {
          const icon = perkIconUrl(perk);
          const owner = perk.characterId ? killerById.get(perk.characterId) ?? null : null;
          const ownerPortrait = owner ? killerPortraitUrl(owner) : entityPortraitUrl;
          const isSelected = selectedPerkId === perk.id;
          const isEquipped = equippedPerkSet.has(perk.id);
          return <article className={`perk-card${isSelected ? " selected" : ""}${isEquipped ? " equipped" : ""}`} data-perk-id={perk.id} key={perk.id}>
            {ownerPortrait && <span className="owner-portrait" aria-hidden="true"><img src={ownerPortrait} alt="" loading="lazy" /></span>}
            <button className="perk-card-details" type="button" onClick={() => onSelectPerk(isSelected ? null : perk.id)} aria-expanded={isSelected}>
              <span className="perk-icon">{icon ? <img src={icon} alt="" loading="lazy" /> : <span className="image-placeholder" aria-hidden="true">?</span>}</span>
              <span className="perk-card-copy"><strong>{perk.name.fr ?? perk.name.en ?? perk.id}</strong>{perk.name.en && perk.name.en !== perk.name.fr && <small>{perk.name.en}</small>}<span className="owner-name">{perkOwner(perk)}</span></span>
            </button>
            <button className="perk-toggle-button" type="button" onClick={() => onTogglePerk(perk.id)} disabled={!canEquip || (!isEquipped && buildIsFull)} aria-pressed={isEquipped}>
              {!canEquip ? "Choisir un tueur" : isEquipped ? "Retirer du build" : buildIsFull ? "Build complet" : "Ajouter au build"}
            </button>
          </article>;
        })}
      </div> : <p className="empty-state">Aucune perk ne correspond à l’ensemble de ces filtres.</p>}
    </div>
  </section>;
}
