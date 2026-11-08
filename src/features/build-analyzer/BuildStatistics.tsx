import { useEffect, useMemo, useState } from "react";
import type { Killer } from "../../domain/killer.js";
import type { Perk } from "../../domain/perk.js";
import { perkIconUrl } from "../../app/assets.js";
import { readStatisticsSnapshot, type StatisticsSnapshot } from "../../services/statistics.js";
import { analyzeMatches, groupMatches, matchesForBuild, summarizeMatches } from "../../services/statistics-analysis.js";
import "./build-statistics.css";

const number = (value: number) => new Intl.NumberFormat("fr", { maximumFractionDigits: 1 }).format(value);
const percent = (value: number | null) => value === null ? "—" : `${number(value * 100)} %`;
const time = (value: number | null) => value === null ? "—" : `${Math.floor(Math.round(value) / 60)} min ${String(Math.round(value) % 60).padStart(2, "0")} s`;

export function BuildStatistics({ perks, character, side, serverUrl }: { perks: readonly Perk[]; character: Killer; side: Perk["side"]; serverUrl: string }) {
  const [snapshot, setSnapshot] = useState<StatisticsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState("all");
  useEffect(() => {
    let disposed = false;
    setSnapshot(null);
    const refresh = async () => {
      try {
        const data = await readStatisticsSnapshot(serverUrl);
        if (!disposed) { setSnapshot(data); setError(null); }
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : "Historique inaccessible.");
      }
    };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 30_000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [serverUrl, attempt]);
  const allMatches = useMemo(() => matchesForBuild(analyzeMatches(snapshot?.matchHistory ?? []), side, [character.name.fr ?? "", character.name.en ?? ""], perks), [snapshot, side, character, perks]);
  const modes = [...new Set(allMatches.map(match => match.entry.queueLabel ?? "1v4"))];
  const selectedMode = modes.includes(mode) ? mode : "all";
  const matches = useMemo(() => allMatches.filter(match => selectedMode === "all" || (match.entry.queueLabel ?? "1v4") === selectedMode), [allMatches, selectedMode]);
  const summary = useMemo(() => summarizeMatches(matches), [matches]);
  const maps = useMemo(() => groupMatches(matches, "map").slice(0, 3), [matches]);
  const killer = side === "killer";
  const rate = killer ? summary.killRate : summary.escapeRate;
  const samples = killer ? summary.perfectSamples : summary.escapeSamples;
  const streak = killer ? summary.streaks.killerWin : summary.streaks.escape;
  const distribution = killer
    ? summary.killDistribution.slice(0, 5).map((count, kills) => ({ label: `${kills} kill${kills > 1 ? "s" : ""}`, count, tone: kills >= 3 ? "good" : kills === 2 ? "draw" : "bad" }))
    : [{ label: "Évasions", count: summary.outcomes.escaped, tone: "good" }, { label: "Échecs", count: summary.outcomes.dead, tone: "bad" }, { label: "Déconnexions", count: summary.outcomes.disconnected, tone: "draw" }, { label: "Résultat inconnu", count: summary.outcomes.unknown, tone: "unknown" }];

  return <div className={`build-statistics ${side}`} role="tabpanel" id="build-statistics-panel" aria-labelledby="build-statistics-tab">
    <header className="bs-heading"><div><span className="bs-eyebrow">RÉSULTATS OBSERVÉS</span><h3>Votre build, à l’épreuve.</h3><p>{character.name.fr ?? character.name.en} · Même personnage et mêmes compétences, quel que soit l’ordre. Tout l’historique enregistré.</p></div>{modes.length > 1 && <label>Mode de jeu<select value={selectedMode} onChange={event => setMode(event.target.value)}><option value="all">Tous les modes</option>{modes.map(value => <option key={value} value={value}>{value}</option>)}</select></label>}</header>
    <div className="bs-perks">{perks.map(perk => <span key={perk.id} title={perk.name.fr ?? perk.id}>{perkIconUrl(perk) && <img src={perkIconUrl(perk)!} alt="" />}<span>{perk.name.fr ?? perk.name.en}</span></span>)}</div>
    {error && <div className="bs-message" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Réessayer</button></div>}
    {!snapshot && !error ? <p className="bs-message" role="status">Lecture de l’historique…</p> : snapshot && <>
      <div className="bs-kpis"><Metric label="Parties jouées" value={number(summary.count)} detail="avec cette combinaison exacte" /><Metric label={killer ? "Taux de kill" : "Taux d’évasion"} value={percent(rate)} detail={samples ? killer ? `${summary.deaths} kills sur ${summary.killSamples} survivants · ${samples} parties complètes` : `${summary.escapeCount} évasions sur ${samples} résultats connus` : "Aucun résultat exploitable"} accent /><Metric label="Score moyen" value={summary.score === null ? "—" : number(summary.score)} detail={`${summary.scoreSamples} scores connus · hors bonus`} /><Metric label="Durée moyenne" value={time(summary.duration)} detail={`${summary.durationSamples} durées connues`} /></div>
      {!matches.length ? <div className="bs-message"><strong>Aucune partie enregistrée avec ce build.</strong><p>Les statistiques apparaîtront après l’import de parties jouées avec ce personnage et exactement ces {perks.length} compétence{perks.length > 1 ? "s" : ""}.</p></div> : <>
        <div className="bs-columns"><section className="bs-card"><h4>{killer ? "Combien de kills par partie ?" : "Vos issues de partie"}</h4><p>{killer ? `${samples} parties dont les quatre résultats sont connus.` : "Les résultats inconnus et déconnexions sont exclus du taux d’évasion."}</p><div className="bs-distribution">{distribution.map(item => <div className={item.tone} key={item.label}><span>{item.label}</span><span className="bs-track"><i style={{ width: `${item.count / Math.max(1, ...distribution.map(row => row.count)) * 100}%` }} /></span><strong>{item.count}</strong></div>)}</div>{killer && samples < summary.count && <small>{summary.count - samples} partie(s) incomplète(s), hors répartition.</small>}</section>
        <section className="bs-card"><h4>Les chiffres à retenir</h4><dl><Detail label={killer ? "Kills moyens par partie" : "Temps de survie moyen"} value={killer ? summary.averageKills === null ? null : number(summary.averageKills) : summary.survival === null ? null : time(summary.survival)} /><Detail label={killer ? "Victoires · 3 ou 4 kills" : "Meilleur score de la partie"} value={killer ? summary.winRate === null ? null : percent(summary.winRate) : summary.topScoreRate === null ? null : percent(summary.topScoreRate)} /><Detail label={killer ? "Parties à 4 kills" : "Évasions seul"} value={killer ? summary.perfectRate === null ? null : percent(summary.perfectRate) : summary.soleEscapeRate === null ? null : percent(summary.soleEscapeRate)} /><Detail label="Record de victoires d’affilée" value={samples ? `${streak.best} partie${streak.best > 1 ? "s" : ""}` : null} /><Detail label="Meilleur score" value={summary.scoreMax === null ? null : number(summary.scoreMax)} /><Detail label="Temps total joué" value={summary.durationSamples ? time(summary.totalTime) : null} /></dl><small>Les moyennes et taux utilisent uniquement les données connues.</small></section></div>
        {maps.length > 0 && <section className="bs-card bs-maps"><h4>Vos terrains les plus joués</h4>{maps.map(map => <div key={map.key}><span><strong>{map.label}</strong><small>{map.summary.count} partie{map.summary.count > 1 ? "s" : ""} · {time(map.summary.duration)} en moyenne</small></span><b>{percent(killer ? map.summary.killRate : map.summary.escapeRate)}<small>{killer ? "de kill" : "d’évasion"}</small></b></div>)}</section>}
      </>}
      {snapshot.updatedAt && <p className="bs-updated">Historique actualisé le {new Date(snapshot.updatedAt).toLocaleString("fr-FR")}</p>}
    </>}
  </div>;
}

function Metric({ label, value, detail, accent = false }: { label: string; value: string; detail: string; accent?: boolean }) {
  return <article className={`bs-metric${accent ? " accent" : ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
function Detail({ label, value }: { label: string; value: string | null }) {
  return value === null ? null : <div><dt>{label}</dt><dd>{value}</dd></div>;
}
