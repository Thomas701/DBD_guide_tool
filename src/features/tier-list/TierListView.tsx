import { useRef, useState, type DragEvent } from "react";
import { killerPortraitUrl, perkIconUrl } from "../../app/assets.js";
import { categoryLabels, difficultyLabels, sizeLabels } from "../../app/labels.js";
import { RichDescription } from "../../components/RichDescription.js";
import { PerkStatusDefinitions } from "../../components/PerkStatusDefinitions.js";
import { PERK_TIER_REVIEW } from "../../data/perk-tiers.js";
import { KILLER_TIERS, type Killer, type KillerTier } from "../../domain/killer.js";
import { killerPowerDescription } from "../../services/killer-powers.js";
import type { PerkTierEntry, TierOverrides } from "../../services/tier-list.js";

type TierKind = "killers" | "killer-perks" | "survivor-perks";
const TABS: { kind: TierKind; label: string; title: string }[] = [
  { kind: "killers", label: "Killer", title: "Tier list des tueurs" },
  { kind: "killer-perks", label: "Perk killer", title: "Tier list des perks tueurs" },
  { kind: "survivor-perks", label: "Perk survivor", title: "Tier list des perks survivants" }
];

interface TierListViewProps {
  killers: readonly Killer[];
  survivors: readonly Killer[];
  perkTierList: readonly PerkTierEntry[];
  descriptionOverrides: Readonly<Record<string, string>>;
  onMove: (kind: keyof TierOverrides, id: string, tier: KillerTier) => void;
}

