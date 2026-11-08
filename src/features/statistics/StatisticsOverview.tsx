import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { analyzeMatches, assetKey, dimensionAssets, encounterCounts, groupMatches, localDay, parisHour, ratio, summarizeMatches, summarizeObservedSurvival, validNumber, type AnalysisDimension, type AnalysisRow, type AnalysisSummary, type AnalyzedMatch } from "../../services/statistics-analysis.js";
import type { MatchHistoryEntry } from "../../services/statistics.js";
import { StatisticsAssets, StatisticsRankings, assetLabel } from "./StatisticsRankings.js";
import "./statistics-overview.css";

const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const format = (value: number | null) => value === null ? "—" : number.format(value);
const percent = (value: number | null) => value === null ? "—" : `${decimal.format(value * 100)} %`;
const time = (value: number | null) => value === null ? "—" : `${Math.floor(Math.round(value) / 60)}:${String(Math.round(value) % 60).padStart(2, "0")}`;
const dayFormatter = new Intl.DateTimeFormat("fr", { timeZone: "Europe/Paris", day: "numeric", month: "short" });
const day = (value: number) => dayFormatter.format(value);
const hourLabel = (value: number) => `${value} h`;
const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DIMENSIONS: [AnalysisDimension, string][] = [["character", "Mes personnages"], ["map", "Cartes"], ["opponent", "Adversaires"], ["matchup", "Adversaire × carte"], ["build", "Builds complets"], ["perk", "Mes compétences"], ["pair", "Duos de compétences"], ["trio", "Trios de compétences"], ["item", "Objets et pouvoirs"], ["addon", "Accessoires"], ["addonPair", "Duos d’accessoires"], ["offering", "Offrandes"], ["class", "Classes et rôles"], ["enemyPerk", "Compétences adverses"], ["teamPerk", "Compétences des équipiers"], ["composition", "Objets de l’équipe"], ["duplicates", "Doublons dans l’équipe"], ["equipment", "Avec / sans objet"], ["disconnect", "Déconnexions"], ["weekday", "Jour de la semaine"], ["hour", "Heure de jeu"], ["session", "Position dans la session"], ["result", "Résultats détaillés"]];

