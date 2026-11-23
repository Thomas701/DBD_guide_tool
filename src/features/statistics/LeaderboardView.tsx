import { useEffect, useState } from "react";
import type { CommunityPlayer } from "../../services/community.js";
import { cachedLeaderboard, LEADERBOARD_MODES as MODES, loadLeaderboard, readLeaderboardFilters, saveLeaderboardFilters, type LeaderboardResult } from "../../services/leaderboard.js";
import { PlayerStatisticsButton } from "../../components/PlayerStatisticsButton.js";
import { CommunityPagination } from "../account/AdministrationView.js";

export function LeaderboardView({ onInspect }: { onInspect?: ((player: CommunityPlayer) => void) | undefined }) {
  const [filters, setFilters] = useState(readLeaderboardFilters);
  const { mode, killer, page } = filters;
  const [data, setData] = useState<LeaderboardResult>(() => cachedLeaderboard(filters)?.data ?? { total: 0, players: [], killers: [] });
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(() => !cachedLeaderboard(filters));
  const killerMode = mode.endsWith("-killer");
  useEffect(() => {
    let active = true;
    saveLeaderboardFilters(filters);
    const cached = cachedLeaderboard(filters);
    if (cached) setData(cached.data);
    setLoading(!cached); setError(null);
    void loadLeaderboard(filters)
      .then(result => { if (active) setData(result); }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [mode, killer, page]);
  return <main className="community-page" aria-label="Classement">
    <div className="community-filters"><label><span>Mode de jeu</span><select aria-label="Mode de jeu" value={mode} onChange={event => setFilters({ ...filters, mode: event.target.value, page: 0 })}>{MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {killerMode && <label className={!killer ? "community-killer-required" : ""}><span>Tueur</span><select aria-label="Tueur" value={killer} onChange={event => setFilters({ ...filters, killer: event.target.value, page: 0 })}><option value="">Choisir un tueur…</option>{[...new Set([...data.killers, ...(killer ? [killer] : [])])].map(name => <option key={name}>{name}</option>)}</select></label>}
    </div>
    <p className="community-note">Le MMR commence à 600 pour chaque mode{mode.includes("lights-out") ? " Lights Out" : mode.startsWith("2v8") ? " 2 contre 8" : " 1 contre 4"}{killerMode ? " et pour chaque tueur. Chaque partie ajoute 9 points à partir de 3 éliminations, ne change rien avec 2 et retire 9 points avec 0 ou 1. Une victoire correspond à 3 éliminations ou plus, une défaite à 0 ou 1 ; 2 donnent un nul." : ". Chaque partie ajoute 9 points si votre score dépasse celui de plus de la moitié des autres survivants, retire 9 points s’il est inférieur à celui de plus de la moitié, et ne change rien sinon ou si les scores manquent. Les victoires et défaites comptent séparément les évasions et les morts ou déconnexions : une évasion ne garantit donc pas un gain de MMR."} Seules les parties archivées de cette sélection comptent.</p>
    {error && <p role="alert">{error}</p>}{loading ? <p role="status">Chargement du classement…</p> : <>
      {killerMode && !killer ? <p>Choisissez un tueur pour afficher son classement.</p> : <>
        <div className="community-table-scroll"><table><thead><tr><th>Rang</th><th>Pseudo</th><th>MMR estimé</th><th>Victoires</th><th>Défaites</th><th><span className="sr-only">Statistiques</span></th></tr></thead>
          <tbody>{data.players.map(player => <tr key={player.user_id}><td>{player.rank}</td><th scope="row">{player.nickname}</th><td>{player.mmr}</td><td>{player.wins}</td><td>{player.losses}</td><td><PlayerStatisticsButton player={player} onInspect={onInspect} /></td></tr>)}</tbody></table></div>
        {!data.players.length && <p>Aucune partie classée dans cette sélection.</p>}
        <CommunityPagination page={page} total={data.total} onChange={page => setFilters({ ...filters, page })} />
      </>}
    </>}
  </main>;
}
