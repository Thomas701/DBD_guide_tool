import { useMemo } from "react";
import { killers, survivors, perks } from "../../app/catalog.js";
import { killerPortraitUrl, perkIconUrl } from "../../app/assets.js";
import { groupMatches, observedKillRate, type AnalysisAsset, type AnalysisRow, type AnalyzedMatch } from "../../services/statistics-analysis.js";

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/theater/g, "theatre").replace(/raccoon/g, "racoon");
const perkNames = new Map(perks.flatMap(perk => [perk.name.en, perk.name.fr, perk.icon?.split("/").at(-1)?.replace(/\.[^.]+$/, "")].filter((name): name is string => Boolean(name)).map(name => [normalize(name), perk] as const)));
const characterNames = new Map([...killers, ...survivors].flatMap(character => [character.name.en, character.name.fr].filter((name): name is string => Boolean(name)).map(name => [normalize(name), character] as const)));
const localImages = import.meta.glob("../../../DBDImages-main/DBDImages-main/images/{maps,items,offerings}/**/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const imagesByName = new Map(Object.entries(localImages).map(([path, url]) => [normalize(path.split("/").at(-1)!.replace(/\.[^.]+$/, "")), url]));
const perkFor = (label: string, url: string | null) => perkNames.get(normalize(label)) ?? perkNames.get(normalize(url?.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? ""));

export function statisticsCharacterPortrait(label: string, url: string | null): string | null {
  const character = characterNames.get(normalize(label));
  return (character && killerPortraitUrl(character)) || url;
}

export function statisticsImage(url: string | null, label: string): string | null {
  if (/\/characters\//i.test(url ?? "")) {
    return statisticsCharacterPortrait(label, url);
  }
  if (/\/perks\//i.test(url ?? "")) {
    const perk = perkFor(label, url);
    if (perk) return perkIconUrl(perk) ?? url;
  }
  return imagesByName.get(normalize(label)) ?? url;
}
const percent = (value: number | null) => value === null ? "—" : `${new Intl.NumberFormat("fr", { maximumFractionDigits: 1 }).format(value * 100)} %`;

export function assetLabel(asset: AnalysisAsset): string {
  if (asset.assets) return asset.assets.map(assetLabel).join(" · ");
  return perkFor(asset.label, asset.image)?.name.fr ?? asset.label;
}

export function StatisticsAssets({ asset, compact = false }: { asset: AnalysisAsset; compact?: boolean }) {
  if (!asset.assets && !asset.image) return null;
  const assets = asset.assets ?? [asset];
  return <div className={`sd-assets${compact ? " compact" : ""}`}>{assets.map(icon => {
    const label = assetLabel(icon);
    const kind = icon.key.includes("/perks/") ? "perk" : icon.key.includes("/offerings/") ? "offering" : /\/(items|add-ons|characterclasses)\//.test(icon.key) ? "item" : "portrait";
    const image = statisticsImage(icon.image, icon.label);
    return <div className="sd-asset" key={icon.key} title={label}><span className={`sd-asset-icon ${kind}`}>{image && <img src={image} alt="" loading="lazy" />}</span>{(!compact || assets.length > 1) && <span className="sd-asset-name">{label}</span>}</div>;
  })}</div>;
}

export function StatisticsRankings({ matches }: { matches: readonly AnalyzedMatch[] }) {
  const data = useMemo(() => {
    const survivor = matches.filter(match => match.entry.role === "survivor");
    const killer = matches.filter(match => match.entry.role === "killer");
    return {
      survivors: groupMatches(survivor, "character"), killers: groupMatches(killer, "character"),
      maps: groupMatches(matches, "map"), survivorBuilds: groupMatches(survivor, "build"), killerBuilds: groupMatches(killer, "build"),
      opponents: groupMatches(survivor, "opponent").filter(row => row.summary.escapeRate !== null),
      teammates: groupMatches(survivor, "teammate").filter(row => row.summary.escapeRate !== null),
      survivorMaps: groupMatches(survivor, "map").filter(row => row.summary.escapeRate !== null),
      killerMaps: groupMatches(killer, "map").filter(row => row.summary.killRate !== null),
    };
  }, [matches]);
  const mapMetrics: RankingMetric[] = [];
  if (data.survivors.length) mapMetrics.push("escape");
  if (data.killers.length) mapMetrics.push("kill");
  const rated = (rows: readonly AnalysisRow[], metric: "escapeRate" | "killRate", descending: boolean) => [...rows].sort((a, b) => (descending ? 1 : -1) * ((b.summary[metric] ?? 0) - (a.summary[metric] ?? 0)) || b.summary.count - a.summary.count);
  return <div className="sd-rankings">
    <div className="sd-two-columns">{data.survivors.length > 0 && <Ranking title="Survivants préférés" description="Vos trois survivants les plus joués." rows={data.survivors} metric="escape" />}{data.killers.length > 0 && <Ranking title="Tueurs préférés" description="Vos trois tueurs les plus joués." rows={data.killers} metric="kill" />}</div>
    <div className="sd-two-columns">
      <Ranking title="Cartes les plus jouées" rows={data.maps} metrics={mapMetrics} map />
      <Ranking title="Cartes les moins jouées" rows={data.maps.slice(-3).reverse()} metrics={mapMetrics} map />
    </div>
    <div className="sd-two-columns">{data.survivors.length > 0 && <Ranking title="Builds survivant préférés" description="Vos trois combinaisons de quatre compétences les plus jouées." rows={data.survivorBuilds} metric="escape" build />}{data.killers.length > 0 && <Ranking title="Builds tueur préférés" description="Vos trois combinaisons de quatre compétences les plus jouées." rows={data.killerBuilds} metric="kill" build />}</div>
    <div className="sd-two-columns">{data.survivors.length > 0 && <Ranking title="Tueurs les plus craints" description="Les tueurs contre lesquels vous vous échappez le moins souvent." rows={rated(data.opponents, "escapeRate", false)} metric="escape" />}{data.survivors.length > 0 && <Ranking title="Tueurs les moins craints" description="Les tueurs contre lesquels vous vous échappez le plus souvent." rows={rated(data.opponents, "escapeRate", true)} metric="escape" />}</div>
    {data.survivors.length > 0 && <div className="sd-two-columns">
      <Ranking title="Meilleurs amis" description="Vos taux d’évasion les plus élevés avec des coéquipiers identifiés." rows={rated(data.teammates, "escapeRate", true)} metric="escape" />
      <Ranking title="Pires amis" description="Vos taux d’évasion les plus faibles avec des coéquipiers identifiés." rows={rated(data.teammates, "escapeRate", false)} metric="escape" />
    </div>}
    <div className="sd-two-columns">{data.survivors.length > 0 && <Ranking title="Survivant · cartes appréciées" description="Les cartes avec votre meilleur taux d’évasion." rows={rated(data.survivorMaps, "escapeRate", true)} metric="escape" map />}{data.survivors.length > 0 && <Ranking title="Survivant · cartes détestées" description="Les cartes avec votre plus faible taux d’évasion." rows={rated(data.survivorMaps, "escapeRate", false)} metric="escape" map />}</div>
    <div className="sd-two-columns">{data.killers.length > 0 && <Ranking title="Tueur · cartes appréciées" description="Les cartes avec votre meilleur taux de kill." rows={rated(data.killerMaps, "killRate", true)} metric="kill" map />}{data.killers.length > 0 && <Ranking title="Tueur · cartes détestées" description="Les cartes avec votre plus faible taux de kill." rows={rated(data.killerMaps, "killRate", false)} metric="kill" map />}</div>
    <p className="sd-footnote">Tous les classements suivent les filtres principaux. Les petits échantillons sont signalés ; les taux inconnus sont exclus des classements par résultat.</p>
  </div>;
}

type RankingMetric = "escape" | "kill";

function Ranking({ title, description, rows, metric, metrics = metric ? [metric] : [], build = false, map = false }: { title: string; description?: string; rows: readonly AnalysisRow[]; metric?: RankingMetric; metrics?: readonly RankingMetric[]; build?: boolean; map?: boolean }) {
  const tone = metric === "kill" ? "red" : metric === "escape" ? "teal" : "gold";
  return <section className={`sd-panel sd-ranking-panel sd-tone-${tone}`}>
    <header className="sd-panel-header"><div><h3>{title}</h3>{description && <p>{description}</p>}</div><span className="sd-ranking-badge">TOP 3</span></header>
    <ol className="sd-ranking-list">
      {rows.slice(0, 3).map((row, index) => {
        const image = build ? null : map ? statisticsImage(row.image, row.label) : statisticsCharacterPortrait(row.label, row.image);
        const opponentKillRate = map && metric === "escape" ? observedKillRate(row.matches) : null;
        return <li key={row.key}>
          <span className="sd-ranking-number">{String(index + 1).padStart(2, "0")}</span>
          <div className="sd-ranking-identity">
            {build ? <StatisticsAssets asset={row} /> : <>
              {image && <img className={map ? "map" : ""} src={image} alt="" loading="lazy" />}
              <strong title={row.label}>{row.label}</strong>
            </>}
          </div>
          <span className="sd-ranking-count">{row.summary.count} partie{row.summary.count > 1 ? "s" : ""}</span>
          <div className="sd-ranking-rates">{metrics.map(rate => <strong key={rate} className={rate === "escape" ? "sd-tone-teal" : "sd-tone-red"}>
            {percent(rate === "escape" ? row.summary.escapeRate : row.summary.killRate)} <small>{rate === "escape" ? "Évasion" : "Kills"}</small>
          </strong>)}</div>
          {(opponentKillRate !== null || row.summary.count < 5) && <div className="sd-ranking-notes">
            {opponentKillRate !== null && <p className="sd-footnote">Kills du tueur adverse : {percent(opponentKillRate)} des survivants, équipes complètes uniquement.</p>}
            {row.summary.count < 5 && <span className="sd-small-sample">Petit échantillon</span>}
          </div>}
        </li>;
      })}
    </ol>
    {!rows.length && <p className="sd-no-data">Pas assez de données renseignées dans cette sélection.</p>}
  </section>;
}
