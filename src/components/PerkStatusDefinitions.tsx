import type { Perk } from "../domain/perk.js";
import { perkStatusDefinitions } from "../services/perk-status-definitions.js";

export function PerkStatusDefinitions({ perk, descriptionHtml }: { perk: Perk; descriptionHtml?: string | null }) {
  const definitions = perkStatusDefinitions(perk, descriptionHtml ?? undefined);
  if (!definitions.length) return null;
  return <section className="perk-status-definitions" aria-label="Définition des termes de la perk">
    <dl>{definitions.map(({ term, definition }) => <div key={term} data-term={term}><dt>{term}</dt><dd>{definition}</dd></div>)}</dl>
  </section>;
}
