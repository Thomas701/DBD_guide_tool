import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { killers, perks } from "./app/catalog.js";
import { MAX_BUILD_PERKS, type Build } from "./domain/build.js";
import type { Killer } from "./domain/killer.js";
import { BuildAnalyzer } from "./features/build-analyzer/BuildAnalyzer.js";
import { BuildConditions } from "./features/build-analyzer/BuildConditions.js";
import { BuildAssistant } from "./features/build-assistant/BuildAssistant.js";
import { BuildEditor } from "./features/build-editor/BuildEditor.js";
import { BuildSummary } from "./features/build-summary/BuildSummary.js";
import { SelectedKillerCard } from "./features/build-workspace/SelectedKillerCard.js";
import { KillerSelector } from "./features/killer-selector/KillerSelector.js";
import { PerkInspectorPanel } from "./features/perk-browser/PerkInspectorPanel.js";
import { PerkBrowser } from "./features/perk-browser/PerkBrowser.js";
import { SavedBuilds } from "./features/saved-builds/SavedBuilds.js";
import {
  DESCRIPTION_OVERRIDES_STORAGE_KEY,
  LocalDescriptionOverrideRepository
} from "./services/description-overrides.js";
import { BUILDS_STORAGE_KEY, LocalBuildRepository } from "./services/build-repository.js";
import { ASSISTANT_SERVER_STORAGE_KEY, normalizeServerUrl } from "./services/assistant-provider.js";
import { APP_SESSION_STORAGE_KEY, DEFAULT_APP_SESSION, readAppSession, type AppSession, type AppView } from "./services/app-session.js";
import {
  calculateBuild,
  collectBuildConditions,
  perkNeedsRuntimeState,
  type BuildScenario,
  type PerkRuntimeState
} from "./services/build-calculator.js";
import { createCurrentBuildExport, syncCurrentBuildFile } from "./services/local-data.js";

type TopbarMenu = "help" | "settings" | null;
const DEFAULT_PANE_LAYOUT = DEFAULT_APP_SESSION.paneLayout;
const DEFAULT_SIDEBAR_LAYOUT = DEFAULT_APP_SESSION.sidebarLayout;
const DEFAULT_ASSISTANT_SERVER = import.meta.env.VITE_ASSISTANT_SERVER_URL
  ?? import.meta.env.VITE_OPENAI_ASSISTANT_ENDPOINT
  ?? "http://127.0.0.1:8787";

