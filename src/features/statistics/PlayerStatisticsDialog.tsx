import { useEffect, useRef, useState } from "react";
import type { CommunityPlayer } from "../../services/community.js";
import { cachedPublicStatistics, invalidatePublicStatistics, readPublicStatistics } from "../../services/public-statistics.js";
import { StatisticsView } from "./StatisticsView.js";

export function PlayerStatisticsDialog({ player, onClose, onInspect, adjustMmr = false }: { player: CommunityPlayer; onClose: () => void; onInspect?: (player: CommunityPlayer) => void; adjustMmr?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState(() => adjustMmr ? undefined : cachedPublicStatistics(player.user_id));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true; dialog.current?.showModal();
    if (adjustMmr) invalidatePublicStatistics(player.user_id);
    void readPublicStatistics(player.user_id).then(value => { if (active) setData(value); }).catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [player.user_id, adjustMmr]);
  return <dialog ref={dialog} className="statistics-player-dialog public-player-dialog" aria-label={`Statistiques de ${data?.nickname ?? player.nickname}`} onClose={onClose} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
    <header className="statistics-player-header"><h2>Statistiques de {data?.nickname ?? player.nickname}</h2><button type="button" className="secondary-button" aria-label="Fermer les statistiques du joueur" onClick={() => dialog.current?.close()}>✕</button></header>
    {error && <p role="alert">{error}</p>}{data ? <StatisticsView serverUrl="" nextSyncAt={null} canEdit={false} readOnly publicSnapshot={data.snapshot} mmrTargetUser={adjustMmr ? player.user_id : undefined} onInspectPlayer={onInspect} /> : !error && <p role="status">Chargement des statistiques…</p>}
  </dialog>;
}
