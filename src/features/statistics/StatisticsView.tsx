import { useEffect, useMemo, useRef, useState } from "react";

import {
  readStatisticsSnapshot,
  readStatisticsStatus,
  showStatisticsPage,
  syncStatisticsSnapshot,
  type MatchHistoryEntry,
  type MatchHistoryParticipant,
  type StatisticsSnapshot,
  type StatisticsStatus,
} from "../../services/statistics.js";
import { calculateMmrHistory, INITIAL_MMR, isMvpMatch, type MmrEvent, type MmrMode } from "../../services/statistics-mmr.js";

type StatisticsTab = "overview" | "mmr" | "history";
type QueueFilter = "all" | "1v4" | "2v8";
type RoleFilter = "all" | "killer" | "survivor";
type MmrRange = "7d" | "30d" | "90d" | "all";

const HISTORY_PAGE_SIZE = 30;
const STATUS_REFRESH_INTERVAL_MS = 5_000;
const ESCAPED_ICON_URL = "https://assets.live.bhvraccount.com/stats/VE_Escaped.png";
const SACRIFICED_ICON_URL = "https://assets.live.bhvraccount.com/stats/VE_Sacrificed.png";

export function StatisticsView({ serverUrl, nextSyncAt }: { serverUrl: string; nextSyncAt: number | null }) {
  const [snapshot, setSnapshot] = useState<StatisticsSnapshot | null>(null);
  const [status, setStatus] = useState<StatisticsStatus | null>(null);
  const [tab, setTab] = useState<StatisticsTab>("overview");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [mapFilter, setMapFilter] = useState("all");
  const [killerFilters, setKillerFilters] = useState<string[]>([]);
  const [survivorFilters, setSurvivorFilters] = useState<string[]>([]);
  const [mmrMode, setMmrMode] = useState<MmrMode>("1v4-survivor");
  const [mmrRange, setMmrRange] = useState<MmrRange>("30d");
  const [mmrKiller, setMmrKiller] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const pollingTimer = useRef<number | null>(null);
  const autoRefreshTimer = useRef<number | null>(null);
  const mounted = useRef(true);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);
    await loadStatus().catch(() => undefined);
    startPolling();
    try {
      const next = await syncStatisticsSnapshot(serverUrl);
      if (!mounted.current) return;
      setSnapshot(next);
      const nextStatus = await loadStatus().catch(() => null);
      if (nextStatus && !nextStatus.busy) stopPolling();
      setLoading(Boolean(nextStatus?.busy));
    } catch (cause) {
      if (!mounted.current) return;
      const message = cause instanceof Error ? cause.message : "Impossible de récupérer les statistiques.";
      const nextStatus = await loadStatus().catch(() => null);
      if (nextStatus?.busy) {
        setStatus(nextStatus);
        setLoading(true);
      } else {
        setError(nextStatus?.error ?? message);
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      const cached = await readStatisticsSnapshot(serverUrl).catch(() => null);
      if (mounted.current && cached && hasSnapshotContent(cached)) setSnapshot(cached);

      try {
        const nextStatus = await loadStatus();
        if (nextStatus.busy) {
          setLoading(true);
          startPolling();
          return;
        }
        if (nextStatus.error && !hasSnapshotContent(cached)) {
          setError(nextStatus.error);
          return;
        }
      } catch {
        // Le statut distant reste optionnel à ce stade.
      }

      if (!hasSnapshotContent(cached)) await refresh();
    })();

    return () => {
      mounted.current = false;
      stopPolling();
      stopAutoRefresh();
    };
  }, [serverUrl]);

  useEffect(() => {
    stopAutoRefresh();
    autoRefreshTimer.current = window.setInterval(() => {
      void pollStatus();
    }, STATUS_REFRESH_INTERVAL_MS);
    return stopAutoRefresh;
  }, [serverUrl]);

  useEffect(() => {
    setHistoryPage(1);
  }, [queueFilter, roleFilter, mapFilter, killerFilters, survivorFilters]);

  const statistics = snapshot?.statistics ?? null;
  const matchHistory = snapshot?.matchHistory ?? [];
  const mmrEvents = useMemo(() => calculateMmrHistory(matchHistory), [matchHistory]);
  const mmrByMatchId = useMemo(() => new Map(mmrEvents.map((event) => [event.matchId, event])), [mmrEvents]);
  const sourceUrl = tab === "history" || tab === "mmr"
    ? matchHistory[0]?.sourceUrl ?? "https://stats.deadbydaylight.com/match-history/"
    : statistics?.sourceUrl ?? "https://stats.deadbydaylight.com/statistics/";
  const syncing = loading || status?.busy === true;
  const mapOptions = useMemo(
    () => [...new Set(matchHistory.map((match) => match.mapName).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right, "fr")),
    [matchHistory],
  );
  const killerOptions = useMemo(() => characterOptions(matchHistory, "killer"), [matchHistory]);
  const survivorOptions = useMemo(() => characterOptions(matchHistory, "survivor"), [matchHistory]);
  const filteredMatches = useMemo(
    () => matchHistory.filter((match) => matchesQueueFilter(match, queueFilter)
      && matchesRoleFilter(match, roleFilter)
      && matchesMapFilter(match, mapFilter)
      && matchesCharacterFilter(match, "killer", killerFilters)
      && matchesCharacterFilter(match, "survivor", survivorFilters)),
    [matchHistory, queueFilter, roleFilter, mapFilter, killerFilters, survivorFilters],
  );
  const pageCount = Math.max(1, Math.ceil(filteredMatches.length / HISTORY_PAGE_SIZE));
  const currentPage = Math.min(historyPage, pageCount);
  const pagedMatches = filteredMatches.slice((currentPage - 1) * HISTORY_PAGE_SIZE, currentPage * HISTORY_PAGE_SIZE);

  useEffect(() => {
    if (historyPage !== currentPage) setHistoryPage(currentPage);
  }, [historyPage, currentPage]);

  return <main className="statistics-page">
    <header className="statistics-header">
      <div>
        <span className="eyebrow">Dead by Daylight</span>
        <h1>Statistique</h1>
        <p>Statistiques récupérées depuis stats.deadbydaylight.com, archivées localement et mises à jour automatiquement.</p>
      </div>
      <div className="statistics-sync-actions">
        <StatisticsSyncCountdown nextSyncAt={nextSyncAt} syncing={syncing} />
        <button className="secondary-button" type="button" disabled={syncing} onClick={() => void refresh()}>{syncing ? "Synchronisation…" : "Synchroniser"}</button>
      </div>
    </header>

    <section className="statistics-content" aria-label="Statistiques Dead by Daylight">
      <div className="statistics-tabs-row">
        <div className="impact-tabs" role="tablist" aria-label="Sections statistiques">
          <button type="button" role="tab" aria-selected={tab === "overview"} onClick={() => setTab("overview")}>Vue d’ensemble</button>
          <button type="button" role="tab" aria-selected={tab === "mmr"} onClick={() => setTab("mmr")}>MMR</button>
          <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>Historique {matchHistory.length > 0 ? `(${matchHistory.length})` : ""}</button>
        </div>
        <div className="statistics-summary" aria-label="Résumé de synchronisation">
          {snapshot?.updatedAt && <span className="statistics-chip">Base locale mise à jour le {formatTimestamp(snapshot.updatedAt)}</span>}
          {matchHistory.length > 0 && <span className="statistics-chip">{matchHistory.length} partie{matchHistory.length > 1 ? "s" : ""} enregistrée{matchHistory.length > 1 ? "s" : ""}</span>}
          {snapshot && snapshot.fetchedCount > 0 && <span className={`statistics-chip${snapshot.importedCount > 0 ? " accent" : ""}`}>{snapshot.importedCount > 0 ? `+${snapshot.importedCount} nouvelle${snapshot.importedCount > 1 ? "s" : ""} partie${snapshot.importedCount > 1 ? "s" : ""}` : "Aucune nouvelle partie"}</span>}
        </div>
      </div>

      {(status?.logs.length || syncing || status?.error) ? <SyncStatusPanel status={status} syncing={syncing} /> : null}
      {syncing && !hasSnapshotContent(snapshot) && <p className="statistics-sync-note">Connexion en cours dans le Chrome contrôlé par l’application. Sa session est distincte de votre Chrome habituel : terminez la connexion Behaviour dans la fenêtre ouverte.</p>}
      {error && <p className="statistics-error" role="alert">{error}</p>}
      {hasSnapshotContent(snapshot) && <div className="statistics-source">Source : <a href={sourceUrl} onClick={(event) => {
        event.preventDefault();
        void showStatisticsPage(serverUrl, sourceUrl).catch((cause) => setError(cause instanceof Error ? cause.message : "Impossible d’ouvrir la page Statistiques."));
      }}>{shortSourceLabel(tab)}</a> <span>(Chrome contrôlé)</span></div>}

      {tab === "overview" && <OverviewPanel statistics={statistics} historyCount={matchHistory.length} syncing={syncing} />}
      {tab === "mmr" && <MmrPanel
        events={mmrEvents}
        mode={mmrMode}
        range={mmrRange}
        killer={mmrKiller}
        onModeChange={setMmrMode}
        onRangeChange={setMmrRange}
        onKillerChange={setMmrKiller}
      />}
      {tab === "history" && <HistoryPanel
            matches={pagedMatches}
            mmrByMatchId={mmrByMatchId}
            totalMatches={filteredMatches.length}
            allMatchCount={matchHistory.length}
            syncing={syncing}
            statusMessage={status?.message ?? null}
            queueFilter={queueFilter}
            roleFilter={roleFilter}
            mapFilter={mapFilter}
            killerFilters={killerFilters}
            survivorFilters={survivorFilters}
            maps={mapOptions}
            killers={killerOptions}
            survivors={survivorOptions}
            page={currentPage}
            pageCount={pageCount}
            onQueueFilterChange={setQueueFilter}
            onRoleFilterChange={setRoleFilter}
            onMapFilterChange={setMapFilter}
            onKillerFiltersChange={setKillerFilters}
            onSurvivorFiltersChange={setSurvivorFilters}
            onPageChange={setHistoryPage}
          />}
    </section>
  </main>;

  async function loadStatus(): Promise<StatisticsStatus> {
    const nextStatus = await readStatisticsStatus(serverUrl);
    if (!mounted.current) return nextStatus;
    setStatus(nextStatus);
    return nextStatus;
  }

  function startPolling(): void {
    if (pollingTimer.current !== null) return;
    pollingTimer.current = window.setInterval(() => {
      void pollStatus();
    }, 1_200);
    void pollStatus();
  }

  function stopPolling(): void {
    if (pollingTimer.current !== null) {
      window.clearInterval(pollingTimer.current);
      pollingTimer.current = null;
    }
  }

  function stopAutoRefresh(): void {
    if (autoRefreshTimer.current !== null) {
      window.clearInterval(autoRefreshTimer.current);
      autoRefreshTimer.current = null;
    }
  }

  async function pollStatus(): Promise<void> {
    try {
      const nextStatus = await loadStatus();
      if (!mounted.current) return;
      if (!nextStatus.busy) {
        stopPolling();
        setLoading(false);
        const cached = await readStatisticsSnapshot(serverUrl).catch(() => null);
        if (cached && mounted.current) setSnapshot(cached);
        setError(nextStatus.error);
      } else {
        setLoading(true);
      }
    } catch (cause) {
      if (!mounted.current) return;
      stopPolling();
      setLoading(false);
      setError(cause instanceof Error ? cause.message : "Impossible de lire le statut de synchronisation.");
    }
  }
}

