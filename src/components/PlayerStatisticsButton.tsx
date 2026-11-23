import type { CommunityPlayer } from "../services/community.js";

export function PlayerStatisticsButton({ player, onInspect }: { player: CommunityPlayer; onInspect: ((player: CommunityPlayer) => void) | undefined }) {
  return <button type="button" className="manager-icon-button player-statistics-eye" disabled={!onInspect} aria-label={`Voir les statistiques de ${player.nickname}`} title={`Statistiques de ${player.nickname}`} onClick={() => onInspect?.(player)}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
  </button>;
}