export default function App() {
  const [initialSession] = useState(loadPersistedAppSession);
  const [activeView, setActiveView] = useState<AppView>(initialSession.activeView);
  const [topbarMenu, setTopbarMenu] = useState<TopbarMenu>(null);
  const [selectedKillerId, setSelectedKillerId] = useState<string | null>(initialSession.selectedKillerId);
  const [selectedPerkId, setSelectedPerkId] = useState<string | null>(initialSession.selectedPerkId);
  const [equippedPerkIds, setEquippedPerkIds] = useState<string[]>(initialSession.equippedPerkIds);
  const [activeBuildId, setActiveBuildId] = useState<string | null>(initialSession.activeBuildId);
  const [buildName, setBuildName] = useState(initialSession.buildName);
  const [conversationKey, setConversationKey] = useState(initialSession.conversationKey);
  const [savedBuilds, setSavedBuilds] = useState<Build[]>([]);
  const [descriptionRepositoryState] = useState(createDescriptionOverrideRepository);
  const [descriptionOverrides, setDescriptionOverrides] = useState<Record<string, string>>(descriptionRepositoryState.overrides);
  const [repositoryState] = useState(createBuildRepository);
  const [repositoryMessage, setRepositoryMessage] = useState<string | null>(null);
  const [canResetStorage, setCanResetStorage] = useState(false);
  const [scenario, setScenario] = useState<BuildScenario>(initialSession.scenario);
  const [paneLayout, setPaneLayout] = useState(initialSession.paneLayout);
  const [sidebarLayout, setSidebarLayout] = useState(initialSession.sidebarLayout);
  const workspaceRef = useRef<HTMLElement>(null);
  const buildRepository = repositoryState.repository;
  const descriptionOverrideRepository = descriptionRepositoryState.repository;
  const selectedKiller = selectedKillerId ? killers.find((killer) => killer.id === selectedKillerId) ?? null : null;
  const selectedPerk = selectedPerkId ? perks.find((perk) => perk.id === selectedPerkId) ?? null : null;
  const selectedPerkOwner = selectedPerk?.characterId ? killers.find((killer) => killer.id === selectedPerk.characterId) ?? null : null;
  const equippedPerks = useMemo(() => equippedPerkIds.flatMap((id) => {
    const perk = perks.find((candidate) => candidate.id === id);
    return perk ? [perk] : [];
  }), [equippedPerkIds]);
  const calculation = useMemo(
    () => selectedKiller ? calculateBuild({ killer: selectedKiller, perks: equippedPerks, scenario }) : null,
    [selectedKiller, equippedPerks, scenario]
  );
  const currentBuildExport = useMemo(() => createCurrentBuildExport({
    activeBuildId,
    buildName,
    killer: selectedKiller,
    perks: equippedPerks,
    scenario,
    calculation
  }), [activeBuildId, buildName, selectedKiller, equippedPerks, scenario, calculation]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const session: AppSession = { activeView, selectedKillerId, selectedPerkId, equippedPerkIds, activeBuildId, buildName, conversationKey, scenario, paneLayout, sidebarLayout };
      try { window.localStorage.setItem(APP_SESSION_STORAGE_KEY, JSON.stringify(session)); } catch { /* Reprise indisponible si le navigateur bloque le stockage. */ }
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [activeView, selectedKillerId, selectedPerkId, equippedPerkIds, activeBuildId, buildName, conversationKey, scenario, paneLayout, sidebarLayout]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void syncCurrentBuildFile(currentAssistantServerUrl(), currentBuildExport).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [currentBuildExport]);

  useEffect(() => {
    const missingConditions = collectBuildConditions(equippedPerks).filter((condition) => !(condition in scenario.conditions));
    const missingRuntimePerks = equippedPerks.filter(perkNeedsRuntimeState).filter((perk) => !(perk.id in scenario.perkStates));
    if (missingConditions.length === 0 && missingRuntimePerks.length === 0) return;
    setScenario((current) => ({
      ...current,
      conditions: { ...current.conditions, ...Object.fromEntries(missingConditions.map((condition) => [condition, true])) },
      perkStates: { ...current.perkStates, ...Object.fromEntries(missingRuntimePerks.map((perk) => [perk.id, "active" as const])) }
    }));
  }, [equippedPerkIds]);

  useEffect(() => {
    refreshSavedBuilds();
    const syncBuilds = (event: StorageEvent): void => {
      if (event.key === BUILDS_STORAGE_KEY || event.key === null) refreshSavedBuilds();
    };
    const syncDescriptionOverrides = (event: StorageEvent): void => {
      if (event.key === DESCRIPTION_OVERRIDES_STORAGE_KEY || event.key === null) {
        setDescriptionOverrides(descriptionOverrideRepository.list());
      }
    };
    window.addEventListener("storage", syncBuilds);
    window.addEventListener("storage", syncDescriptionOverrides);
    return () => {
      window.removeEventListener("storage", syncBuilds);
      window.removeEventListener("storage", syncDescriptionOverrides);
    };
  }, [buildRepository, descriptionOverrideRepository]);

  const defaultName = selectedKiller ? defaultBuildName(selectedKiller) : "";
  const activeSavedBuild = activeBuildId ? savedBuilds.find((build) => build.id === activeBuildId) ?? null : null;
  const hasUnsavedBuildChanges = activeSavedBuild !== null
    && isBuildDirty(activeSavedBuild, selectedKillerId, buildName, equippedPerkIds);
  const visibleRepositoryMessage = [repositoryState.warning, repositoryMessage]
    .filter((message): message is string => message !== null)
    .join(" ") || null;

  function selectKiller(killer: Killer): void {
    if (killer.id !== selectedKillerId) {
      setSelectedKillerId(killer.id);
      setSelectedPerkId(null);
      setEquippedPerkIds([]);
      setActiveBuildId(null);
      setBuildName(defaultBuildName(killer));
      setRepositoryMessage(null);
      setScenario(emptyScenario());
      setConversationKey(newConversationKey("draft"));
    }
    setActiveView("killers");
  }

  function refreshSavedBuilds(): void {
    try {
      const builds = buildRepository.list();
      setSavedBuilds(builds);
      setActiveBuildId((current) => current && !builds.some((build) => build.id === current) ? null : current);
      setCanResetStorage(false);
    } catch (error) {
      setRepositoryMessage(errorMessage(error));
      setCanResetStorage(repositoryState.persistent);
    }
  }

  function saveBuild(): void {
    if (!selectedKiller) return;
    try {
      const draft = { name: buildName, killerId: selectedKiller.id, perkIds: equippedPerkIds };
      const saved = activeBuildId ? buildRepository.update(activeBuildId, draft) : buildRepository.create(draft);
      if (!activeBuildId) rememberBuildConversation(saved.id, conversationKey);
      setActiveBuildId(saved.id);
      setBuildName(saved.name);
      setSavedBuilds(buildRepository.list());
      setRepositoryMessage(repositoryState.persistent
        ? activeBuildId ? "Build mis à jour." : "Build sauvegardé."
        : activeBuildId ? "Build mis à jour pour cette session." : "Build conservé pour cette session.");
    } catch (error) {
      setRepositoryMessage(errorMessage(error));
    }
  }

  function saveBuildAs(): void {
    if (!selectedKiller) return;
    try {
      const saved = buildRepository.create({ name: buildName, killerId: selectedKiller.id, perkIds: equippedPerkIds });
      rememberBuildConversation(saved.id, conversationKey);
      setActiveBuildId(saved.id);
      setBuildName(saved.name);
      setSavedBuilds(buildRepository.list());
      setRepositoryMessage(repositoryState.persistent ? "Nouvelle copie sauvegardée." : "Nouvelle copie conservée pour cette session.");
    } catch (error) {
      setRepositoryMessage(errorMessage(error));
    }
  }

  function startNewBuild(): void {
    if (!selectedKiller) return;
    setActiveBuildId(null);
    setBuildName(defaultBuildName(selectedKiller));
    setEquippedPerkIds([]);
    setScenario(emptyScenario());
    setConversationKey(newConversationKey("draft"));
    setRepositoryMessage("Nouveau build prêt.");
  }

  function loadBuild(build: Build): void {
    const killer = killers.find((candidate) => candidate.id === build.killerId);
    if (!killer) {
      setRepositoryMessage(`Impossible de charger « ${build.name} » : tueur absent du catalogue.`);
      return;
    }
    const knownPerkIds = build.perkIds.filter((id) => perks.some((perk) => perk.id === id));
    const missingPerkCount = build.perkIds.length - knownPerkIds.length;
    setSelectedKillerId(killer.id);
    setEquippedPerkIds(knownPerkIds);
    setActiveBuildId(missingPerkCount === 0 ? build.id : null);
    setBuildName(missingPerkCount === 0 ? build.name : `${build.name} (récupéré)`);
    setScenario(emptyScenario());
    setConversationKey(missingPerkCount === 0 ? buildConversationKey(build.id) : newConversationKey("recovered"));
    setActiveView("build");
    setRepositoryMessage(missingPerkCount === 0
      ? `Build « ${build.name} » chargé.`
      : `Build chargé avec ${missingPerkCount} perk absente. L’original est préservé ; sauvegardez une copie récupérée.`);
  }

  function duplicateBuild(build: Build): void {
    try {
      const duplicate = buildRepository.duplicate(build.id, `${build.name} (copie)`);
      setSavedBuilds(buildRepository.list());
      setSelectedKillerId(duplicate.killerId);
      setEquippedPerkIds([...duplicate.perkIds]);
      setActiveBuildId(duplicate.id);
      setBuildName(duplicate.name);
      setScenario(emptyScenario());
      setConversationKey(`build:${duplicate.id}`);
      setActiveView("build");
      setRepositoryMessage(`Build dupliqué sous « ${duplicate.name} ».`);
    } catch (error) {
      setRepositoryMessage(errorMessage(error));
    }
  }

  function deleteBuild(build: Build): void {
    try {
      const deleted = buildRepository.delete(build.id);
      if (!deleted) {
        setRepositoryMessage(`Le build « ${build.name} » avait déjà été supprimé.`);
        refreshSavedBuilds();
        return;
      }
      if (activeBuildId === build.id) setActiveBuildId(null);
      forgetBuildConversation(build.id);
      setSavedBuilds(buildRepository.list());
      setRepositoryMessage(`Build « ${build.name} » supprimé.`);
    } catch (error) {
      setRepositoryMessage(errorMessage(error));
    }
  }

  function resetStorage(): void {
    if (!window.confirm("Effacer le stockage illisible des builds ? Cette action est irréversible.")) return;
    try {
      buildRepository.clear();
      setSavedBuilds([]);
      setActiveBuildId(null);
      setCanResetStorage(false);
      setRepositoryMessage("Stockage réinitialisé. Vous pouvez à nouveau sauvegarder des builds.");
    } catch (error) {
      setRepositoryMessage(errorMessage(error));
    }
  }

  function setScenarioCondition(condition: string, active: boolean): void {
    setScenario((current) => {
      const conditions = { ...current.conditions, [condition]: active };
      const opposite = OPPOSITE_CONDITIONS.get(condition);
      if (active && opposite) conditions[opposite] = false;
      return { ...current, conditions };
    });
  }

  function setPerkRuntimeState(perkId: string, state: PerkRuntimeState): void {
    setScenario((current) => ({ ...current, perkStates: { ...current.perkStates, [perkId]: state } }));
  }

  function togglePerk(perkId: string): void {
    setEquippedPerkIds((current) => {
      if (current.includes(perkId)) return current.filter((id) => id !== perkId);
      return current.length < MAX_BUILD_PERKS ? [...current, perkId] : current;
    });
  }

  function saveDescriptionOverride(perkId: string, html: string): void {
    setDescriptionOverrides(descriptionOverrideRepository.update(perkId, html));
  }

  function resetDescriptionOverride(perkId: string): void {
    setDescriptionOverrides(descriptionOverrideRepository.delete(perkId));
  }

  function resizeColumn(pane: "left" | "right", delta: number): void {
    const width = workspaceRef.current?.clientWidth ?? 1;
    const change = delta / width * 100;
    setPaneLayout((current) => pane === "left"
      ? { ...current, left: clamp(current.left + change, 14, 68 - current.right) }
      : { ...current, right: clamp(current.right - change, 18, 68 - current.left) });
  }

  function resizeCenter(delta: number): void {
    const height = workspaceRef.current?.querySelector<HTMLElement>(".analyzer-main-column")?.clientHeight ?? 1;
    setPaneLayout((current) => ({ ...current, center: clamp(current.center + delta / height * 100, 30, 70) }));
  }

  function resizeSidebar(pane: keyof typeof DEFAULT_SIDEBAR_LAYOUT, delta: number): void {
    const [minimum, maximum]: [number, number] = pane === "rightTop" ? [190, 620] : pane === "killer" ? [150, 360] : [170, 520];
    setSidebarLayout((current) => ({ ...current, [pane]: clamp(current[pane] + delta, minimum, maximum) }));
  }

  const workspaceStyle = {
    "--left-pane": `${paneLayout.left}%`,
    "--right-pane": `${paneLayout.right}%`,
    "--impact-pane": `${paneLayout.center}%`,
    "--left-killer-pane": `${sidebarLayout.killer}px`,
    "--left-perks-pane": `${sidebarLayout.perks}px`,
    "--right-top-pane": `${sidebarLayout.rightTop}px`
  } as CSSProperties;

  return (
    <div className="app-shell">
      <Topbar
        activeView={activeView}
        menu={topbarMenu}
        savedBuildCount={savedBuilds.length}
        hasBuild={selectedKiller !== null}
        onViewChange={(view) => { setActiveView(view); setTopbarMenu(null); }}
        onMenuChange={setTopbarMenu}
        onResetScenario={() => setScenario(emptyScenario())}
      />

      <main className={`analyzer-workspace view-${activeView}`} ref={workspaceRef} style={workspaceStyle}>
        <aside className="analyzer-sidebar left-sidebar">
          <SelectedKillerCard killer={selectedKiller} onChange={() => setActiveView("killers")} />
          <ResizeHandle orientation="horizontal" label="Redimensionner le tueur sélectionné et les perks" onDelta={(delta) => resizeSidebar("killer", delta)} onReset={() => setSidebarLayout(DEFAULT_SIDEBAR_LAYOUT)} />
          <BuildEditor perks={equippedPerks} onRemove={togglePerk} onClear={() => setEquippedPerkIds([])} onBrowse={() => setActiveView("perks")} />
          <ResizeHandle orientation="horizontal" label="Redimensionner les perks et les conditions" onDelta={(delta) => resizeSidebar("perks", delta)} onReset={() => setSidebarLayout(DEFAULT_SIDEBAR_LAYOUT)} />
          <BuildConditions perks={equippedPerks} scenario={scenario} onConditionChange={setScenarioCondition} onPerkStateChange={setPerkRuntimeState} onReset={() => setScenario(emptyScenario())} />
        </aside>

        <ResizeHandle orientation="vertical" label="Redimensionner la sidebar gauche" onDelta={(delta) => resizeColumn("left", delta)} onReset={() => setPaneLayout(DEFAULT_PANE_LAYOUT)} />

        <div className={`analyzer-main-column ${activeView === "build" ? "build-view" : "catalog-view"}`}>
          {activeView === "build" && (
            <>
              {selectedKiller && calculation
                ? <BuildAnalyzer calculation={calculation} perks={equippedPerks} />
                : <EmptyCenterPanel title="Impact Analysis" action="Choisir un tueur" onAction={() => setActiveView("killers")}>Sélectionnez un tueur pour commencer l’analyse.</EmptyCenterPanel>}
              <ResizeHandle orientation="horizontal" label="Redimensionner l’analyse et l’assistant" onDelta={resizeCenter} onReset={() => setPaneLayout(DEFAULT_PANE_LAYOUT)} />
              {selectedKiller && calculation
                ? <BuildAssistant conversationKey={conversationKey} killer={selectedKiller} perks={equippedPerks} scenario={scenario} calculation={calculation} currentBuild={currentBuildExport} />
                : <EmptyCenterPanel title="Build Assistant">L’assistant sera disponible dès qu’un tueur aura été sélectionné.</EmptyCenterPanel>}
            </>
          )}

          {activeView === "killers" && (
            <section className="analyzer-panel impact-analysis workspace-catalog-panel killers-workspace-panel">
              <KillerSelector killers={killers} selectedKillerId={selectedKillerId} onSelect={selectKiller} />
            </section>
          )}

          {activeView === "perks" && (
            <section className="analyzer-panel impact-analysis workspace-catalog-panel perks-workspace-panel">
              {!selectedKiller && <p className="catalog-notice">Sélectionnez un tueur avant d’ajouter des perks au build.</p>}
              <PerkBrowser
                perks={perks}
                killers={killers}
                equippedPerkIds={equippedPerkIds}
                canEquip={selectedKiller !== null}
                selectedPerkId={selectedPerkId}
                onSelectPerk={setSelectedPerkId}
                onTogglePerk={togglePerk}
              />
            </section>
          )}
        </div>

        <ResizeHandle orientation="vertical" label="Redimensionner la sidebar droite" onDelta={(delta) => resizeColumn("right", delta)} onReset={() => setPaneLayout(DEFAULT_PANE_LAYOUT)} />

        <aside className="analyzer-sidebar right-sidebar">
          {activeView === "perks" && selectedPerk ? (
            <PerkInspectorPanel
              perk={selectedPerk}
              owner={selectedPerkOwner}
              descriptionOverride={descriptionOverrides[selectedPerk.id] ?? null}
              canEquip={selectedKiller !== null}
              isEquipped={equippedPerkIds.includes(selectedPerk.id)}
              buildIsFull={equippedPerkIds.length >= MAX_BUILD_PERKS}
              onClose={() => setSelectedPerkId(null)}
              onResetDescriptionOverride={resetDescriptionOverride}
              onSaveDescriptionOverride={saveDescriptionOverride}
              onTogglePerk={togglePerk}
            />
          ) : (
            <SavedBuilds
              builds={savedBuilds}
              activeBuildId={activeBuildId}
              buildName={buildName}
              buildNamePlaceholder={defaultName}
              hasUnsavedChanges={hasUnsavedBuildChanges}
              canResetStorage={canResetStorage}
              canEdit={selectedKiller !== null}
              onNameChange={setBuildName}
              onSave={saveBuild}
              onSaveAs={saveBuildAs}
              onNew={startNewBuild}
              onLoad={loadBuild}
              onDelete={deleteBuild}
              onResetStorage={resetStorage}
            />
          )}
          <ResizeHandle orientation="horizontal" label="Redimensionner le panneau supérieur et le résumé" onDelta={(delta) => resizeSidebar("rightTop", delta)} onReset={() => setSidebarLayout(DEFAULT_SIDEBAR_LAYOUT)} />
          {calculation
            ? <BuildSummary calculation={calculation} perks={equippedPerks} scenario={scenario} />
            : <section className="analyzer-panel build-summary"><div className="compact-section-heading"><div><span className="section-icon" aria-hidden="true">▤</span><h2>Build Summary</h2></div></div><p className="panel-empty">Aucun build à résumer.</p></section>}
        </aside>
      </main>
    </div>
  );
}