function StatisticsSyncCountdown({ nextSyncAt, syncing }: { nextSyncAt: number | null; syncing: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);
  const seconds = Math.max(0, Math.ceil(((nextSyncAt ?? now) - now) / 1_000));
  const remaining = `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  return <span className="statistics-sync-countdown" role="timer" aria-label="Prochaine synchronisation automatique">{syncing ? "Synchronisation en cours" : <>Prochaine synchronisation <strong>{nextSyncAt === null ? "—" : remaining}</strong></>}</span>;
}

function OverviewPanel({ statistics, historyCount, syncing }: { statistics: StatisticsSnapshot["statistics"]; historyCount: number; syncing: boolean }) {
  if (!statistics) {
    return <p className="statistics-empty">{syncing
      ? "Synchronisation en cours. Les statistiques générales apparaîtront ici dès que la lecture sera terminée."
      : `Aucune statistique générale disponible pour le moment. L’historique local contient actuellement ${historyCount} partie${historyCount > 1 ? "s" : ""}.`}</p>;
  }

  return <div className="statistics-grid" aria-label="Statistiques générales">
    <article className="statistics-card"><span>Total hours played in matches</span><strong>{statistics.hoursPlayed}</strong></article>
    <article className="statistics-card"><span>Total matches played</span><strong>{statistics.matchesPlayed}</strong></article>
    <article className="statistics-card"><span>Total Bloodpoints earned</span><strong>{statistics.bloodpointsEarned}</strong></article>
  </div>;
}

function HistoryPanel({
  matches,
  mmrByMatchId,
  totalMatches,
  allMatchCount,
  syncing,
  statusMessage,
  queueFilter,
  roleFilter,
  mapFilter,
  killerFilters,
  survivorFilters,
  maps,
  killers,
  survivors,
  page,
  pageCount,
  onQueueFilterChange,
  onRoleFilterChange,
  onMapFilterChange,
  onKillerFiltersChange,
  onSurvivorFiltersChange,
  onPageChange,
}: {
  matches: readonly MatchHistoryEntry[];
  mmrByMatchId: ReadonlyMap<string, MmrEvent>;
  totalMatches: number;
  allMatchCount: number;
  syncing: boolean;
  statusMessage: string | null;
  queueFilter: QueueFilter;
  roleFilter: RoleFilter;
  mapFilter: string;
  killerFilters: readonly string[];
  survivorFilters: readonly string[];
  maps: readonly string[];
  killers: readonly string[];
  survivors: readonly string[];
  page: number;
  pageCount: number;
  onQueueFilterChange: (value: QueueFilter) => void;
  onRoleFilterChange: (value: RoleFilter) => void;
  onMapFilterChange: (value: string) => void;
  onKillerFiltersChange: (value: string[]) => void;
  onSurvivorFiltersChange: (value: string[]) => void;
  onPageChange: (value: number) => void;
}) {
  return <section className="statistics-history-section" aria-label="Historique des parties">
    <div className="statistics-history-toolbar">
      <div className="statistics-filter-grid">
        <label className="statistics-filter-field">
          <span>Mode</span>
          <select value={queueFilter} onChange={(event) => onQueueFilterChange(event.target.value as QueueFilter)}>
            <option value="all">Tous</option>
            <option value="1v4">1vs4</option>
            <option value="2v8">2vs8</option>
          </select>
        </label>
        <label className="statistics-filter-field">
          <span>Camp</span>
          <select value={roleFilter} onChange={(event) => onRoleFilterChange(event.target.value as RoleFilter)}>
            <option value="all">Tous</option>
            <option value="killer">Game tueur</option>
            <option value="survivor">Game survivant</option>
          </select>
        </label>
        <label className="statistics-filter-field">
          <span>Map</span>
          <select value={mapFilter} onChange={(event) => onMapFilterChange(event.target.value)}>
            <option value="all">Toutes</option>
            {maps.map((mapName) => <option value={mapName} key={mapName}>{mapName}</option>)}
          </select>
        </label>
        <CharacterFilter label="Tueur présent" options={killers} selected={killerFilters} onChange={onKillerFiltersChange} />
        <CharacterFilter label="Survivant présent" options={survivors} selected={survivorFilters} onChange={onSurvivorFiltersChange} />
      </div>
      <div className="statistics-history-summary">
        <span className="statistics-chip">{totalMatches} résultat{totalMatches > 1 ? "s" : ""} filtré{totalMatches > 1 ? "s" : ""}</span>
        <span className="statistics-chip">Page {page} / {pageCount}</span>
        {allMatchCount !== totalMatches && <span className="statistics-chip">{allMatchCount} au total</span>}
      </div>
    </div>

    {matches.length === 0
      ? <p className="statistics-empty">{syncing
        ? statusMessage ?? "Synchronisation de l’historique en cours."
        : "Aucune partie ne correspond à ces filtres."}</p>
      : <>
          <PaginationControls page={page} pageCount={pageCount} onPageChange={onPageChange} />
          <div className="statistics-history-list">
            {matches.map((match) => <MatchHistoryCard match={match} mmr={mmrByMatchId.get(match.id)} key={match.id} />)}
          </div>
          <PaginationControls page={page} pageCount={pageCount} onPageChange={onPageChange} />
        </>}
  </section>;
}

function PaginationControls({ page, pageCount, onPageChange }: { page: number; pageCount: number; onPageChange: (value: number) => void }) {
  if (pageCount <= 1) return null;
  return <div className="statistics-pagination" aria-label="Pagination de l’historique des parties">
    <button className="secondary-button" type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Page précédente</button>
    <strong>{page} / {pageCount}</strong>
    <button className="secondary-button" type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>Page suivante</button>
  </div>;
}

function MatchHistoryCard({ match, mmr }: { match: MatchHistoryEntry; mmr: MmrEvent | undefined }) {
  const [selected, setSelected] = useState<{ match: MatchHistoryEntry; available: boolean } | null>(null);
  const loadout = classifyLoadout(match);
  const survivorResultIconUrl = match.role === "survivor" ? survivorOutcomeIconUrl(match.resultLabel) : null;
  const mvp = isMvpMatch(match);

  return <article className={`statistics-match-card role-${match.role}`}>
    <button type="button" className="statistics-match-identity" aria-label={`Voir l’équipement de ${match.characterName}`} onClick={() => setSelected({ match, available: true })}>
      <div className="statistics-match-portrait">
        {match.characterImageUrl ? <img src={match.characterImageUrl} alt={match.characterName} loading="lazy" /> : <span>{initial(match.characterName)}</span>}
        {match.resultLabel && <span className={`statistics-match-result${survivorResultIconUrl ? " with-icon" : ""}`}>{survivorResultIconUrl ? <><img src={survivorResultIconUrl} alt={match.resultLabel} loading="lazy" /><span className="sr-only">{match.resultLabel}</span></> : match.resultLabel}</span>}
      </div>
      <div className="statistics-match-copy">
        <div className="statistics-match-name-row"><strong>{match.characterName}</strong>{mvp && <span className="statistics-mvp-badge" title={match.role === "killer" ? "Tous les survivants ont été éliminés" : "Meilleur score survivant"}>★ MVP</span>}</div>
        <span className="statistics-match-score-label">Score</span>
        <span className="statistics-match-score">{formatScore(match.score)}</span>
        <span className="statistics-match-role">{roleLabel(match.role)}</span>
        {mmr && <span className={`statistics-match-mmr ${mmr.delta > 0 ? "positive" : mmr.delta < 0 ? "negative" : "neutral"}`} title={mmr.reason}>
          {formatMmrDelta(mmr.delta)} MMR · {mmr.before} → {mmr.after}
        </span>}
      </div>
    </button>

    <MatchLoadout match={match} loadout={loadout} />

    <div className="statistics-match-participants" aria-label="Participants adverses ou alliés">
      {match.participants.map((participant, index) => <ParticipantCard participant={participant} key={`${match.id}-participant-${index}`} onClick={() => setSelected({
        available: participant.perkIconUrls !== undefined && participant.equipmentIconUrls !== undefined,
        match: { ...match, characterName: participant.name ?? "Participant", characterImageUrl: participant.imageUrl, role: participant.role, score: participant.score, resultLabel: participant.resultLabel, durationLabel: participant.survivalTimeLabel, perkIconUrls: participant.perkIconUrls ?? [], perkIconLabels: participant.perkIconLabels ?? [], equipmentIconUrls: participant.equipmentIconUrls ?? [], equipmentIconLabels: participant.equipmentIconLabels ?? [] },
      })} />)}
    </div>

    <div className="statistics-match-map">
      <div className="statistics-map-thumb">
        {match.mapImageUrl ? <img src={match.mapImageUrl} alt={match.mapName ?? "Carte"} loading="lazy" /> : <span>{initial(match.mapName ?? "?")}</span>}
      </div>
      <span className="statistics-map-name">{match.mapName ?? "Carte inconnue"}</span>
    </div>

    <div className="statistics-match-meta">
      <time dateTime={match.playedAt ?? undefined}>{match.playedAtLabel ?? "Date inconnue"}</time>
      <strong className="statistics-match-duration">{match.durationLabel ?? "--:--"}</strong>
      <span className="statistics-match-source">Ajouté le {formatTimestamp(match.importedAt)}</span>
    </div>
    {selected && <ParticipantDetails match={selected.match} available={selected.available} onClose={() => setSelected(null)} />}
  </article>;
}

function ParticipantDetails({ match, available, onClose }: { match: MatchHistoryEntry; available: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const outcome = match.role === "survivor" ? survivorOutcomeIconUrl(match.resultLabel) : null;
  return <dialog ref={dialog} className="statistics-player-dialog" aria-labelledby="statistics-player-title" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
    <div className="statistics-player-content">
      <header className="statistics-player-header">
        {match.characterImageUrl && <img className="statistics-player-portrait" src={match.characterImageUrl} alt="" />}
        <div><span className="eyebrow">{roleLabel(match.role)}</span><h2 id="statistics-player-title">{match.characterName}</h2><p>{formatScore(match.score)} points {match.durationLabel && `· ${match.durationLabel}`}</p></div>
        {outcome && <img className="statistics-player-outcome" src={outcome} alt={match.resultLabel ?? "Résultat"} />}
        <button className="secondary-button" type="button" onClick={() => dialog.current?.close()} aria-label="Fermer les détails">✕</button>
      </header>
      <p className="statistics-player-context">{match.mapName} · {match.playedAtLabel}</p>
      {available ? <MatchLoadout match={match} loadout={classifyLoadout(match)} /> : <p className="statistics-sync-note">L’équipement de ce participant sera récupéré lors de la prochaine synchronisation.</p>}
    </div>
  </dialog>;
}

function MatchLoadout({ match, loadout }: { match: MatchHistoryEntry; loadout: MatchLoadoutSummary }) {
  const hasEquipment = Boolean(loadout.power || loadout.item || loadout.addons.length || loadout.offering);
  return <div className="statistics-match-loadout" aria-label="Loadout de la partie">
    {loadout.roles.length > 0 && <LoadoutGroup title={match.queueLabel === "2v8" ? "Rôles" : "Classes"} icons={loadout.roles} />}
    {loadout.perks.length > 0 && <LoadoutGroup title="Perks" icons={loadout.perks} perk />}
    {loadout.perks.length > 0 && hasEquipment && <span className="statistics-loadout-divider" aria-hidden="true" />}
    {loadout.power && <LoadoutGroup title="Pouvoir" icons={[loadout.power]} />}
    {loadout.item && <LoadoutGroup title="Objet" icons={[loadout.item]} />}
    {loadout.addons.length > 0 && <LoadoutGroup title="Accessoires" icons={loadout.addons} />}
    {loadout.offering && <LoadoutGroup title="Offrande" icons={[loadout.offering]} />}
    {loadout.roles.length === 0 && loadout.perks.length === 0 && !hasEquipment && <span className="statistics-chip">Aucun équipement détecté</span>}
  </div>;
}

function MmrPanel({
  events,
  mode,
  range,
  killer,
  onModeChange,
  onRangeChange,
  onKillerChange,
}: {
  events: readonly MmrEvent[];
  mode: MmrMode;
  range: MmrRange;
  killer: string;
  onModeChange: (value: MmrMode) => void;
  onRangeChange: (value: MmrRange) => void;
  onKillerChange: (value: string) => void;
}) {
  const killerOptions = [...new Set(events.filter((event) => event.mode === mode && event.killerName).map((event) => event.killerName!))]
    .sort((left, right) => left.localeCompare(right, "fr"));
  const selectedKiller = mode.endsWith("killer") ? (killerOptions.includes(killer) ? killer : killerOptions[0] ?? "") : "";
  const series = events.filter((event) => event.mode === mode && (!selectedKiller || event.killerName === selectedKiller));
  const points = buildMmrChartPoints(series, range);
  const currentMmr = series.at(-1)?.after ?? INITIAL_MMR;

  return <section className="statistics-mmr-section" aria-label="Évolution du MMR">
    <div className="statistics-mmr-toolbar">
      <div className="statistics-mmr-filters">
        <label className="statistics-filter-field">
          <span>Mode de jeu</span>
          <select value={mode} onChange={(event) => onModeChange(event.target.value as MmrMode)}>
            <option value="1v4-survivor">1vs4 survivant</option>
            <option value="2v8-survivor">2vs8 survivant</option>
            <option value="1v4-killer">1vs4 tueur</option>
            <option value="2v8-killer">2vs8 tueur</option>
          </select>
        </label>
        {mode.endsWith("killer") && <label className="statistics-filter-field">
          <span>Tueur</span>
          <select value={selectedKiller} disabled={killerOptions.length === 0} onChange={(event) => onKillerChange(event.target.value)}>
            {killerOptions.length === 0 && <option value="">Aucun tueur enregistré</option>}
            {killerOptions.map((name) => <option value={name} key={name}>{name}</option>)}
          </select>
        </label>}
        <label className="statistics-filter-field">
          <span>Échelle de temps</span>
          <select value={range} onChange={(event) => onRangeChange(event.target.value as MmrRange)}>
            <option value="7d">7 derniers jours</option>
            <option value="30d">30 derniers jours</option>
            <option value="90d">90 derniers jours</option>
            <option value="all">Tout l’historique</option>
          </select>
        </label>
      </div>
      <div className="statistics-mmr-current">
        <span>MMR actuel</span>
        <strong>{currentMmr}</strong>
        <small>{selectedKiller || mmrModeLabel(mode)} · départ {INITIAL_MMR}</small>
      </div>
    </div>
    {series.length === 0
      ? <p className="statistics-empty">Aucune partie enregistrée pour {mmrModeLabel(mode).toLowerCase()}.</p>
      : points.length < 2
        ? <p className="statistics-empty">Aucune partie sur cette période. Élargissez l’échelle de temps.</p>
        : <MmrChart points={points} />}
  </section>;
}

function CharacterFilter({ label, options, selected, onChange }: { label: string; options: readonly string[]; selected: readonly string[]; onChange: (value: string[]) => void }) {
  return <div className="statistics-filter-field statistics-character-filter">
    <span>{label}</span>
    <details>
      <summary>{selected.length === 0 ? "Tous" : `${selected.length} sélectionné${selected.length > 1 ? "s" : ""}`}</summary>
      <div className="statistics-character-options">
        {selected.length > 0 && <button type="button" onClick={() => onChange([])}>Tout effacer</button>}
        {options.map((name) => <label key={name}>
          <input
            type="checkbox"
            checked={selected.includes(name)}
            onChange={() => onChange(selected.includes(name) ? selected.filter((entry) => entry !== name) : [...selected, name])}
          />
          <span>{name}</span>
        </label>)}
      </div>
    </details>
  </div>;
}

interface MmrChartPoint {
  at: number;
  rating: number;
  event: MmrEvent | null;
}

function MmrChart({ points }: { points: readonly MmrChartPoint[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const width = 900;
  const height = 330;
  const plot = { left: 62, right: 20, top: 22, bottom: 46 };
  const minTime = points[0]?.at ?? 0;
  const maxTime = points.at(-1)?.at ?? minTime + 1;
  const span = Math.max(1, maxTime - minTime);
  const ratings = points.map((point) => point.rating);
  const minMmr = Math.floor((Math.min(...ratings) - 18) / 9) * 9;
  const maxMmr = Math.ceil((Math.max(...ratings) + 18) / 9) * 9;
  const mmrSpan = Math.max(9, maxMmr - minMmr);
  const x = (at: number) => plot.left + ((at - minTime) / span) * (width - plot.left - plot.right);
  const y = (rating: number) => plot.top + ((maxMmr - rating) / mmrSpan) * (height - plot.top - plot.bottom);
  const coordinates = points.map((point) => ({ x: x(point.at), y: y(point.rating) }));
  const active = hovered === null ? null : points[hovered] ?? null;
  const activeCoordinates = hovered === null ? null : coordinates[hovered] ?? null;
  const yTicks = Array.from({ length: 5 }, (_, index) => Math.round(maxMmr - (mmrSpan * index) / 4));
  const xTicks = [minTime, minTime + span / 2, maxTime];

  return <div className="statistics-mmr-chart-wrap">
    <svg
      className="statistics-mmr-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Courbe du MMR dans le temps"
      onPointerLeave={() => setHovered(null)}
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const pointerX = ((event.clientX - bounds.left) / bounds.width) * width;
        let nearest = 0;
        for (let index = 1; index < coordinates.length; index += 1) {
          if (Math.abs((coordinates[index]?.x ?? 0) - pointerX) < Math.abs((coordinates[nearest]?.x ?? 0) - pointerX)) nearest = index;
        }
        setHovered(nearest);
      }}
    >
      <text className="statistics-mmr-axis-title" x="16" y="18">MMR</text>
      {yTicks.map((tick) => <g key={tick}>
        <line className="statistics-mmr-grid-line" x1={plot.left} x2={width - plot.right} y1={y(tick)} y2={y(tick)} />
        <text className="statistics-mmr-axis-label" x={plot.left - 10} y={y(tick) + 4} textAnchor="end">{tick}</text>
      </g>)}
      {xTicks.map((tick, index) => <text className="statistics-mmr-axis-label" x={x(tick)} y={height - 16} textAnchor={index === 0 ? "start" : index === 2 ? "end" : "middle"} key={tick}>{formatMmrDate(tick)}</text>)}
      <polyline className="statistics-mmr-line" points={coordinates.map((point) => `${point.x},${point.y}`).join(" ")} />
      {coordinates.map((point, index) => <circle className="statistics-mmr-point" cx={point.x} cy={point.y} r="3" key={`${points[index]?.at}-${index}`} />)}
      {active && activeCoordinates && <g>
        <line className="statistics-mmr-cursor" x1={activeCoordinates.x} x2={activeCoordinates.x} y1={plot.top} y2={height - plot.bottom} />
        <circle className="statistics-mmr-point active" cx={activeCoordinates.x} cy={activeCoordinates.y} r="6" />
        <g transform={`translate(${Math.min(width - 204, Math.max(plot.left, activeCoordinates.x - 92))},${Math.max(plot.top, activeCoordinates.y - 72)})`}>
          <rect className="statistics-mmr-tooltip" width="184" height="54" rx="6" />
          <text className="statistics-mmr-tooltip-value" x="10" y="21">{active.rating} MMR</text>
          <text className="statistics-mmr-tooltip-date" x="10" y="41">{formatMmrDateTime(active.at)}{active.event ? ` · ${formatMmrDelta(active.event.delta)}` : " · départ"}</text>
        </g>
      </g>}
    </svg>
    <span className="statistics-mmr-x-title">Temps</span>
  </div>;
}

function buildMmrChartPoints(events: readonly MmrEvent[], range: MmrRange): MmrChartPoint[] {
  if (events.length === 0) return [];
  const first = events[0]!;
  const days = range === "all" ? null : Number.parseInt(range, 10);
  const cutoff = days === null ? Date.parse(first.at) - 60_000 : Date.now() - days * 86_400_000;
  const visible = events.filter((event) => Date.parse(event.at) >= cutoff);
  if (visible.length === 0) return [];
  const firstVisible = visible[0]!;
  const previous = events[events.indexOf(firstVisible) - 1];
  const baseline = previous?.after ?? firstVisible.before;
  const baselineAt = days === null ? Math.min(cutoff, Date.parse(firstVisible.at) - 60_000) : cutoff;
  return [
    { at: baselineAt, rating: baseline, event: null },
    ...visible.map((event) => ({ at: Date.parse(event.at), rating: event.after, event })),
  ];
}

function LoadoutGroup({ title, icons, perk = false }: { title: string; icons: readonly LoadoutAsset[]; perk?: boolean }) {
  return <div className="statistics-loadout-group-card" data-kind={title.toLowerCase()}>
    <span className="sr-only">{title}</span>
    <div className="statistics-loadout-group">
      {icons.map((icon, index) => <IconTile iconUrl={icon.url} key={`${title}-${index}-${icon.url}`} label={icon.label} perk={perk} />)}
    </div>
  </div>;
}

function ParticipantCard({ participant, onClick }: { participant: MatchHistoryParticipant; onClick: () => void }) {
  const statusLabel = participant.resultLabel ?? (participant.role === "survivor" ? "Sacrificed" : "-");
  const statusIconUrl = participant.role === "survivor" ? survivorOutcomeIconUrl(statusLabel) : null;

  return <button type="button" className="statistics-participant-card" onClick={onClick} aria-label={`Voir l’équipement de ${participant.name ?? "ce participant"}`} data-tone={participantTone(statusLabel)} title={participant.name ?? undefined}>
    <div className="statistics-participant-portrait">
      {participant.imageUrl ? <img src={participant.imageUrl} alt={participant.name ?? statusLabel} loading="lazy" /> : <span>?</span>}
    </div>
    {participant.name && <span className="statistics-participant-name">{participant.name}</span>}
    <span className="statistics-participant-score">{participant.valueLabel ?? formatScore(participant.score)}</span>
    {participant.survivalTimeLabel && participant.survivalTimeLabel !== participant.valueLabel && <span className="statistics-participant-time">{participant.survivalTimeLabel}</span>}
    <span className="statistics-participant-status">{statusIconUrl ? <><img src={statusIconUrl} alt={statusLabel} loading="lazy" /><span className="sr-only">{statusLabel}</span></> : statusLabel}</span>
  </button>;
}

function IconTile({ iconUrl, label, perk = false }: { iconUrl: string; label: string; perk?: boolean }) {
  return <span className={`statistics-loadout-icon${perk ? " perk" : ""}`} title={label} data-label={label} aria-label={label}>{iconUrl ? <img src={iconUrl} alt="" loading="lazy" /> : <span>?</span>}</span>;
}

function SyncStatusPanel({ status, syncing }: { status: StatisticsStatus | null; syncing: boolean }) {
  const logs = status?.logs ?? [];
  return <section className={`statistics-sync-panel${syncing ? " active" : ""}`} aria-label="État de la synchronisation des statistiques">
    <div className="statistics-sync-header">
      <strong>{syncing ? "Synchronisation en cours" : status?.phase === "error" ? "Dernière synchronisation en erreur" : "État de la synchronisation"}</strong>
      <span className={`statistics-sync-badge phase-${status?.phase ?? "idle"}`}>{status?.phase ?? "idle"}</span>
    </div>
    <p className="statistics-sync-message">{status?.message ?? "Aucune synchronisation des statistiques en cours."}</p>
    {status?.startedAt && <p className="statistics-sync-meta">Démarrée le {formatTimestamp(status.startedAt)}{status.finishedAt ? ` · Terminée le ${formatTimestamp(status.finishedAt)}` : ""}</p>}
    {logs.length > 0 && <ol className="statistics-sync-log">{logs.map((entry) => <li key={`${entry.at}-${entry.message}`}><time dateTime={entry.at}>{formatTime(entry.at)}</time><span>{entry.message}</span></li>)}</ol>}
  </section>;
}

interface LoadoutAsset {
  url: string;
  label: string;
}

interface MatchLoadoutSummary {
  roles: LoadoutAsset[];
  perks: LoadoutAsset[];
  power: LoadoutAsset | null;
  item: LoadoutAsset | null;
  addons: LoadoutAsset[];
  offering: LoadoutAsset | null;
}

function classifyLoadout(match: MatchHistoryEntry): MatchLoadoutSummary {
  const equipment = match.equipmentIconUrls.map((url, index) => ({ url, label: match.equipmentIconLabels[index] ?? labelFromAssetUrl(url) }));
  const roles = equipment.filter((asset) => isRoleIconUrl(asset.url));
  const items = equipment.filter((asset) => isItemIconUrl(asset.url));
  const addons = equipment.filter((asset) => isAddonIconUrl(asset.url)).slice(0, 2);
  const offering = equipment.find((asset) => isOfferingIconUrl(asset.url)) ?? null;
  const queueIs2v8 = match.queueLabel === "2v8" || roles.length > 0;
  return {
    roles,
    perks: queueIs2v8 ? [] : match.perkIconUrls.slice(0, 4).map((url, index) => ({ url, label: match.perkIconLabels[index] ?? labelFromAssetUrl(url) })),
    power: match.role === "killer" ? items[0] ?? null : null,
    item: match.role === "survivor" ? items[0] ?? null : null,
    addons,
    offering,
  };
}

function labelFromAssetUrl(url: string): string {
  const filename = decodeURIComponent(url.split("/").at(-1)?.split("?")[0] ?? "Équipement").replace(/\.[^.]+$/, "");
  if (/\/characterClasses\//i.test(url) && filename === "Tactician") return "Guide";
  return filename
    .replace(/[_-]+/g, " ")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim() || "Équipement";
}

function matchesQueueFilter(match: MatchHistoryEntry, filter: QueueFilter): boolean {
  if (filter === "all") return true;
  return filter === "2v8" ? match.queueLabel === "2v8" : match.queueLabel !== "2v8";
}

function matchesRoleFilter(match: MatchHistoryEntry, filter: RoleFilter): boolean {
  return filter === "all" ? true : match.role === filter;
}

function matchesMapFilter(match: MatchHistoryEntry, filter: string): boolean {
  return filter === "all" ? true : match.mapName === filter;
}

function characterOptions(matches: readonly MatchHistoryEntry[], role: "killer" | "survivor"): string[] {
  return [...new Set(matches.flatMap((match) => charactersInMatch(match, role)))].sort((left, right) => left.localeCompare(right, "fr"));
}

function matchesCharacterFilter(match: MatchHistoryEntry, role: "killer" | "survivor", selected: readonly string[]): boolean {
  return selected.length === 0 || charactersInMatch(match, role).some((name) => selected.includes(name));
}

function charactersInMatch(match: MatchHistoryEntry, role: "killer" | "survivor"): string[] {
  return [
    ...(match.role === role ? [match.characterName] : []),
    ...match.participants.flatMap((participant) => participant.role === role && participant.name ? [participant.name] : []),
  ];
}

function hasSnapshotContent(snapshot: StatisticsSnapshot | null): boolean {
  return Boolean(snapshot?.statistics) || (snapshot?.matchHistory.length ?? 0) > 0;
}

function participantTone(resultLabel: string | null): "escaped" | "dead" | "neutral" {
  if (!resultLabel) return "neutral";
  return /escaped/i.test(resultLabel) ? "escaped" : /dead|killed|sacrificed|mori|disconnected/i.test(resultLabel) ? "dead" : "neutral";
}

function roleLabel(role: MatchHistoryEntry["role"]): string {
  return role === "killer" ? "Game tueur" : role === "survivor" ? "Game survivant" : "Rôle indéterminé";
}

function survivorOutcomeIconUrl(label: string | null): string | null {
  if (!label) return null;
  return /escaped/i.test(label) ? ESCAPED_ICON_URL : /dead|killed|sacrificed|mori|disconnected/i.test(label) ? SACRIFICED_ICON_URL : null;
}

function isRoleIconUrl(url: string): boolean {
  return /\/characterClasses\//i.test(url);
}

function isOfferingIconUrl(url: string): boolean {
  return /\/offerings\//i.test(url);
}

function isItemIconUrl(url: string): boolean {
  return /\/items\//i.test(url);
}

function isAddonIconUrl(url: string): boolean {
  return /\/add-ons\//i.test(url);
}

function formatScore(value: number | null): string {
  return value === null ? "-" : new Intl.NumberFormat("en-US").format(value);
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("fr", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("fr", { timeStyle: "medium" }).format(new Date(value));
}

function formatMmrDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatMmrDate(value: number): string {
  return new Intl.DateTimeFormat("fr", { day: "2-digit", month: "short" }).format(new Date(value));
}

function formatMmrDateTime(value: number): string {
  return new Intl.DateTimeFormat("fr", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function mmrModeLabel(mode: MmrMode): string {
  return mode.replace("1v4", "1vs4").replace("2v8", "2vs8").replace("survivor", "survivant").replace("killer", "tueur");
}

function shortSourceLabel(tab: StatisticsTab): string {
  return tab === "history" || tab === "mmr" ? "stats.deadbydaylight.com/match-history" : "stats.deadbydaylight.com/statistics";
}

function initial(value: string): string {
  return value.trim().charAt(0).toUpperCase() || "?";
}