export function StatisticsOverview({ matches, syncing }: { matches: readonly MatchHistoryEntry[]; syncing: boolean }) {
  const [range, setRange] = useState("all");
  const [role, setRole] = useState("all");
  const [queue, setQueue] = useState("all");
  const [map, setMap] = useState("all");
  const [character, setCharacter] = useState("all");
  const [opponent, setOpponent] = useState("all");
  const [perk, setPerk] = useState("all");
  const [dimension, setDimension] = useState<AnalysisDimension>("character");
  const analyzed = useMemo(() => analyzeMatches(matches), [matches]);
  const periodMatches = useMemo(() => {
    const cutoff = range === "all" ? null : Date.now() - Number(range) * 86_400_000;
    return analyzed.filter(match => cutoff === null || (match.at !== null && match.at >= cutoff));
  }, [analyzed, range]);
  const filtered = useMemo(() => periodMatches.filter(m => (role === "all" || m.entry.role === role) && (queue === "all" || (m.entry.queueLabel ?? "1v4") === queue) && (map === "all" || m.entry.mapName === map) && (character === "all" || `${m.entry.role}:${m.entry.characterName}` === character) && (opponent === "all" || m.opponents.some(o => o.key === opponent)) && (perk === "all" || m.perks.some(p => p.key === perk))), [periodMatches, role, queue, map, character, opponent, perk]);
  const summary = useMemo(() => summarizeMatches(filtered), [filtered]);
  const characters = useMemo(() => groupMatches(analyzed, "character"), [analyzed]);
  const maps = useMemo(() => groupMatches(analyzed, "map"), [analyzed]);
  const opponents = useMemo(() => groupMatches(analyzed, "opponent"), [analyzed]);
  const perks = useMemo(() => groupMatches(analyzed, "perk"), [analyzed]);
  const active = range !== "all" || role !== "all" || queue !== "all" || map !== "all" || character !== "all" || opponent !== "all" || perk !== "all";
  const reset = () => { setRange("all"); setRole("all"); setQueue("all"); setMap("all"); setCharacter("all"); setOpponent("all"); setPerk("all"); };

  return <div className="stats-dashboard">
    <section className="sd-filterbar" aria-label="Filtres de la vue d’ensemble"><div className="sd-filter-scope"><strong>Filtres globaux</strong><span>Ils s’appliquent à toutes les sections ci-dessous.</span></div>
      <div className="sd-filter-top"><div className="sd-segments" role="group" aria-label="Camp analysé">{[["all", "Tous les camps"], ["killer", "Tueur"], ["survivor", "Survivant"]].map(([value, label]) => <button type="button" key={value} aria-pressed={role === value} onClick={() => setRole(value!)}>{label}</button>)}</div><div className="sd-range" role="group" aria-label="Période analysée">{[["7", "7 jours"], ["30", "30 jours"], ["90", "90 jours"], ["all", "Tout"]].map(([value, label]) => <button type="button" key={value} aria-pressed={range === value} onClick={() => setRange(value!)}>{label}</button>)}</div></div>
      <div className="sd-filter-bottom"><Select label="Mode" value={queue} onChange={setQueue}><option value="all">Tous les modes</option><option value="1v4">1 contre 4</option><option value="2v8">2 contre 8</option>{[...new Set(analyzed.map(m => m.entry.queueLabel).filter((q): q is string => !!q && q !== "1v4" && q !== "2v8"))].map(q => <option key={q}>{q}</option>)}</Select><Select label="Carte" value={map} onChange={setMap}><option value="all">Toutes les cartes</option>{maps.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</Select><Select label="Mon personnage" value={character} onChange={setCharacter}><option value="all">Tous les personnages</option>{characters.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</Select><Select label="Adversaire" value={opponent} onChange={setOpponent}><option value="all">Tous les adversaires</option>{opponents.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</Select><Select label="Compétence jouée" value={perk} onChange={setPerk}><option value="all">Toutes les compétences</option>{perks.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}</Select><button className="sd-reset" type="button" disabled={!active} onClick={reset}>Réinitialiser</button></div>
      <div className="sd-filter-caption" aria-live="polite"><strong>{format(filtered.length)}</strong> parties analysées sur {format(matches.length)}{summary.firstAt !== null && <> <span>·</span> {day(summary.firstAt)} — {day(summary.lastAt!)}</>}</div>
    </section>
    <section className="sd-hero" aria-label="Votre historique en un regard">
      <div className="sd-hero-copy"><span className="sd-kicker"><span className="sd-live-dot" /> VOTRE PARCOURS DANS LA BRUME</span><h2>Vos parties,<br /><em>en perspective.</em></h2><p>Explorez vos résultats, vos builds et votre progression à partir de votre historique.</p><div className="sd-hero-meta"><strong>{format(filtered.length)} parties sélectionnées</strong></div></div>
      <div className="sd-hero-mark" aria-hidden="true"><i /><i /><i /><i /><b /></div>
      <div className="sd-lifetime"><span className="sd-kicker">VOTRE SÉLECTION · DONNÉES ARCHIVÉES</span><div><Lifetime label="Heures en match" value={summary.durationSamples ? `${decimal.format(summary.totalTime / 3600)} h` : "—"} /><Lifetime label="Parties jouées" value={format(summary.count)} /><Lifetime label="Score cumulé" value={summary.scoreSamples ? format(summary.scoreTotal) : "—"} /></div><small>Somme des durées et scores enregistrés dans les filtres actuels. Les bonus de points de sang ne sont pas inclus.</small></div>
    </section>



    {filtered.length === 0 ? <div className="sd-empty-state"><span aria-hidden="true">◌</span><h3>{syncing ? "La brume se dissipe…" : matches.length ? "Aucune partie sur cette sélection" : "Votre histoire commence ici"}</h3><p>{syncing ? "Le tableau de bord se remplira à mesure de la synchronisation." : matches.length ? "Élargissez la période ou réinitialisez les filtres pour retrouver vos parties." : "Synchronisez votre historique pour découvrir vos statistiques."}</p>{active && <button className="secondary-button" type="button" onClick={reset}>Afficher tout l’historique</button>}</div> : <>
      <div className="sd-kpis">
        <Kpi label="Évasions" value={percent(summary.escapeRate)} note={`${summary.escapeCount} évasions / ${summary.escapeSamples} issues connues`} tone="teal"><MiniBars matches={filtered.filter(m => m.entry.role === "survivor")} /></Kpi>
        <Kpi label="Taux de kill" value={percent(summary.killRate)} note={`${summary.deaths} kills / ${summary.killSamples} survivants · matchs complets`} tone="red"><MiniBars matches={filtered.filter(m => m.entry.role === "killer")} /></Kpi>
        <Kpi label="Score moyen" value={format(summary.score)} note={`Médiane ${format(summary.scoreMedian)} · ${summary.scoreSamples} scores`} tone="gold"><MiniBars matches={filtered} score /></Kpi>
        <Kpi label="Temps en match" value={summary.durationSamples ? `${decimal.format(summary.totalTime / 3600)} h` : "—"} note={`${time(summary.duration)} en moyenne · ${summary.durationSamples} durées`} tone="purple"><MiniBars matches={filtered} duration /></Kpi>
      </div>

      <nav className="sd-jumpnav" aria-label="Explorer les statistiques"><a href="#sd-performance">Performances</a><a href="#sd-world">Vos classements</a><a href="#sd-encounters">Rencontres</a><a href="#sd-explorer">Builds & comparaisons</a><a href="#sd-activity">Habitudes</a><a href="#sd-emblems">Emblèmes</a></nav>

      <SectionTitle id="sd-performance" eyebrow="01 / VOS RÉSULTATS" title="Au-delà de la victoire." text="Des indicateurs distincts pour chaque camp, avec leur nombre de parties exploitables." />
      <div className={"sd-results-grid" + (summary.survivorCount && summary.killerCount ? "" : " single")}>
        {summary.survivorCount > 0 && <Panel title="Survivant" subtitle={`${summary.survivorCount} parties`} tone="teal"><div className="sd-result-main"><Donut value={summary.escapeRate} label="d’évasion" tone="teal" /><div className="sd-result-stats"><Metric label="Évasions" value={format(summary.outcomes.escaped)} /><Metric label="Morts" value={format(summary.outcomes.dead)} /><Metric label="Déconnexions" value={format(summary.outcomes.disconnected)} /><Metric label="Issues inconnues" value={format(summary.outcomes.unknown)} /></div></div><Histogram labels={filtered.some(m => m.entry.queueLabel === "2v8") ? Array.from({ length: 9 }, (_, i) => `${i}E`) : ["0E", "1E", "2E", "3E", "4E"]} values={summary.escapeDistribution} tone="teal" /><p className="sd-footnote">Survivants échappés par partie · {filtered.filter(m => m.entry.role === "survivor" && m.complete).length} équipes complètes</p><div className="sd-stat-pair"><Metric label="Échappés / équipe" value={decimalValue(summary.teamEscapes)} /><Metric label="Seul à s’échapper" value={percent(summary.soleEscapeRate)} /></div></Panel>}
        {summary.killerCount > 0 && <Panel title="Tueur" subtitle={`${summary.killerCount} parties`} tone="red"><div className="sd-result-main"><Donut value={summary.killRate} label="de kills" tone="red" /><div className="sd-result-stats"><Metric label="Kills / match" value={decimalValue(summary.averageKills)} /><Metric label="Sans évasion" value={percent(summary.perfectRate)} /><Metric label="Réussite 3K+ · 1v4" value={percent(summary.winRate)} /><Metric label="Matchs 1v4 exploitables" value={format(summary.winSamples)} /></div></div><Histogram labels={filtered.some(m => m.entry.queueLabel === "2v8") ? Array.from({ length: 9 }, (_, i) => `${i}K`) : ["0K", "1K", "2K", "3K", "4K"]} values={summary.killDistribution} tone="red" /><p className="sd-footnote">Kills par partie · {summary.perfectSamples} matchs complets · déconnexions exclues</p><div className="sd-stat-pair"><Metric label="Premier kill" value={time(summary.firstDeath)} /><Metric label="Intervalle entre kills" value={time(summary.deathInterval)} /></div></Panel>}
      </div>

      <StreakPanel matches={periodMatches} role={role} />

      <div className="sd-two-columns">
        <ScorePanel summary={summary} />
        <OutcomePanel matches={filtered} summary={summary} />
      </div>

      <SectionTitle id="sd-world" eyebrow="02 / VOS CLASSEMENTS" title="Vos repères dans la brume." text="Vos favoris, vos meilleures confrontations et vos terrains les plus difficiles. Tous suivent les filtres du haut de page." />
      <StatisticsRankings matches={filtered} />
      <SectionTitle id="sd-encounters" eyebrow="03 / VOS RENCONTRES" title="Qui croise votre chemin ?" text="Quatre répartitions pour lire les personnages, les terrains et les compétences rencontrés." />
      <EncounterCharts matches={filtered} />

      <SectionTitle id="sd-explorer" eyebrow="04 / L’EXPLORATEUR" title="Croisez. Comparez. Comprenez." text="Personnages, compétences, accessoires, confrontations : chaque ligne ouvre son analyse détaillée." />
      <Explorer matches={filtered} dimension={dimension} onDimensionChange={setDimension} />

      <SectionTitle id="sd-activity" eyebrow="05 / VOS HABITUDES" title="Le temps passé dans la brume." text="Votre activité en heure de Paris, limitée à l’historique sélectionné." />
      <Activity matches={filtered} summary={summary} />

      <SectionTitle id="sd-emblems" eyebrow="06 / EMBLÈMES" title="La manière compte aussi." text="Les qualités d’emblème donnent une autre lecture de vos performances." />
      <Emblems matches={filtered} />
      <details className="sd-method"><summary>Comprendre les chiffres et leur couverture <span>↗</span></summary><div><p>Chaque indicateur utilise uniquement les données nécessaires à son calcul. Un champ absent apparaît « — », jamais comme un zéro. Les déconnexions sont suivies séparément des morts. Les résultats tueur demandent les issues connues de tous les survivants ; les classements demandent tous les scores de l’équipe.</p><p>En 1v4 et Lights Out, une victoire tueur signifie trois ou quatre kills. En 2v8, les kills sont ceux de l’équipe des tueurs ; elles ne sont pas attribuables à un tueur individuel. L’ordre des morts et les délais sont déduits des durées individuelles disponibles, sans télémétrie de poursuite.</p><p>Les sessions sont estimées avec une pause maximale de 45 minutes entre la fin d’un match et le début estimé du suivant. Les horaires importés peuvent dépendre du fuseau de la source. Les groupes avec peu de parties portent une mention « petit échantillon ». Les comparaisons montrent des associations, pas l’effet causal d’une compétence.</p><p>Non mesurables avec cette source : poursuites, réparations, soins, décrochages, mises au crochet, activations des compétences, bonus réellement crédités, groupe d’amis et MMR officiel. Les comparaisons avant/après une mise à jour demandent ses dates ; aucune donnée n’est inventée.</p></div></details>
    </>}
  </div>;
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) { return <label className="sd-select"><span>{label}</span><select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{children}</select></label>; }
function Lifetime({ label, value }: { label: string; value: string | undefined }) { return <div><strong>{value ?? "—"}</strong><span>{label}</span></div>; }
function SectionTitle({ id, eyebrow, title, text }: { id: string; eyebrow: string; title: string; text: string }) { return <header id={id} className="sd-section-title"><span className="sd-kicker">{eyebrow}</span><h2>{title}</h2><p>{text}</p></header>; }
function Panel({ title, subtitle, tone, className = "", children }: { title: string; subtitle?: string; tone?: string; className?: string; children: ReactNode }) { return <article className={`sd-panel${tone ? ` sd-tone-${tone}` : ""} ${className}`}><header className="sd-panel-header"><h3>{title}</h3>{subtitle && <span>{subtitle}</span>}</header>{children}</article>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="sd-metric"><span>{label}</span><strong>{value}</strong></div>; }
function Kpi({ label, value, note, tone, children }: { label: string; value: string; note: string; tone: string; children: ReactNode }) { return <article className={`sd-kpi sd-tone-${tone}`}><span className="sd-kpi-label"><i />{label}</span><strong>{value}</strong><p>{note}</p>{children}</article>; }
function MiniBars({ matches, score, duration }: { matches: readonly AnalyzedMatch[]; score?: boolean; duration?: boolean }) { const values = matches.slice(-24).map(m => score ? m.entry.score : duration ? m.duration : m.entry.role === "survivor" ? m.outcome === "escaped" ? 1 : m.outcome === "dead" ? 0 : null : m.killRate); const max = Math.max(1, ...values.filter(validNumber)); return <div className="sd-minibars" aria-hidden="true">{values.map((value, i) => <i key={i} style={{ height: `${value === null ? 5 : Math.max(7, value / max * 100)}%`, opacity: value === null ? .2 : .45 + i / Math.max(1, values.length) * .55 }} />)}</div>; }
function Donut({ value, label, tone }: { value: number | null; label: string; tone: string }) { return <div className={`sd-donut sd-tone-${tone}`}><svg viewBox="0 0 140 140" role="img" aria-label={`${value === null ? "Non disponible" : percent(value)} ${label}`}><circle cx="70" cy="70" r="57" className="sd-donut-track" /><circle cx="70" cy="70" r="57" className="sd-donut-value" pathLength="100" strokeDasharray={`${(value ?? 0) * 100} 100`} transform="rotate(-90 70 70)" /></svg><span><strong>{percent(value)}</strong><small>{label}</small></span></div>; }
function Histogram({ labels, values, tone }: { labels: readonly string[]; values: readonly number[]; tone: string }) { const max = Math.max(1, ...values.slice(0, labels.length)); return <div className={`sd-histogram sd-tone-${tone}`} role="img" aria-label={labels.map((label, i) => `${label} : ${values[i] ?? 0}`).join(", ")}>{labels.map((label, i) => <div key={`${i}-${label}`}><strong>{values[i] ?? 0}</strong><div><i style={{ height: `${(values[i] ?? 0) / max * 100}%` }} /></div><span>{label}</span></div>)}</div>; }
function decimalValue(value: number | null) { return value === null ? "—" : decimal.format(value); }

function Explorer({ matches, dimension, onDimensionChange }: { matches: readonly AnalyzedMatch[]; dimension: AnalysisDimension; onDimensionChange: (value: AnalysisDimension) => void }) {
  const [comparisonRole, setComparisonRole] = useState("survivor");
  const selectedRole = matches.some(match => match.entry.role === comparisonRole) ? comparisonRole : matches.find(match => match.entry.role !== "unknown")?.entry.role ?? "survivor";
  const scoped = useMemo(() => matches.filter(match => match.entry.role === selectedRole), [matches, selectedRole]);
  const [search, setSearch] = useState("");
  const [minimum, setMinimum] = useState(1);
  const [sort, setSort] = useState("count");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { setPage(1); setSelected(null); }, [dimension, search, minimum, sort, selectedRole]);
  const rows = useMemo(() => groupMatches(scoped, dimension), [scoped, dimension]);
  const visible = useMemo(() => rows.filter(row => row.summary.count >= minimum && (assetLabel(row) + " " + row.label).toLocaleLowerCase("fr").includes(search.toLocaleLowerCase("fr"))).sort((a, b) => {
    const value = (summary: AnalysisSummary) => sort === "rate" ? selectedRole === "killer" ? summary.killRate : summary.escapeRate : sort === "score" ? summary.score : summary.count;
    return (value(b.summary) ?? -1) - (value(a.summary) ?? -1) || b.summary.count - a.summary.count;
  }), [rows, minimum, search, sort, selectedRole]);
  const pages = Math.max(1, Math.ceil(visible.length / 10));
  const currentPage = Math.min(page, pages);
  const chosen = visible.find(row => row.key === selected);
  const showScore = visible.some(row => row.summary.score !== null);
  const showDuration = visible.some(row => row.summary.duration !== null);
  const categories: [string, AnalysisDimension[]][] = [["Personnages & cartes", ["character", "map", "opponent", "matchup", "result"]], ["Builds & compétences", ["build", "perk", "pair", "trio"]], ["Équipement", ["item", "addon", "addonPair", "offering", "class", "equipment"]], ["Équipes & adversaires", ["enemyPerk", "teamPerk", "composition", "duplicates", "disconnect"]], ["Habitudes", ["weekday", "hour", "session"]]];
  return <div className="sd-explorer">
    <div className="sd-comparison-scope"><Select label="Camp des comparaisons" value={selectedRole} onChange={setComparisonRole}><option value="survivor" disabled={!matches.some(match => match.entry.role === "survivor")}>Survivant</option><option value="killer" disabled={!matches.some(match => match.entry.role === "killer")}>Tueur</option></Select><p>Chaque ligne décrit vos résultats dans le camp choisi. Dix lignes par page.</p></div>
    <div className="sd-explorer-tabs" role="group" aria-label="Famille de comparaison">{categories.map(([label, dimensions]) => <button type="button" key={label} aria-pressed={dimensions.includes(dimension)} onClick={() => onDimensionChange(dimensions[0]!)}>{label}</button>)}</div>
    <div className="sd-explorer-toolbar"><Select label="Comparer par" value={dimension} onChange={value => onDimensionChange(value as AnalysisDimension)}>{DIMENSIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><label className="sd-select"><span>Rechercher</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Un nom, une compétence…" /></label><Select label="Minimum de matchs" value={String(minimum)} onChange={value => setMinimum(Number(value))}><option value="1">Tous les échantillons</option><option value="5">5 matchs et plus</option><option value="10">10 matchs et plus</option><option value="25">25 matchs et plus</option></Select><Select label="Trier par" value={sort} onChange={setSort}><option value="count">Nombre de parties</option><option value="rate">{selectedRole === "killer" ? "Taux de kill" : "Taux d’évasion"}</option><option value="score">Score moyen</option></Select></div>
    <div className="sd-table-scroll"><table className="sd-table"><thead><tr><th scope="col">{DIMENSIONS.find(([value]) => value === dimension)?.[1]}</th><th scope="col">Parties</th><th scope="col">{selectedRole === "killer" ? "Taux de kill" : "Taux d’évasion"}</th>{showScore && <th scope="col">Score moyen</th>}{showDuration && <th scope="col">Durée moyenne</th>}<th scope="col">Détails</th></tr></thead>
      <tbody>{visible.slice((currentPage - 1) * 10, currentPage * 10).map(row => <tr key={row.key} className={chosen?.key === row.key ? "selected" : ""}><th scope="row"><div className="sd-table-identity"><StatisticsAssets asset={row} compact /><div>{!row.assets && <strong>{assetLabel(row)}</strong>}<small>{row.summary.count < 5 ? "Petit échantillon" : selectedRole === "killer" ? "Parties tueur" : "Parties survivant"}</small></div></div></th><td><strong>{row.summary.count}</strong></td><td><Rate value={selectedRole === "killer" ? row.summary.killRate : row.summary.escapeRate} samples={selectedRole === "killer" ? row.summary.killSamples : row.summary.escapeSamples} tone={selectedRole === "killer" ? "red" : "teal"} /></td>{showScore && <td>{format(row.summary.score)}<small>{row.summary.scoreSamples} scores connus</small></td>}{showDuration && <td>{time(row.summary.duration)}</td>}<td><button type="button" className="sd-row-open" aria-expanded={chosen?.key === row.key} aria-label={"Analyser " + assetLabel(row)} onClick={() => setSelected(chosen?.key === row.key ? null : row.key)}>{chosen?.key === row.key ? "Fermer −" : "Ouvrir ↗"}</button></td></tr>)}</tbody>
    </table></div>
    {visible.length === 0 && <p className="sd-no-data">Aucune donnée pour cette comparaison. Réduisez le minimum de matchs ou changez les filtres.</p>}
    <nav className="sd-pagination" aria-label="Pages du tableau comparatif"><span>{visible.length} résultats · 10 par page</span><div><button type="button" disabled={currentPage === 1} onClick={() => { setPage(currentPage - 1); setSelected(null); }}>← Précédente</button><strong>Page {currentPage} / {pages}</strong><button type="button" disabled={currentPage === pages} onClick={() => { setPage(currentPage + 1); setSelected(null); }}>Suivante →</button></div></nav>
    {chosen && <RowDetails key={selectedRole + ":" + dimension + ":" + chosen.key} row={chosen} rows={rows} all={scoped} dimension={dimension} />}
    <p className="sd-footnote">{selectedRole === "killer" ? "Taux de kill : survivants tués / survivants affrontés, sur les équipes aux résultats complets." : "Taux d’évasion : vos évasions / vos issues connues. Les déconnexions sont comptées séparément."} Les scores et les durées utilisent uniquement les valeurs renseignées.</p>
  </div>;
}

function Rate({ value, samples, tone }: { value: number | null; samples: number; tone: string }) { return <div className={`sd-rate sd-tone-${tone}`}><strong>{percent(value)}</strong><small>{samples} issues</small><div><i style={{ width: `${(value ?? 0) * 100}%` }} /></div></div>; }

function RowDetails({ row, rows, all, dimension }: { row: AnalysisRow; rows: readonly AnalysisRow[]; all: readonly AnalyzedMatch[]; dimension: AnalysisDimension }) {
  const [comparisonKey, setComparisonKey] = useState("other");
  const killer = row.summary.killerCount > 0;
  const comparisonRow = rows.find(candidate => candidate.key === comparisonKey);
  const other = comparisonRow?.summary ?? summarizeMatches(all.filter(match => !dimensionAssets(match, dimension).some(asset => asset.key === row.key)));
  const locations = groupMatches(row.matches, "map").slice(0, 3);
  const summary = row.summary;
  return <section className={"sd-row-details " + (killer ? "sd-tone-red" : "sd-tone-teal")} aria-label={"Analyse détaillée de " + assetLabel(row)}>
    <header className="sd-detail-heading"><div><span className="sd-kicker">REGARD RAPPROCHÉ · {killer ? "TUEUR" : "SURVIVANT"}</span><h3>{assetLabel(row)}</h3><p>{summary.count} parties dans vos filtres actuels{summary.count < 5 ? " · petit échantillon" : ""}</p></div>{row.image && !row.assets && <img src={row.image} alt="" />}</header>
    {row.assets && <StatisticsAssets asset={row} />}
    <div className="sd-detail-columns"><div><h4>Vos résultats</h4>
      {killer ? <><ResultLine label="Taux de kill" value={summary.killRate === null ? null : percent(summary.killRate)} description={summary.deaths + " kills sur " + summary.killSamples + " survivants, résultats complets."} /><ResultLine label="Kills par partie" value={summary.averageKills === null ? null : decimalValue(summary.averageKills)} description="Moyenne sur les parties aux résultats complets." /><ResultLine label="Parties sans évasion" value={summary.perfectRate === null ? null : percent(summary.perfectRate)} description="Toutes les issues des survivants sont des kills." /><ResultLine label="Victoires à 3–4 kills" value={summary.winRate === null ? null : percent(summary.winRate)} description="Parties 1v4 et Lights Out ; les parties 2v8 sont exclues." /></> : <><ResultLine label="Taux d’évasion" value={summary.escapeRate === null ? null : percent(summary.escapeRate)} description={summary.escapeCount + " évasions sur " + summary.escapeSamples + " issues connues."} /><ResultLine label="Survie moyenne" value={summary.survival === null ? null : time(summary.survival)} description={summary.survivalSamples + " durées personnelles renseignées."} /><ResultLine label="Premier au score" value={summary.topScoreRate === null ? null : percent(summary.topScoreRate)} description="Meilleur score parmi les survivants, égalités incluses." /></>}
      <ResultLine label="Score moyen" value={summary.score === null ? null : format(summary.score)} description={"Calculé sur " + summary.scoreSamples + " scores renseignés, hors bonus."} /><ResultLine label="Score record" value={summary.scoreMax === null ? null : format(summary.scoreMax)} description="Votre meilleur score dans cette sélection." /><ResultLine label="Durée moyenne" value={summary.duration === null ? null : time(summary.duration)} description={"Calculée sur " + summary.durationSamples + " durées de partie renseignées."} />
    </div><div><h4>Comparer avec le même camp</h4><Select label="Sélection de comparaison" value={comparisonRow ? comparisonKey : "other"} onChange={setComparisonKey}><option value="other">Toutes les autres parties du même camp</option>{rows.filter(candidate => candidate.key !== row.key).map(candidate => <option key={candidate.key} value={candidate.key}>{assetLabel(candidate)} · {candidate.summary.count} parties</option>)}</Select>
      <Compare label="Cette sélection" summary={summary} /><Compare label={comparisonRow ? assetLabel(comparisonRow) : "Autres parties du même camp"} summary={other} />
      <p className="sd-footnote">Les contextes de jeu et les équipements peuvent différer. Ces chiffres décrivent vos parties ; ils ne prouvent pas l’effet d’une compétence.</p>
    </div></div>
    {locations.length > 0 && <div className="sd-detail-locations"><h4>Terrains les plus joués dans cette sélection</h4>{locations.map(location => <div className="sd-detail-location" key={location.key}>{location.image && <img src={location.image} alt="" loading="lazy" />}<div><strong>{location.label}</strong><span>{location.summary.count} parties</span></div>{(killer ? location.summary.killRate : location.summary.escapeRate) !== null && <strong>{percent(killer ? location.summary.killRate : location.summary.escapeRate)}<small>{killer ? "de kills" : "d’évasion"}</small></strong>}</div>)}</div>}
  </section>;
}

function Compare({ label, summary }: { label: string; summary: AnalysisSummary }) {
  return <div className="sd-comparison-card"><h5>{label}<span>{summary.count} parties</span></h5><ResultLine label="Taux d’évasion" value={summary.escapeRate === null ? null : percent(summary.escapeRate)} /><ResultLine label="Taux de kill" value={summary.killRate === null ? null : percent(summary.killRate)} /><ResultLine label="Score moyen" value={summary.score === null ? null : format(summary.score)} /><ResultLine label="Durée moyenne" value={summary.duration === null ? null : time(summary.duration)} />{summary.count === 0 && <p className="sd-footnote">Aucune partie comparable.</p>}</div>;
}

function Activity({ matches, summary }: { matches: readonly AnalyzedMatch[]; summary: AnalysisSummary }) {
  const dated = matches.filter((m): m is AnalyzedMatch & { at: number } => m.at !== null);
  const counts = new Map<string, number>();
  dated.forEach(m => counts.set(localDay(m.at), (counts.get(localDay(m.at)) ?? 0) + 1));
  const last = summary.lastAt ?? Date.now();
  const lastDate = new Date(`${localDay(last)}T12:00:00Z`);
  const lastWeekday = (lastDate.getUTCDay() + 6) % 7;
  const firstDate = new Date(lastDate);
  firstDate.setUTCDate(lastDate.getUTCDate() - lastWeekday - 11 * 7);
  const cells = Array.from({ length: 84 }, (_, i) => { const date = new Date(firstDate); date.setUTCDate(firstDate.getUTCDate() + i); const key = date.toISOString().slice(0, 10); return { key, at: date.getTime(), count: counts.get(key) ?? 0, future: date > lastDate }; });
  const max = Math.max(1, ...counts.values());
  const hours = Array.from({ length: 24 }, (_, i) => dated.filter(m => parisHour(m.at) === i).length);
  const weekdays = DAYS.map((_, i) => dated.filter(m => { const date = new Date(`${localDay(m.at)}T12:00:00Z`); return (date.getUTCDay() + 6) % 7 === i; }).length);
  const weekly = new Map<string, number>();
  dated.forEach(m => { const d = new Date(`${localDay(m.at)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); const key = d.toISOString().slice(0, 10); weekly.set(key, (weekly.get(key) ?? 0) + 1); });
  const monthly = new Map<string, number>();
  dated.forEach(m => { const key = localDay(m.at).slice(0, 7); monthly.set(key, (monthly.get(key) ?? 0) + 1); });
  const busiest = [...counts].sort((a, b) => b[1] - a[1])[0];
  return <><div className="sd-activity-summary"><Metric label="Jours joués" value={format(summary.activeDays)} /><Metric label="Personnages joués" value={format(summary.characters)} /><Metric label="Matchs / jour actif" value={summary.activeDays ? decimalValue(dated.length / summary.activeDays) : "—"} /><Metric label="Durée médiane" value={time(summary.durationMedian)} /><Metric label="Match le plus court" value={time(summary.shortest)} /><Metric label="Match le plus long" value={time(summary.longest)} /></div><div className="sd-two-columns"><Panel className="sd-calendar-panel" title="Votre calendrier de jeu" subtitle="12 semaines jusqu’au dernier match"><div className="sd-calendar-wrap"><div className="sd-calendar-days">{DAYS.map(label => <span key={label}>{label}</span>)}</div><div className="sd-calendar" role="img" aria-label={`${summary.activeDays} jours actifs dans la sélection. Calendrier des douze dernières semaines.`}>{cells.map(cell => <span key={cell.key} className={cell.future ? "future" : ""} style={{ "--cell-opacity": cell.count ? .2 + cell.count / max * .8 : 0 } as CSSProperties} title={`${day(cell.at)} : ${cell.count} parties`} />)}</div></div><div className="sd-calendar-legend"><span>{day(cells[0]!.at)} — {day(last)}</span><span>Moins <i /><i /><i /><i /> Plus</span></div><div className="sd-stat-pair"><Metric label="Journée la plus jouée" value={busiest ? `${day(Date.parse(`${busiest[0]}T12:00:00Z`))} · ${busiest[1]} matchs` : "—"} /><Metric label="Créneau favori" value={dated.length ? hourLabel(hours.indexOf(Math.max(...hours))) : "—"} /></div></Panel><Panel className="sd-hours-panel" title="Vos heures de prédilection" subtitle="Europe / Paris"><Histogram labels={hours.map((_, i) => i % 4 === 0 ? `${i} h` : "")} values={hours} tone="purple" /><p className="sd-footnote">Répartition des {dated.length} matchs datés par heure.</p><Histogram labels={DAYS} values={weekdays} tone="gold" /></Panel></div><div className="sd-two-columns"><Panel title="Répartition de votre historique" subtitle={`${summary.count} parties`}><div className="sd-pie-pair"><PieBreakdown title="Camps joués" segments={[{ label: "Survivant", count: summary.roles.survivor, color: "#6ac3ba" }, { label: "Tueur", count: summary.roles.killer, color: "#e07167" }, { label: "Inconnu", count: summary.roles.unknown, color: "#75838b" }]} /><PieBreakdown title="Modes de jeu" segments={Object.entries(summary.queues).map(([label, count], index) => ({ label, count, color: ["#dcb777", "#ad94dc", "#6ac3ba", "#e07167", "#8899af"][index % 5]! }))} /></div><div className="sd-stat-pair"><Metric label="Matchs avec déconnexion" value={`${summary.disconnectedMatches} / ${summary.count}`} /><Metric label="Déconnexions signalées" value={format(summary.disconnectedPlayers)} /></div></Panel><Panel title="Activité par période" subtitle="Dernières périodes disponibles"><div className="sd-two-columns"><div><h4>Par semaine</h4>{[...weekly].slice(-6).map(([label, count]) => <div className="sd-detail-line" key={label}><span>{day(Date.parse(`${label}T12:00:00Z`))}</span><strong>{count} matchs</strong></div>)}</div><div><h4>Par mois</h4>{[...monthly].slice(-6).map(([label, count]) => <div className="sd-detail-line" key={label}><span>{new Intl.DateTimeFormat("fr", { month: "short", year: "numeric", timeZone: "Europe/Paris" }).format(new Date(`${label}-15T12:00:00Z`))}</span><strong>{count} matchs</strong></div>)}</div></div></Panel></div></>;
}

function PieBreakdown({ title, segments }: { title: string; segments: { label: string; count: number; color: string }[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  let start = 0;
  const stops = segments.map(segment => {
    const end = start + (total ? segment.count / total * 100 : 0);
    const stop = `${segment.color} ${start}% ${end}%`;
    start = end;
    return stop;
  });
  const active = segments.find(segment => segment.label === selected);
  return <figure className="sd-pie-breakdown">
    <figcaption>{title}</figcaption>
    <div className="sd-pie-content">
      <div className="sd-pie-wheel" role="img" aria-label={`${title} : ${segments.map(segment => `${segment.label} ${segment.count}`).join(", ")}`} style={{ background: total ? `conic-gradient(${stops.join(", ")})` : "#303c41" }}>
        <div><strong>{active ? percent(ratio(active.count, total)) : format(total)}</strong><span>{active?.label ?? "au total"}</span></div>
      </div>
      <div className="sd-pie-legend">{segments.map(segment => <button type="button" key={segment.label} aria-pressed={selected === segment.label} onClick={() => setSelected(selected === segment.label ? null : segment.label)}><i style={{ background: segment.color }} /><span>{segment.label}</span><strong>{segment.count}</strong><small>{percent(ratio(segment.count, total))}</small></button>)}</div>
    </div>
  </figure>;
}

function ResultLine({ label, value, description }: { label: string; value: string | null; description?: string }) {
  if (value === null) return null;
  return <div className="sd-result-line"><div><span>{label}</span>{description && <p>{description}</p>}</div><strong>{value}</strong></div>;
}

function ScorePanel({ summary }: { summary: AnalysisSummary }) {
  return <Panel title="Comprendre vos scores" subtitle={summary.scoreSamples + " scores renseignés"}>
    <p className="sd-panel-description">Un résultat par ligne. Les scores enregistrés ne comprennent pas les bonus de points de sang.</p>
    <ResultLine label="Score moyen par partie" value={summary.score === null ? null : format(summary.score)} description="Somme des scores connus divisée par le nombre de parties avec un score." />
    <ResultLine label="Score médian" value={summary.scoreMedian === null ? null : format(summary.scoreMedian)} description="La moitié de vos scores est au-dessus de cette valeur, l’autre moitié en dessous." />
    <ResultLine label="Votre meilleur score" value={summary.scoreMax === null ? null : format(summary.scoreMax)} description="Le plus haut score enregistré dans cette sélection." />
    <ResultLine label="Score par minute de partie" value={summary.scorePerMinute === null ? null : format(summary.scorePerMinute)} description="Scores cumulés divisés par la durée cumulée des parties renseignées." />
    <ResultLine label="Score cumulé" value={summary.scoreSamples ? format(summary.scoreTotal) : null} description="Somme de tous les scores connus dans vos filtres actuels." />
    <details className="sd-details"><summary>Régularité et classements entre survivants</summary>
      <ResultLine label="Dispersion des scores" value={summary.scoreStd === null ? null : format(summary.scoreStd)} description="Écart-type : plus cette valeur est faible, plus vos scores se ressemblent." />
      <ResultLine label="Premier au score" value={summary.topScoreRate === null ? null : percent(summary.topScoreRate)} description="Parties où votre score est le meilleur parmi les survivants, égalités incluses." />
      <ResultLine label="Dans les deux premiers" value={summary.topTwoRate === null ? null : percent(summary.topTwoRate)} description="Votre score est classé premier ou deuxième dans l’équipe survivante." />
      <ResultLine label="Dernier au score" value={summary.lastScoreRate === null ? null : percent(summary.lastScoreRate)} description="Votre score est le plus bas parmi les survivants, égalités incluses." />
      <ResultLine label="Écart au score des équipiers" value={summary.scoreGap === null ? null : format(summary.scoreGap)} description="Votre score moins le score moyen des autres survivants ; un nombre positif est supérieur à leur moyenne." />
      <ResultLine label="Premier au score malgré une mort" value={summary.rankSamples ? format(summary.topScoreDead) : null} description="Nombre de parties où vous avez obtenu le meilleur score survivant sans vous échapper." />
    </details>
  </Panel>;
}

function StreakPanel({ matches, role }: { matches: readonly AnalyzedMatch[]; role: string }) {
  const summary = useMemo(() => summarizeMatches(matches), [matches]);
  const camps: { title: string; tone: string; entries: { label: string; description: string; current: number; best: number }[] }[] = [];
  if (role !== "killer") camps.push({ title: "Survivant", tone: "teal", entries: [
    { label: "Victoires d’affilée", description: "Évasions personnelles réussies.", ...summary.streaks.escape },
    { label: "Défaites d’affilée", description: "Évasions échouées : mort ou déconnexion.", ...summary.streaks.death },
    { label: "Victoires groupées d’affilée", description: "Toute l’équipe survivante s’échappe.", ...summary.streaks.groupEscape },
  ] });
  if (role !== "survivor") camps.push({ title: "Tueur", tone: "red", entries: [
    { label: "Victoires d’affilée", description: "Trois ou quatre kills dans la partie.", ...summary.streaks.killerWin },
    { label: "Matchs nuls d’affilée", description: "Exactement deux kills.", ...summary.streaks.killerDraw },
    { label: "Défaites d’affilée", description: "Zéro ou un kill.", ...summary.streaks.killerLoss },
  ] });
  return <Panel className="sd-streak-panel" title="Vos records de séries" subtitle={matches.length + " parties dans la période"} tone="gold">
    <p className="sd-panel-description">Tout l’historique par défaut. Seul le filtre de période limite ces records ; le filtre de camp choisit les séries affichées.</p>
    <div className={"sd-streak-camps" + (camps.length === 1 ? " single" : "")}>{camps.map(camp => <section className={"sd-streak-camp sd-tone-" + camp.tone} key={camp.title}><h4>{camp.title}<span>Record / en cours</span></h4>{camp.entries.map(entry => <div className="sd-streak-record" key={entry.label}><div><strong>{entry.label}</strong><p>{entry.description}</p></div><div><b>{entry.best}</b><span>{entry.current} en cours</span></div></div>)}</section>)}</div>
    <p className="sd-footnote">Les issues inconnues interrompent une série. Pour les séries tueur à 0–4 kills, seules les parties 1v4 et Lights Out sont utilisées ; le 2v8 n’est pas comparable.</p>
  </Panel>;
}

function OutcomePanel({ matches, summary }: { matches: readonly AnalyzedMatch[]; summary: AnalysisSummary }) {
  const [camp, setCamp] = useState("survivor");
  const selected = summary.survivorCount && summary.killerCount ? camp : summary.killerCount ? "killer" : "survivor";
  const scoped = useMemo(() => matches.filter(match => match.entry.role === selected), [matches, selected]);
  const scopedSummary = useMemo(() => summarizeMatches(scoped), [scoped]);
  return <div className="sd-outcome-panel">
    {summary.killerCount > 0 && summary.survivorCount > 0 && <div className="sd-segments" role="group" aria-label="Camp des résultats détaillés"><button type="button" aria-pressed={selected === "survivor"} onClick={() => setCamp("survivor")}>Survivant · {summary.survivorCount} parties</button><button type="button" aria-pressed={selected === "killer"} onClick={() => setCamp("killer")}>Tueur · {summary.killerCount} parties</button></div>}
    {selected === "killer" ? <KillPanel matches={scoped} summary={scopedSummary} /> : <SurvivalPanel matches={scoped} summary={scopedSummary} />}
  </div>;
}

function KillPanel({ matches, summary }: { matches: readonly AnalyzedMatch[]; summary: AnalysisSummary }) {
  const maximum = matches.some(match => match.entry.queueLabel === "2v8") ? 8 : 4;
  return <Panel className="sd-kill-panel" title="Vos kills, en détail" subtitle={summary.perfectSamples + " parties aux résultats complets"} tone="red">
    <p className="sd-panel-description">Vos résultats tueur. Un taux de kill mesure la part des survivants tués, pas la part des parties gagnées.</p>
    <ResultLine label="Taux de kill" value={summary.killRate === null ? null : percent(summary.killRate)} description={summary.deaths + " kills sur " + summary.killSamples + " survivants affrontés."} />
    <ResultLine label="Kills par partie" value={summary.averageKills === null ? null : decimalValue(summary.averageKills)} description="Moyenne sur les parties dont toutes les issues sont connues." />
    <ResultLine label="Parties sans évasion" value={summary.perfectRate === null ? null : percent(summary.perfectRate)} description="Tous les survivants ont été tués." />
    <ResultLine label="Temps avant le premier kill" value={summary.firstDeath === null ? null : time(summary.firstDeath)} description="Temps moyen depuis le début des parties avec des durées individuelles exploitables." />
    <ResultLine label="Temps moyen entre deux kills" value={summary.deathInterval === null ? null : time(summary.deathInterval)} description="Intervalle moyen entre le premier et le dernier kill, réparti sur les kills intermédiaires." />
    <PieBreakdown title="Combien de kills par partie ?" segments={Array.from({ length: maximum + 1 }, (_, index) => ({ label: index + (index > 1 ? " kills" : " kill"), count: summary.killDistribution[index] ?? 0, color: ["#657784", "#93819f", "#dcb777", "#df8f68", "#df665f", "#c95562", "#b24b6e", "#963d75", "#7b397d"][index]! }))} />
    <p className="sd-footnote">Les déconnexions et les résultats incomplets sont exclus. En 2v8, les kills sont ceux des deux tueurs réunis.</p>
  </Panel>;
}

function EncounterCharts({ matches }: { matches: readonly AnalyzedMatch[] }) {
  const charts = useMemo(() => [
    { title: "Survivants les plus rencontrés", rows: encounterCounts(matches, "survivor"), description: "Alliés et adversaires, sans compter votre propre personnage." },
    { title: "Tueurs les plus rencontrés", rows: encounterCounts(matches.filter(match => match.entry.role === "survivor"), "killer"), description: "Tueurs adverses dans vos parties survivant." },
    { title: "Cartes les plus rencontrées", rows: encounterCounts(matches, "map"), description: "Une observation par partie avec une carte renseignée." },
    { title: "Compétences adverses les plus rencontrées", rows: encounterCounts(matches, "perk"), description: "Une observation par compétence équipée et par adversaire renseigné." },
  ], [matches]);
  return <div className="sd-encounter-grid">{charts.map(chart => {
    const top = chart.rows.slice(0, 5);
    const remainder = chart.rows.slice(5).reduce((sum, row) => sum + row.count, 0);
    const segments = top.map((row, index) => ({ label: assetLabel(row.asset), count: row.count, color: ["#6ac3ba", "#dcb777", "#ad94dc", "#df8074", "#89a9cc"][index]! }));
    if (remainder) segments.push({ label: "Autres", count: remainder, color: "#5d6874" });
    return <Panel key={chart.title} title={chart.title}><p className="sd-panel-description">{chart.description}</p>{segments.length ? <PieBreakdown title="Répartition des observations" segments={segments} /> : <p className="sd-no-data">Aucune observation renseignée dans cette sélection.</p>}</Panel>;
  })}</div>;
}

function SurvivalPanel({ matches, summary }: { matches: readonly AnalyzedMatch[]; summary: AnalysisSummary }) {
  const [scope, setScope] = useState<string | null>(null);
  const observed = useMemo(() => summarizeObservedSurvival(matches), [matches]);
  const personal = (scope ?? (summary.survivalSamples ? "personal" : "observed")) === "personal";
  const count = personal ? summary.survivalSamples : observed.count;
  const distribution = personal ? summary.survivalDistribution : observed.distribution;
  return <Panel className="sd-survival-panel" title="Survivre, jusqu’à quand ?" subtitle={`${count} durées ${personal ? "personnelles" : "observées"}`} tone="teal">
    <div className="sd-segments" role="group" aria-label="Survivants analysés"><button type="button" aria-pressed={personal} onClick={() => setScope("personal")}>Mon survivant ({summary.survivalSamples})</button><button type="button" aria-pressed={!personal} onClick={() => setScope("observed")}>Tous les survivants ({observed.count})</button></div>
    {count ? <>
      <div className="sd-survival-results">
        <ResultLine label="Survie moyenne" value={time(personal ? summary.survival : observed.average)} description="Somme des durées individuelles connues divisée par leur nombre." />
        <ResultLine label="Survie médiane" value={time(personal ? summary.survivalMedian : observed.median)} description="Durée dépassée par la moitié des survivants observés." />
        <ResultLine label="Plus longue survie" value={time(personal ? summary.survivalMax : observed.maximum)} description="Durée individuelle la plus longue dans cette sélection." />
        <ResultLine label="Mort avant cinq minutes" value={percent(personal ? summary.earlyDeathRate : observed.earlyDeathRate)} description="Part des morts renseignées survenues avant cinq minutes." />
        <ResultLine label="Survie moyenne avec évasion" value={(personal ? summary.escapedSurvival : observed.escaped) === null ? null : time(personal ? summary.escapedSurvival : observed.escaped)} description="Uniquement les durées des survivants qui se sont échappés." />
        <ResultLine label="Survie moyenne sans évasion" value={(personal ? summary.deadSurvival : observed.dead) === null ? null : time(personal ? summary.deadSurvival : observed.dead)} description="Uniquement les durées des survivants morts." />
      </div>
      <PieBreakdown title="Répartition des durées de survie" segments={["< 5 min", "5–10 min", "10–15 min", "15 min +"].map((label, index) => ({ label, count: distribution[index] ?? 0, color: ["#e07167", "#dcb777", "#6ac3ba", "#ad94dc"][index]! }))} />
      {personal && <details className="sd-details"><summary>Ordre des morts et résultats de l’équipe</summary><div className="sd-stat-pair"><Metric label="Premier survivant mort" value={percent(summary.firstDeadRate)} /><Metric label="Dernier vivant · les autres morts" value={percent(summary.lastAliveRate)} /></div><Histogram labels={Array.from({ length: matches.some(match => match.entry.queueLabel === "2v8") ? 8 : 4 }, (_, index) => `${index + 1}${index === 0 ? "er" : "e"}`)} values={summary.deathOrder} tone="teal" /><div className="sd-stat-pair"><Metric label="Échappés quand je survis" value={decimalValue(summary.teamEscapesWhenAlive)} /><Metric label="Échappés quand je meurs" value={decimalValue(summary.teamEscapesWhenDead)} /></div></details>}
    </> : <p className="sd-coverage-note">Aucune durée personnelle archivée pour cette sélection. La synchronisation complète les matchs encore accessibles. Le bouton « Tous les survivants » exploite les durées individuelles déjà disponibles.</p>}
    <p className="sd-footnote">{personal ? "Votre survivant uniquement." : "Durées individuelles de tous les survivants renseignés dans les matchs sélectionnés, y compris alliés et adversaires."} La durée totale d’une partie n’est jamais utilisée pour remplacer une durée personnelle manquante.</p>
  </Panel>;
}

function Emblems({ matches }: { matches: readonly AnalyzedMatch[] }) {
  const groups = new Map<string, { label: string; image: string; counts: number[]; total: number }>();
  let samples = 0;
  let perfect = 0;
  matches.forEach(({ entry }) => {
    const urls = entry.emblemIconUrls ?? [];
    if (urls.length === 4) { samples++; if (urls.every(url => /_4\.png/i.test(assetKey(url)))) perfect++; }
    urls.forEach((url, index) => {
      const parsed = /emblem_(killer|survivor)_(.+)_(\d)\./i.exec(assetKey(url));
      if (!parsed) return;
      const quality = Number(parsed[3]);
      if (quality < 0 || quality > 4) return;
      const key = `${parsed[1]}:${parsed[2]}`;
      const group = groups.get(key) ?? { label: (entry.emblemIconLabels?.[index] ?? parsed[2]!).replace(/\s*[-–]\s*(None|Bronze|Silver|Gold|Iridescent).*$/i, ""), image: url, counts: [0, 0, 0, 0, 0], total: 0 };
      group.counts[quality] = (group.counts[quality] ?? 0) + 1; group.total++; groups.set(key, group);
    });
  });
  return <Panel title="La collection d’emblèmes" subtitle={`${samples} / ${matches.length} parties avec quatre emblèmes`} tone="gold">{groups.size ? <><div className="sd-emblem-grid">{[...groups].map(([key, group]) => <div className="sd-emblem" key={key}><img src={group.image} alt="" loading="lazy" /><h4>{group.label}</h4><div className="sd-emblem-stack">{group.counts.map((count, i) => <i key={i} className={`quality-${i}`} style={{ width: `${count / group.total * 100}%` }} title={`${["Aucun", "Bronze", "Argent", "Or", "Iridescent"][i]} : ${count}`} />)}</div><p>{group.total} observations · {percent(ratio(group.counts[4]!, group.total))} iridescent</p></div>)}</div><div className="sd-emblem-legend">{["Aucun", "Bronze", "Argent", "Or", "Iridescent"].map((label, i) => <span key={label}><i className={`quality-${i}`} />{label}</span>)}</div><p className="sd-footnote">{perfect} partie(s) avec quatre emblèmes iridescents sur {samples} jeux d’emblèmes complets.</p></> : <div className="sd-emblem-empty"><span aria-hidden="true">◇</span><div><h4>Les prochains matchs enrichiront cette collection.</h4><p>Les emblèmes sont désormais conservés lors de la lecture des détails. Vos anciens matchs sans emblèmes restent exclus de ce calcul.</p></div></div>}</Panel>;
}
