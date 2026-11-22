import { useEffect, useState } from "react";
import { communityRpc, type LeaderboardPlayer } from "../../services/community.js";
import { CommunityPagination } from "../account/AdministrationView.js";

const MODES = [["1v4-survivor", "1 contre 4 · Survivant"], ["1v4-killer", "1 contre 4 · Tueur"], ["2v8-survivor", "2 contre 8 · Survivant"], ["2v8-killer", "2 contre 8 · Tueur"], ["lights-out-survivor", "Lights Out · Survivant"], ["lights-out-killer", "Lights Out · Tueur"]];
export function LeaderboardView() {
  const [mode, setMode] = useState("1v4-survivor"), [killer, setKiller] = useState(""), [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; players: LeaderboardPlayer[]; killers: string[] }>({ total: 0, players: [], killers: [] });
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(true);
  const killerMode = mode.endsWith("-killer");
  useEffect(() => {
    let active = true; setLoading(true); setError(null);
    void communityRpc<typeof data>("player_leaderboard", { selected_mode: mode, selected_killer: killer, page_index: page })
      .then(result => { if (active) setData(result); }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [mode, killer, page]);
  return <main className="community-page" aria-label="Classement"><h1>Classement des joueurs</h1>
    <p>MMR estimé par l’application, à partir des parties archivées. Seuls les joueurs ayant joué dans cette sélection sont classés.</p>
    <div className="community-filters"><label><span>Mode de jeu</span><select aria-label="Mode de jeu" value={mode} onChange={event => { setMode(event.target.value); setKiller(""); setPage(0); }}>{MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {killerMode && <label><span>Tueur</span><select aria-label="Tueur" value={killer} onChange={event => { setKiller(event.target.value); setPage(0); }}><option value="">Choisir un tueur…</option>{data.killers.map(name => <option key={name}>{name}</option>)}</select></label>}
    </div>
    {error && <p role="alert">{error}</p>}{loading ? <p role="status">Chargement du classement…</p> : !error && <>
      {killerMode && !killer ? <p>Choisissez un tueur pour afficher son classement.</p> : <>
        <div className="community-table-scroll"><table><thead><tr><th>Rang</th><th>Pseudo</th><th>MMR estimé</th><th>Victoires</th><th>Défaites</th></tr></thead>
          <tbody>{data.players.map(player => <tr key={player.user_id}><td>{player.rank}</td><th scope="row">{player.nickname}</th><td>{player.mmr}</td><td>{player.wins}</td><td>{player.losses}</td></tr>)}</tbody></table></div>
        {!data.players.length && <p>Aucune partie classée dans cette sélection.</p>}
        <CommunityPagination page={page} total={data.total} onChange={setPage} />
      </>}
      <p className="community-note">Survivant : une évasion est une victoire, un décès ou une déconnexion une défaite. Tueur : 3 éliminations ou plus sont une victoire, 0 ou 1 une défaite ; 2 donnent un nul. Les nuls ne comptent ni comme victoire ni comme défaite.</p>
    </>}
  </main>;
}