function EmptyCenterPanel({ title, action, onAction, children }: {
  title: string;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`analyzer-panel ${title === "Build Assistant" ? "build-assistant" : "impact-analysis"}`}>
      <div className="compact-section-heading"><div><span className="section-icon" aria-hidden="true">{title === "Build Assistant" ? "▣" : "⌾"}</span><h2>{title}</h2></div></div>
      <div className="empty-center-content">
        <p>{children}</p>
        {action && onAction && <button className="primary-button" type="button" onClick={onAction}>{action}</button>}
      </div>
    </section>
  );
}

function ResizeHandle({ orientation, label, onDelta, onReset }: {
  orientation: "horizontal" | "vertical";
  label: string;
  onDelta: (delta: number) => void;
  onReset: () => void;
}) {
  const previousPosition = useRef<number | null>(null);
  const position = (event: PointerEvent<HTMLDivElement>): number => orientation === "vertical" ? event.clientX : event.clientY;

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    previousPosition.current = position(event);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (previousPosition.current === null) return;
    const next = position(event);
    onDelta(next - previousPosition.current);
    previousPosition.current = next;
  }

  function handleKeyboard(event: KeyboardEvent<HTMLDivElement>): void {
    const delta = orientation === "vertical"
      ? event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0
      : event.key === "ArrowUp" ? -16 : event.key === "ArrowDown" ? 16 : 0;
    if (delta === 0) return;
    event.preventDefault();
    onDelta(delta);
  }

  return (
    <div
      className={`resize-handle ${orientation}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      title="Glisser pour redimensionner · Double-cliquer pour réinitialiser"
      onDoubleClick={onReset}
      onKeyDown={handleKeyboard}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => { previousPosition.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { previousPosition.current = null; }}
    ><span /></div>
  );
}

function Topbar({
  activeView,
  menu,
  savedBuildCount,
  hasBuild,
  onViewChange,
  onMenuChange,
  onResetScenario
}: {
  activeView: AppView;
  menu: TopbarMenu;
  savedBuildCount: number;
  hasBuild: boolean;
  onViewChange: (view: AppView) => void;
  onMenuChange: (menu: TopbarMenu) => void;
  onResetScenario: () => void;
}) {
  return (
    <header className="site-header analyzer-topbar">
      <button className="brand" type="button" onClick={() => onViewChange("build")}>
        <span className="brand-mark" aria-hidden="true">Ⅳ</span>
        <span>Build Analyzer</span>
      </button>
      <nav className="main-navigation" aria-label="Navigation principale">
        {(["build", "killers", "perks"] as AppView[]).map((view) => (
          <button className={activeView === view ? "active" : ""} type="button" onClick={() => onViewChange(view)} aria-current={activeView === view ? "page" : undefined} key={view}>
            <span aria-hidden="true">{view === "build" ? "⌘" : view === "killers" ? "☠" : "◇"}</span>
            {view[0]?.toUpperCase()}{view.slice(1)}
          </button>
        ))}
      </nav>
      <div className="topbar-actions">
        <button type="button" onClick={() => onMenuChange(menu === "help" ? null : "help")} aria-label="Aide" aria-expanded={menu === "help"}>?</button>
        <button type="button" onClick={() => onMenuChange(menu === "settings" ? null : "settings")} aria-label="Paramètres" aria-expanded={menu === "settings"}>⚙</button>
      </div>
      {menu && (
        <div className="topbar-popover" role="status">
          {menu === "help" ? (
            <><strong>Aide rapide</strong><p>Choisissez un tueur, équipez jusqu’à quatre perks, puis activez les conditions à simuler.</p></>
          ) : (
            <><strong>Paramètres du build</strong><p>{savedBuildCount} build(s) sauvegardé(s) localement.</p><button className="secondary-button compact-button" type="button" onClick={onResetScenario} disabled={!hasBuild}>Réinitialiser les conditions</button></>
          )}
        </div>
      )}
    </header>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erreur inconnue lors de la sauvegarde.";
}

function defaultBuildName(killer: Killer): string {
  return `${killer.name.fr ?? killer.name.en ?? killer.id} — Build`;
}

function emptyScenario(): BuildScenario {
  return { conditions: { not_in_chase: true }, perkStates: {} };
}

function newConversationKey(prefix: string): string {
  const id = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${id}`;
}

const BUILD_CONVERSATIONS_STORAGE_KEY = "dbd-build-tool.assistant-build-keys";

function rememberBuildConversation(buildId: string, conversationKey: string): void {
  try {
    const mappings = readBuildConversations();
    window.localStorage.setItem(BUILD_CONVERSATIONS_STORAGE_KEY, JSON.stringify({ ...mappings, [buildId]: conversationKey }));
  } catch {
    // La conversation courante reste disponible en mémoire si le stockage est bloqué.
  }
}

function buildConversationKey(buildId: string): string {
  try {
    return readBuildConversations()[buildId] ?? `build:${buildId}`;
  } catch {
    return `build:${buildId}`;
  }
}

function forgetBuildConversation(buildId: string): void {
  try {
    const mappings = readBuildConversations();
    delete mappings[buildId];
    window.localStorage.setItem(BUILD_CONVERSATIONS_STORAGE_KEY, JSON.stringify(mappings));
  } catch {
    // Aucune incidence sur la suppression du build lui-même.
  }
}

function readBuildConversations(): Record<string, string> {
  const raw = window.localStorage.getItem(BUILD_CONVERSATIONS_STORAGE_KEY);
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function isBuildDirty(build: Build, selectedKillerId: string | null, buildName: string, equippedPerkIds: readonly string[]): boolean {
  return build.killerId !== selectedKillerId || build.name !== buildName || !sameValuesInOrder(build.perkIds, equippedPerkIds);
}

function sameValuesInOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

const OPPOSITE_CONDITIONS = new Map([
  ["in_chase", "not_in_chase"],
  ["not_in_chase", "in_chase"],
  ["inside_terror_radius", "outside_terror_radius"],
  ["outside_terror_radius", "inside_terror_radius"]
]);

function createBuildRepository(): { repository: LocalBuildRepository; persistent: boolean; warning: string | null } {
  try {
    const storage = window.localStorage;
    storage.getItem(BUILDS_STORAGE_KEY);
    return { repository: new LocalBuildRepository(storage), persistent: true, warning: null };
  } catch {
    return { repository: new LocalBuildRepository(createMemoryStorage()), persistent: false, warning: "Stockage local indisponible : les builds seront conservés seulement pour cette session." };
  }
}

function createDescriptionOverrideRepository(): { repository: LocalDescriptionOverrideRepository; overrides: Record<string, string> } {
  try {
    const storage = window.localStorage;
    storage.getItem(DESCRIPTION_OVERRIDES_STORAGE_KEY);
    const repository = new LocalDescriptionOverrideRepository(storage);
    return { repository, overrides: repository.list() };
  } catch {
    const repository = new LocalDescriptionOverrideRepository(createMemoryStorage());
    return { repository, overrides: {} };
  }
}

function createMemoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  };
}

function loadPersistedAppSession(): AppSession {
  try {
    return readAppSession(
      window.localStorage.getItem(APP_SESSION_STORAGE_KEY),
      new Set(killers.map((killer) => killer.id)),
      new Set(perks.map((perk) => perk.id))
    );
  } catch {
    return readAppSession(null, new Set(), new Set());
  }
}

function currentAssistantServerUrl(): string {
  try {
    return normalizeServerUrl(window.localStorage.getItem(ASSISTANT_SERVER_STORAGE_KEY) ?? DEFAULT_ASSISTANT_SERVER);
  } catch {
    return normalizeServerUrl(DEFAULT_ASSISTANT_SERVER);
  }
}