export function TierListView({ killers, survivors, perkTierList, descriptionOverrides, onMove }: TierListViewProps) {
  const [kind, setKind] = useState<TierKind>("killers");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dropTier, setDropTier] = useState<KillerTier | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const dragged = useRef<{ kind: TierKind; id: string } | null>(null);
  const killer = kind === "killers" ? killers.find(({ id }) => id === selectedId) : undefined;
  const ranked = perkTierList.filter(({ perk }) => perk.side === (kind === "survivor-perks" ? "survivor" : "killer"));
  const entry = kind === "killers" ? undefined : ranked.find(({ perk }) => perk.id === selectedId);
  const perk = entry?.perk;
  const selected = killer ?? perk;
  const selectedTier = killer?.tier ?? entry?.tier;
  const owner = perk?.characterId ? [...killers, ...survivors].find(({ id }) => id === perk.characterId) : undefined;
  const title = TABS.find((tab) => tab.kind === kind)!.title;

  function move(id: string, tier: KillerTier): void {
    if (!(KILLER_TIERS as readonly string[]).includes(tier)) return;
    const item = kind === "killers" ? killers.find((candidate) => candidate.id === id) : ranked.find(({ perk: candidate }) => candidate.id === id)?.perk;
    if (!item) return;
    try {
      onMove(kind === "killers" ? "killers" : "perks", id, tier);
      setMessage(`${item.name.fr ?? item.name.en ?? id} déplacé en ${tier}.`);
    } catch (error) { setMessage(`Déplacement impossible : ${error instanceof Error ? error.message : "enregistrement indisponible"}`); }
  }

  function startDrag(event: DragEvent<HTMLButtonElement>, id: string): void {
    dragged.current = { kind, id };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-dbd-tier-entry", id);
  }

  function endDrag(): void { dragged.current = null; setDropTier(null); }

  return <main className={`tier-list-page${selected ? " has-selection" : ""}`} data-kind={kind}>
    <aside className="tier-list-sidebar" aria-label="Type de tier list">
      {TABS.map((tab) => <button key={tab.kind} className={kind === tab.kind ? "selected" : ""} aria-pressed={kind === tab.kind} onClick={() => { setKind(tab.kind); setSelectedId(null); setMessage(null); endDrag(); }} type="button">{tab.label}</button>)}
      {kind !== "killers" && <details className="tier-list-method"><summary>Critères du classement</summary><p>Révision : {PERK_TIER_REVIEW.date}</p><p>{PERK_TIER_REVIEW.scope}</p>{PERK_TIER_REVIEW.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.title}</a>)}</details>}
      {message && <p role="status">{message}</p>}
    </aside>
    <section className="tier-list-board" aria-label={title}>
      {KILLER_TIERS.map((tier) => {
        const rankedKillers = kind === "killers" ? killers.filter((candidate) => candidate.tier === tier) : [];
        const rankedPerks = kind === "killers" ? [] : ranked.filter((candidate) => candidate.tier === tier);
        const count = rankedKillers.length + rankedPerks.length;
        return <section className={`tier-list-row${dropTier === tier ? " drop-target" : ""}`} data-tier={tier} key={tier} aria-label={`Tier ${tier}`}
          onDragOver={(event) => { if (dragged.current?.kind === kind) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTier(tier); } }}
          onDragLeave={() => setDropTier(null)}
          onDrop={(event) => { event.preventDefault(); const source = dragged.current; if (source?.kind === kind) move(source.id, tier); endDrag(); }}>
          <header><strong>{tier}</strong><small>{count} {kind === "killers" ? `tueur${count > 1 ? "s" : ""}` : `perk${count > 1 ? "s" : ""}`}</small></header>
          <div className="tier-list-killers" role="list">
            {rankedKillers.map((candidate) => <TierCard key={candidate.id} name={candidate.name.fr ?? candidate.name.en ?? candidate.id} image={killerPortraitUrl(candidate)} selected={selectedId === candidate.id} onSelect={() => setSelectedId(candidate.id)} onDragStart={(event) => startDrag(event, candidate.id)} onDragEnd={endDrag} />)}
            {rankedPerks.map((candidate) => <TierCard key={candidate.perk.id} name={candidate.name} image={perkIconUrl(candidate.perk)} perk selected={selectedId === candidate.perk.id} onSelect={() => setSelectedId(candidate.perk.id)} onDragStart={(event) => startDrag(event, candidate.perk.id)} onDragEnd={endDrag} />)}
          </div>
        </section>;
      })}
    </section>
    {selected && <aside className="analyzer-panel tier-list-inspector" tabIndex={0} aria-label={killer ? "Détails du tueur" : "Détails de la perk"}>
      <header><h2>{selected.name.fr ?? selected.name.en ?? selected.id}</h2><button type="button" className="manager-icon-button" aria-label="Fermer les détails" onClick={() => setSelectedId(null)}>×</button></header>
      <img className={perk ? "tier-inspector-perk" : "tier-inspector-portrait"} src={(killer ? killerPortraitUrl(killer) : perk ? perkIconUrl(perk) : null) ?? undefined} alt="" />
      <label className="tier-list-choice">Tier<select aria-label="Tier de la sélection" value={selectedTier} onChange={(event) => move(selected.id, event.target.value as KillerTier)}>{KILLER_TIERS.map((tier) => <option value={tier} key={tier}>{tier}</option>)}</select></label>
      {killer && <>
        <dl className="tier-killer-facts"><div><dt>Vitesse</dt><dd>{killer.speed} m/s</dd></div><div><dt>Rayon de terreur</dt><dd>{killer.terrorRadius} m</dd></div><div><dt>Taille</dt><dd>{sizeLabels[killer.size]}</dd></div><div><dt>Difficulté</dt><dd>{difficultyLabels[killer.difficulty]}</dd></div></dl>
        <h3>Pouvoir</h3><p className="tier-killer-power">{killerPowerDescription(killer)}</p>
      </>}
      {perk && entry && <>
        <p className="tier-perk-owner">{owner?.name.fr ?? owner?.name.en ?? "Perk générale"}</p>
        <h3>Catégories</h3><div className="badge-row details-badges">{perk.categories.length ? perk.categories.map((category) => <span className="badge" key={category}>{categoryLabels[category]}</span>) : "Aucune catégorie renseignée."}</div>
        <h3>Description{descriptionOverrides[perk.id] ? " personnalisée" : ""}</h3><RichDescription description={perk.description.fr ?? perk.description.en} editableHtml={descriptionOverrides[perk.id] ?? perk.nativeDescriptionHtml ?? null} />
        <PerkStatusDefinitions perk={perk} descriptionHtml={descriptionOverrides[perk.id] ?? perk.nativeDescriptionHtml ?? null} />
        <h3>Évaluation</h3><p>{entry.customized ? `Votre tier : ${entry.tier}. Proposition initiale : ${entry.baseTier ?? "à évaluer"}.` : `Tier proposé : ${entry.tier}.`}</p>{entry.reason && <p>{entry.reason}</p>}
      </>}
    </aside>}
  </main>;
}

function TierCard({ name, image, perk = false, selected, onSelect, onDragStart, onDragEnd }: {
  name: string; image: string | null; perk?: boolean; selected: boolean;
  onSelect: () => void; onDragStart: (event: DragEvent<HTMLButtonElement>) => void; onDragEnd: () => void;
}) {
  const content = image ? <img src={image} alt="" loading="lazy" draggable={false} /> : <span>{name}</span>;
  return <article className={`tier-list-killer${perk ? " tier-list-perk" : ""}${selected ? " selected" : ""}`} role="listitem" title={name} data-name={name}><button type="button" draggable onClick={onSelect} onDragStart={onDragStart} onDragEnd={onDragEnd} aria-label={`Détails de ${name}`} aria-pressed={selected}>{perk ? <span className="tier-list-perk-icon">{content}</span> : content}</button></article>;
}
