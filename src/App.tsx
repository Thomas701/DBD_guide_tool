import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import howToPlayText from "../partie_dbd.txt?raw";
import fixedStatisticsText from "../statistiques_fixe.txt?raw";

import { appLogoUrl, killerPortraitUrl, killerTerrorRadiusUrl, killerThemeUrl, originalKillerThemeUrl, perkIconUrl } from "./app/assets.js";
import { killers, perks } from "./app/catalog.js";
import { MAX_BUILD_PERKS, type Build } from "./domain/build.js";
import type { PerkCategory } from "./domain/category.js";
import { KILLER_TIERS, type Killer, type KillerTier } from "./domain/killer.js";
import type { Perk } from "./domain/perk.js";
import { BuildAnalyzer } from "./features/build-analyzer/BuildAnalyzer.js";
import { BuildAssistant } from "./features/build-assistant/BuildAssistant.js";
import { BuildEditor } from "./features/build-editor/BuildEditor.js";
import { BuildSummary } from "./features/build-summary/BuildSummary.js";
import { SelectedKillerCard } from "./features/build-workspace/SelectedKillerCard.js";
import { KillerSelector } from "./features/killer-selector/KillerSelector.js";
import { PerkInspectorPanel } from "./features/perk-browser/PerkInspectorPanel.js";
import { PerkBrowser } from "./features/perk-browser/PerkBrowser.js";
import { PerkFiltersPanel } from "./features/perk-browser/PerkFiltersPanel.js";
import { SavedBuilds } from "./features/saved-builds/SavedBuilds.js";
import {
  CATEGORY_OVERRIDES_STORAGE_KEY,
  DESCRIPTION_OVERRIDES_STORAGE_KEY,
  LocalCategoryOverrideRepository,
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
import { createCurrentBuildExport, syncCurrentBuildFile, updateNativePerk } from "./services/local-data.js";
import { DEFAULT_KILLER_OPTIONS, type KillerListOptions } from "./services/killer-selector.js";
import { DEFAULT_PERK_FILTERS, type PerkFilters } from "./services/perk-filter.js";
import { killerPowerDescription } from "./services/killer-powers.js";

type TopbarMenu = "help" | "settings" | null;
type InstallState = "available" | "unsupported" | "installed";
type CatalogView = Extract<AppView, "killers" | "perks">;
const DEFAULT_PANE_LAYOUT = DEFAULT_APP_SESSION.paneLayout;
const DEFAULT_ASSISTANT_SERVER = import.meta.env.VITE_ASSISTANT_SERVER_URL
  ?? import.meta.env.VITE_OPENAI_ASSISTANT_ENDPOINT
  ?? "http://127.0.0.1:8787";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export default function App() {
  const [initialSession] = useState(loadPersistedAppSession);
  const [activeView, setActiveView] = useState<AppView>(initialSession.activeView);
  const [topbarMenu, setTopbarMenu] = useState<TopbarMenu>(null);
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(initialSession.soundEnabled);
  const [musicVolume, setMusicVolume] = useState(initialSession.musicVolume);
  const [killerInfo, setKillerInfo] = useState<Killer | null>(null);
  const [selectedKillerId, setSelectedKillerId] = useState<string | null>(initialSession.selectedKillerId);
  const [selectedPerkId, setSelectedPerkId] = useState<string | null>(initialSession.selectedPerkId);
  const [equippedPerkIds, setEquippedPerkIds] = useState<string[]>(initialSession.equippedPerkIds);
  const [activeBuildId, setActiveBuildId] = useState<string | null>(initialSession.activeBuildId);
  const [buildName, setBuildName] = useState(initialSession.buildName);
  const [conversationKey, setConversationKey] = useState(initialSession.conversationKey);
  const [catalogPerks, setCatalogPerks] = useState<Perk[]>(() => perks);
  const [perkFilters, setPerkFilters] = useState<PerkFilters>({ ...DEFAULT_PERK_FILTERS, categories: [] });
  const [killerOptions, setKillerOptions] = useState<KillerListOptions>({ ...DEFAULT_KILLER_OPTIONS });
  const [killerListView, setKillerListView] = useState(false);
  const [killerFiltersVisible, setKillerFiltersVisible] = useState(true);
  const [perkFilterDetailsOpen, setPerkFilterDetailsOpen] = useState({ characters: false, categories: false });
  const [savedBuilds, setSavedBuilds] = useState<Build[]>([]);
  const [descriptionRepositoryState] = useState(createDescriptionOverrideRepository);
  const [descriptionOverrides, setDescriptionOverrides] = useState<Record<string, string>>(descriptionRepositoryState.overrides);
  const [categoryRepositoryState] = useState(createCategoryOverrideRepository);
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, PerkCategory[]>>(categoryRepositoryState.overrides);
  const [repositoryState] = useState(createBuildRepository);
  const [repositoryMessage, setRepositoryMessage] = useState<string | null>(null);
  const [canResetStorage, setCanResetStorage] = useState(false);
  const [scenario, setScenario] = useState<BuildScenario>(initialSession.scenario);
  const [paneLayout, setPaneLayout] = useState(initialSession.paneLayout);
  const [sidebarLayout] = useState(initialSession.sidebarLayout);
  const [installState, setInstallState] = useState<InstallState>(detectInstallState);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallingApp, setIsInstallingApp] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const killerThemeAudioRef = useRef<HTMLAudioElement | null>(null);
  const originalThemeAudioRef = useRef<HTMLAudioElement | null>(null);
  const themePlaybackRequestRef = useRef(0);
  const terrorRadiusAudioRef = useRef<HTMLAudioElement | null>(null);
  const killerCatalogRef = useRef<HTMLElement>(null);
  const perkCatalogRef = useRef<HTMLElement>(null);
  const previousViewRef = useRef<AppView | null>(null);
  const catalogScrollPositionsRef = useRef({ ...initialSession.catalogScrollPositions });
  const buildRepository = repositoryState.repository;
  const descriptionOverrideRepository = descriptionRepositoryState.repository;
  const categoryOverrideRepository = categoryRepositoryState.repository;
  const effectivePerks = useMemo(() => catalogPerks.map((perk) => Object.hasOwn(categoryOverrides, perk.id)
    ? { ...perk, categories: categoryOverrides[perk.id] ?? [] }
    : perk
  ), [catalogPerks, categoryOverrides]);
  const selectedKiller = selectedKillerId ? killers.find((killer) => killer.id === selectedKillerId) ?? null : null;
  const selectedNativePerk = selectedPerkId ? catalogPerks.find((perk) => perk.id === selectedPerkId) ?? null : null;
  const selectedPerk = selectedPerkId ? effectivePerks.find((perk) => perk.id === selectedPerkId) ?? null : null;
  const selectedPerkOwner = selectedPerk?.characterId ? killers.find((killer) => killer.id === selectedPerk.characterId) ?? null : null;
  const equippedPerks = useMemo(() => equippedPerkIds.flatMap((id) => {
    const perk = effectivePerks.find((candidate) => candidate.id === id);
    return perk ? [perk] : [];
  }), [equippedPerkIds, effectivePerks]);
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
    killerThemeAudioRef.current = new Audio();
    originalThemeAudioRef.current = new Audio();
    terrorRadiusAudioRef.current = new Audio();
    return () => [killerThemeAudioRef, originalThemeAudioRef, terrorRadiusAudioRef].forEach(({ current }) => current?.pause());
  }, []);

  useEffect(() => {
    [killerThemeAudioRef.current, originalThemeAudioRef.current, terrorRadiusAudioRef.current].forEach((audio) => {
      if (!audio) return;
      audio.volume = musicVolume;
      if (!soundEnabled) audio.pause();
    });
  }, [soundEnabled, musicVolume]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const session: AppSession = {
        activeView,
        soundEnabled,
        musicVolume,
        selectedKillerId,
        selectedPerkId,
        equippedPerkIds,
        activeBuildId,
        buildName,
        conversationKey,
        scenario,
        paneLayout,
        sidebarLayout,
        catalogScrollPositions: { ...catalogScrollPositionsRef.current }
      };
      try { window.localStorage.setItem(APP_SESSION_STORAGE_KEY, JSON.stringify(session)); } catch { /* Reprise indisponible si le navigateur bloque le stockage. */ }
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [activeView, soundEnabled, musicVolume, selectedKillerId, selectedPerkId, equippedPerkIds, activeBuildId, buildName, conversationKey, scenario, paneLayout, sidebarLayout]);

  useEffect(() => {
    const previousView = previousViewRef.current;
    previousViewRef.current = activeView;
    if (previousView === activeView && previousView !== null) return;
    if (activeView === "killers") {
      const frame = window.requestAnimationFrame(() => restoreCatalogScroll("killers"));
      return () => window.cancelAnimationFrame(frame);
    }
    if (activeView === "perks" && selectedPerkId === null) {
      const frame = window.requestAnimationFrame(() => restoreCatalogScroll("perks"));
      return () => window.cancelAnimationFrame(frame);
    }
  }, [activeView, selectedPerkId]);

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
    const syncCategoryOverrides = (event: StorageEvent): void => {
      if (event.key === CATEGORY_OVERRIDES_STORAGE_KEY || event.key === null) {
        setCategoryOverrides(categoryOverrideRepository.list());
      }
    };
    window.addEventListener("storage", syncBuilds);
    window.addEventListener("storage", syncDescriptionOverrides);
    window.addEventListener("storage", syncCategoryOverrides);
    return () => {
      window.removeEventListener("storage", syncBuilds);
      window.removeEventListener("storage", syncDescriptionOverrides);
      window.removeEventListener("storage", syncCategoryOverrides);
    };
  }, [buildRepository, categoryOverrideRepository, descriptionOverrideRepository]);

  const defaultName = selectedKiller ? defaultBuildName(selectedKiller) : "";
  const activeSavedBuild = activeBuildId ? savedBuilds.find((build) => build.id === activeBuildId) ?? null : null;
  const hasUnsavedBuildChanges = activeSavedBuild !== null
    && isBuildDirty(activeSavedBuild, selectedKillerId, buildName, equippedPerkIds);
  const visibleRepositoryMessage = [repositoryState.warning, repositoryMessage]
    .filter((message): message is string => message !== null)
    .join(" ") || null;

  useEffect(() => {
    const handleSaveShortcut = (event: globalThis.KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      saveBuild();
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [activeBuildId, buildName, conversationKey, equippedPerkIds, selectedKiller, repositoryState.persistent]);

  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const syncInstallState = (): void => {
      setInstallState(isStandaloneApp() ? "installed" : (current) => current === "available" ? current : "unsupported");
    };
    const handleBeforeInstallPrompt = (event: Event): void => {
      const prompt = event as BeforeInstallPromptEvent;
      prompt.preventDefault();
      setInstallPromptEvent(prompt);
      setInstallState(isStandaloneApp() ? "installed" : "available");
    };
    const handleInstalled = (): void => {
      setInstallPromptEvent(null);
      setInstallState("installed");
      setIsInstallingApp(false);
    };
    syncInstallState();
    media.addEventListener("change", syncInstallState);
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt as EventListener);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      media.removeEventListener("change", syncInstallState);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt as EventListener);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  function selectKiller(killer: Killer): void {
    runUiTransition(() => {
      if (killer.id !== selectedKillerId) {
        setSelectedKillerId(killer.id);
        if (!buildName) setBuildName(defaultBuildName(killer));
        setRepositoryMessage(null);
      }
      setActiveView("killers");
      setTopbarMenu(null);
      stopTerrorRadius();
      void playKillerTheme(killer);
    });
  }

  function removeKiller(): void {
    runUiTransition(() => {
      setSelectedKillerId(null);
      setActiveView("killers");
      setTopbarMenu(null);
      stopTerrorRadius();
      killerThemeAudioRef.current?.pause();
      if (killerThemeAudioRef.current) killerThemeAudioRef.current.currentTime = 0;
      originalThemeAudioRef.current?.pause();
      if (originalThemeAudioRef.current) originalThemeAudioRef.current.currentTime = 0;
      void playOriginalKillerTheme();
    });
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
    const knownPerkIds = build.perkIds.filter((id) => catalogPerks.some((perk) => perk.id === id));
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

  function saveCategoryOverride(perkId: string, categories: readonly PerkCategory[]): void {
    setCategoryOverrides(categoryOverrideRepository.update(perkId, categories));
  }

  function resetCategoryOverride(perkId: string): void {
    setCategoryOverrides(categoryOverrideRepository.delete(perkId));
  }

  async function saveNativePerkChanges(perkId: string, changes: { descriptionHtml?: string; categories?: readonly PerkCategory[] }): Promise<void> {
    try {
      const updated = await updateNativePerk(currentAssistantServerUrl(), perkId, changes);
      setCatalogPerks((current) => current.map((perk) => perk.id === updated.id ? updated : perk));
      setRepositoryMessage("Source native de la perk mise à jour.");
    } catch (error) {
      setRepositoryMessage(errorMessage(error));
      throw error;
    }
  }

  function browsePerk(perkId: string | null): void {
    runUiTransition(() => {
      if (perkId === null) {
        setSelectedPerkId(null);
        setActiveView("perks");
        setTopbarMenu(null);
        return;
      }

      setSelectedPerkId((current) => current === perkId ? null : perkId);
    });
  }

  function showView(view: AppView): void {
    runUiTransition(() => {
      if (view === "constants") {
        themePlaybackRequestRef.current += 1;
        stopTerrorRadius();
        killerThemeAudioRef.current?.pause();
        originalThemeAudioRef.current?.pause();
      } else if (activeView === "constants" && selectedKiller) {
        void playKillerTheme(selectedKiller);
      }
      setActiveView(view);
      setTopbarMenu(null);
    });
  }

  function selectPerk(perkId: string | null): void {
    runUiTransition(() => {
      setSelectedPerkId(perkId);
    });
  }

  async function playKillerTheme(killer: Killer): Promise<void> {
    if (!soundEnabled) return;
    const request = ++themePlaybackRequestRef.current;
    const theme = killerThemeAudioRef.current;
    if (!theme) return;
    killerThemeAudioRef.current?.pause();
    originalThemeAudioRef.current?.pause();
    const url = await killerThemeUrl(killer.id);
    if (request !== themePlaybackRequestRef.current) return;
    if (!url) {
      void playOriginalKillerTheme(request);
      return;
    }
    theme.pause();
    theme.loop = false;
    theme.src = url;
    theme.onended = () => { if (request === themePlaybackRequestRef.current) void playOriginalKillerTheme(request); };
    void theme.play().catch(() => undefined);
  }

  async function playOriginalKillerTheme(request = ++themePlaybackRequestRef.current): Promise<void> {
    if (!soundEnabled) return;
    const url = await originalKillerThemeUrl();
    if (request !== themePlaybackRequestRef.current) return;
    if (!url) return;
    const original = originalThemeAudioRef.current;
    if (!original) return;
    killerThemeAudioRef.current?.pause();
    original.src = url;
    original.loop = true;
    void original.play().catch(() => undefined);
  }

  function stopTerrorRadius(): void {
    const audio = terrorRadiusAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }

  function pauseThemeMusic(): void {
    killerThemeAudioRef.current?.pause();
    originalThemeAudioRef.current?.pause();
  }

  function resumeThemeMusic(): void {
    if (!soundEnabled) return;
    const activeTheme = killerThemeAudioRef.current;
    if (activeTheme?.src && activeTheme.currentTime < activeTheme.duration) {
      void activeTheme.play().catch(() => undefined);
      return;
    }
    void playOriginalKillerTheme();
  }

  function updatePerkFilters(filters: PerkFilters): void {
    setSelectedPerkId(null);
    setPerkFilters(filters);
  }

  function updatePerkFilterDetailsOpen(detail: "characters" | "categories", open: boolean): void {
    setSelectedPerkId(null);
    setPerkFilterDetailsOpen((current) => ({ ...current, [detail]: open }));
  }

  function rememberCatalogScroll(view: CatalogView, scrollTop: number): void {
    catalogScrollPositionsRef.current[view] = scrollTop;
  }

  function restoreCatalogScroll(view: CatalogView): void {
    const panel = view === "killers" ? killerCatalogRef.current : perkCatalogRef.current;
    panel?.scrollTo({ top: catalogScrollPositionsRef.current[view], behavior: "auto" });
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

  async function installApplication(): Promise<void> {
    if (!installPromptEvent || installState === "installed" || isInstallingApp) return;
    setIsInstallingApp(true);
    try {
      await installPromptEvent.prompt();
      const choice = await installPromptEvent.userChoice.catch(() => null);
      setInstallState(choice?.outcome === "accepted" ? "installed" : detectInstallState());
    } finally {
      setInstallPromptEvent(null);
      setIsInstallingApp(false);
    }
  }

  const canInstallApplication = installState === "available" && installPromptEvent !== null && !isInstallingApp;

  const workspaceStyle = {
    "--left-pane": `${paneLayout.left}%`,
    "--right-pane": `${paneLayout.right}%`,
    "--impact-pane": `${paneLayout.center}%`
  } as CSSProperties;

  return (
    <div className="app-shell">
      <Topbar
        activeView={activeView}
        menu={topbarMenu}
        savedBuildCount={savedBuilds.length}
        hasBuild={selectedKiller !== null}
        installState={installState}
        canInstallApplication={canInstallApplication}
        isInstallingApplication={isInstallingApp}
        onInstallApplication={() => { void installApplication(); }}
        onViewChange={showView}
        onMenuChange={setTopbarMenu}
        onHelp={() => setHowToPlayOpen(true)}
        onResetScenario={() => setScenario(emptyScenario())}
      />
      {topbarMenu === "settings" && <SettingsModal soundEnabled={soundEnabled} volume={musicVolume} onSoundEnabledChange={setSoundEnabled} onVolumeChange={setMusicVolume} onClose={() => setTopbarMenu(null)} />}
      {howToPlayOpen && <HowToPlayModal onClose={() => setHowToPlayOpen(false)} />}
      {killerInfo && <KillerInfoModal killer={killerInfo} killers={killers} onClose={() => setKillerInfo(null)} />}

      {activeView === "constants" ? <ConstantsView /> : activeView === "tiers" ? <TierListView killers={killers} perks={catalogPerks} /> : <main className={`analyzer-workspace view-${activeView}`} ref={workspaceRef} style={workspaceStyle}>
        <aside className={`analyzer-sidebar left-sidebar${activeView === "perks" ? " perks-sidebar" : ""}`}>
          <section className={`analyzer-panel selected-loadout-panel${activeView === "perks" ? " perks-loadout-panel" : ""}`} aria-label="Tueur et perks sélectionnés">
            <SelectedKillerCard killer={selectedKiller} onChange={() => showView("killers")} onRemove={removeKiller} onTerrorRadiusStart={pauseThemeMusic} onTerrorRadiusStop={resumeThemeMusic} onShowInfo={setKillerInfo} />
            <div className="build-editor-scroll-region">
              <BuildEditor perks={equippedPerks} selectedPerkId={selectedPerkId} compact={activeView === "perks"} onRemove={togglePerk} onBrowse={browsePerk} scenario={scenario} onConditionChange={setScenarioCondition} onPerkStateChange={setPerkRuntimeState} />
            </div>
          </section>
          <PerkFiltersPanel killers={killers} filters={perkFilters} detailsOpen={perkFilterDetailsOpen} onChange={updatePerkFilters} onDetailsOpenChange={updatePerkFilterDetailsOpen} />
        </aside>

        <ResizeHandle orientation="vertical" label="Redimensionner la sidebar gauche" onDelta={(delta) => resizeColumn("left", delta)} onReset={() => setPaneLayout(DEFAULT_PANE_LAYOUT)} />

        <div className={`analyzer-main-column ${activeView === "build" ? "build-view" : "catalog-view"}`}>
          {activeView === "build" && (
            <>
              {selectedKiller && calculation
                ? <BuildAnalyzer calculation={calculation} perks={equippedPerks} />
                : <EmptyCenterPanel title="Impact Analysis" action="Choisir un tueur" onAction={() => showView("killers")}>Sélectionnez un tueur pour commencer l’analyse.</EmptyCenterPanel>}
              <ResizeHandle orientation="horizontal" label="Redimensionner l’analyse et l’assistant" onDelta={resizeCenter} onReset={() => setPaneLayout(DEFAULT_PANE_LAYOUT)} />
              {selectedKiller && calculation
                ? <BuildAssistant conversationKey={conversationKey} killer={selectedKiller} perks={equippedPerks} scenario={scenario} calculation={calculation} currentBuild={currentBuildExport} allKillers={killers} allPerks={effectivePerks} howToPlay={howToPlayText} constants={fixedStatisticsText} perkDescriptionOverrides={descriptionOverrides} />
                : <EmptyCenterPanel title="Build Assistant">L’assistant sera disponible dès qu’un tueur aura été sélectionné.</EmptyCenterPanel>}
            </>
          )}

          {activeView === "killers" && (
            <section
              className="analyzer-panel impact-analysis workspace-catalog-panel killers-workspace-panel"
              ref={killerCatalogRef}
              onScroll={(event) => rememberCatalogScroll("killers", event.currentTarget.scrollTop)}
            >
              <KillerSelector killers={killers} selectedKillerId={selectedKillerId} options={killerOptions} listView={killerListView} filtersVisible={killerFiltersVisible} onOptionsChange={setKillerOptions} onListViewChange={setKillerListView} onFiltersVisibleChange={setKillerFiltersVisible} onShowInfo={setKillerInfo} onSelect={selectKiller} />
            </section>
          )}

          {activeView === "perks" && (
            <section
              className="analyzer-panel impact-analysis workspace-catalog-panel perks-workspace-panel"
              ref={perkCatalogRef}
              onScroll={(event) => rememberCatalogScroll("perks", event.currentTarget.scrollTop)}
            >
              {!selectedKiller && <p className="catalog-notice">Sélectionnez un tueur avant d’ajouter des perks au build.</p>}
              <PerkBrowser
                perks={effectivePerks}
                killers={killers}
                filters={perkFilters}
                equippedPerkIds={equippedPerkIds}
                canEquip={selectedKiller !== null}
                selectedPerkId={selectedPerkId}
                scrollToPerkId={selectedPerkId}
                onFiltersChange={updatePerkFilters}
                onSelectPerk={selectPerk}
                onTogglePerk={togglePerk}
              />
            </section>
          )}
        </div>

        <ResizeHandle orientation="vertical" label="Redimensionner la sidebar droite" onDelta={(delta) => resizeColumn("right", delta)} onReset={() => setPaneLayout(DEFAULT_PANE_LAYOUT)} />

        <aside className="analyzer-sidebar right-sidebar">
          {selectedPerk ? (
            <PerkInspectorPanel
              perk={selectedPerk}
              owner={selectedPerkOwner}
              descriptionOverride={descriptionOverrides[selectedPerk.id] ?? null}
              categoryOverride={Object.hasOwn(categoryOverrides, selectedPerk.id) ? categoryOverrides[selectedPerk.id] ?? [] : null}
              nativeCategories={selectedNativePerk?.categories ?? selectedPerk.categories}
              canEquip={selectedKiller !== null}
              isEquipped={equippedPerkIds.includes(selectedPerk.id)}
              buildIsFull={equippedPerkIds.length >= MAX_BUILD_PERKS}
              onClose={() => selectPerk(null)}
              onResetDescriptionOverride={resetDescriptionOverride}
              onSaveDescriptionOverride={saveDescriptionOverride}
              onSaveNativeDescription={(perkId, html) => saveNativePerkChanges(perkId, { descriptionHtml: html })}
              onResetCategoryOverride={resetCategoryOverride}
              onSaveCategoryOverride={saveCategoryOverride}
              onSaveNativeCategories={(perkId, categories) => saveNativePerkChanges(perkId, { categories })}
              onTogglePerk={togglePerk}
            />
          ) : (
            <section className="analyzer-panel build-manager build-summary sidebar-build-panel" aria-label="Gestion et résumé du build">
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
              {calculation
                ? <BuildSummary calculation={calculation} perks={equippedPerks} scenario={scenario} />
                : <div className="build-summary-content"><div className="compact-section-heading"><div><span className="section-icon" aria-hidden="true">▤</span><h2>Build Summary</h2></div></div><p className="panel-empty">Aucun build à résumer.</p></div>}
            </section>
          )}
        </aside>
      </main>}
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

type FixedStatisticsBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "table"; columns: string[]; rows: string[][] };

function ConstantsView() {
  const [query, setQuery] = useState("");
  const blocks = useMemo(() => parseFixedStatistics(fixedStatisticsText), []);
  const normalizedQuery = query.trim().toLocaleLowerCase("fr");
  const visibleBlocks = blocks.flatMap((block) => {
    if (!normalizedQuery) return [block];
    if (block.type === "table") {
      const rows = block.rows.filter((row) => row.join(" ").toLocaleLowerCase("fr").includes(normalizedQuery));
      return rows.length > 0 ? [{ ...block, rows }] : [];
    }
    return block.text.toLocaleLowerCase("fr").includes(normalizedQuery) ? [block] : [];
  });

  return <main className="constants-page">
    <header className="constants-header">
      <div><span className="eyebrow">Dead by Daylight</span><h1>Constantes</h1><p>Valeurs de référence et unités de mesure utilisées dans le jeu.</p></div>
      <label className="constants-search"><span>Rechercher</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex. générateur, 4,6 m/s…" autoComplete="off" /></label>
    </header>
    <section className="constants-content" aria-label="Constantes de Dead by Daylight">
      {visibleBlocks.length > 0 ? visibleBlocks.map((block, index) => {
        if (block.type === "heading") {
          const Heading = `h${Math.min(block.level + 1, 3)}` as "h2" | "h3";
          return <Heading key={`heading-${index}`} className={`constants-heading level-${block.level}`}>{formatGuideText(block.text)}</Heading>;
        }
        if (block.type === "paragraph") return <p key={`paragraph-${index}`} className="constants-note">{formatGuideText(block.text)}</p>;
        return <div className="constants-table-wrap" key={`table-${index}`}><table className="constants-table"><thead><tr>{block.columns.map((column, columnIndex) => <th key={columnIndex}>{formatGuideText(column)}</th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{formatGuideText(cell)}</td>)}</tr>)}</tbody></table></div>;
      }) : <p className="constants-empty">Aucune constante ne correspond à cette recherche.</p>}
    </section>
  </main>;
}

const PERK_TIER_LIST: Record<KillerTier, readonly string[]> = {
  "S+": ["Intervention impure", "Écho de douleur", "Sombre étreinte", "Le tour est joué", "Aucune issue", "Poursuivant meurtrier"],
  "S-": ["Dispositif de l'homme mort", "Nulle part où se cacher", "Éruption", "Surtension", "Amis pour la vie", "Remonter le temps", "Tous les coups sont permis", "Blessures béantes"],
  "A+": ["Mangeur d'espoir", "Réparateur", "Déboussoler", "Discordance", "Faveur de sang", "Fais-les attendre", "Vorace", "Oppression", "Repentir", "Briseur d'esprit", "Fascination", "Personne n'échappe à la mort"],
  "A-": ["Agitation", "Tenace", "Vocation de l'infirmière", "Ruine", "Peur contagieuse", "Je vous écoute", "Poursuite furtive", "Bricolo", "Immortel", "Ténèbres révélées", "Affrontez les ténèbres", "Témoin céleste", "La Ruche", "Frayeur mortelle", "Boussole de douleur", "Lien avec la trame", "Contact languide", "Inattendu", "Arme ultime", "Brutalité rapide", "Hésitation forcée", "Effet de levier", "Flots de rage", "Contrôle des foules", "Piste de souffrance", "Fais ton choix", "Chili et Barbecue", "Trépas de Franklin", "Boucher sadique", "Regarde-les détaler"],
  "B+": ["Force brute", "Prédateur", "Présence écrasante", "Surveillance et maltraitance", "Gardien de sang", "Intensité ardente", "Coulrophobie", "Fureur de l'esprit", "Terrain hanté", "Rancœur", "Vierge de fer", "Frissons palpitants", "Tactiques de Zanshin", "Écho sanguin", "Châtiment", "Dissolution", "Hubris", "À jamais liés", "Personne n'est libre", "Coup de tonnerre", "Pas de quartier", "Destin misérable", "Inexorable", "Limites génétiques", "Instinct d'Alien", "Apprentissage automatique", "VLAN !", "Anatomie supérieure", "Terminus", "Tempête impitoyable", "Hystérie", "Coup de grâce", "Limites cruelles", "Espions de l'ombre", "Euphorie de la chasse", "Part d'infortune", "Ombre silencieuse", "Semer la dévastation"],
  "B-": ["Présence perturbante", "Rejeton de l'ombre", "Rejeton de la lumière", "Thanatophobie", "Surcharge", "Souviens-toi de moi", "Cran dément", "Sombre dévotion", "Ennemi juré", "Prise du dragon", "On embauche", "Frayeur fantôme", "Détraqué", "Ouverture maudite", "Que du malheur", "Arrogance ténébreuse", "Ouverture de la chasse", "Perception éveillée", "Appel de la mer", "Pénitence forcée", "Lien mortel", "Surveillance", "Sanctuaire monstrueux", "Murmure amer", "Murmures", "Éradication des faibles"],
  "C+": ["Limier", "Stridor", "Le troisième sceau", "Berceuse de la Chasseuse", "Toucher septique", "Sous votre coupe", "Saccage", "Œil vagabond", "Avidité humaine", "Domination", "Piles incluses", "On peut jouer à deux", "K.O.", "Coup du pendu", "Inquiétant", "Pisteur", "Poigne de fer"],
  "C-": ["Prédation", "Instinct territorial", "Projet secret", "Interrompu", "Amasseur", "Implacable", "Insidieux"],
  "D": ["Espoir brisé"]
};

const PERK_TIER_NAME_ALIASES: Record<string, string> = {
  "Chili et Barbecue": "chili et barbebue",
  "Piste de souffrance": "pistre de souffrance"
};

function TierListView({ killers, perks }: { killers: readonly Killer[]; perks: readonly Perk[] }) {
  const [kind, setKind] = useState<"killers" | "perks">("killers");
  const perksByName = useMemo(() => new Map(perks.filter((perk) => perk.side === "killer").map((perk) => [normalizeTierListName(perk.name.fr ?? perk.name.en ?? perk.id), perk])), [perks]);
  return <main className="tier-list-page" data-kind={kind}>
    <aside className="tier-list-sidebar" aria-label="Type de tier list">
      <button className={kind === "killers" ? "selected" : ""} onClick={() => setKind("killers")} type="button">Killer</button>
      <button className={kind === "perks" ? "selected" : ""} onClick={() => setKind("perks")} type="button">Perk</button>
    </aside>
    <section className="tier-list-board" aria-label={kind === "killers" ? "Tier list des tueurs" : "Tier list des perks"}>
      {KILLER_TIERS.map((tier) => {
        const rankedKillers = kind === "killers" ? killers.filter((killer) => killer.tier === tier) : [];
        const rankedPerks = kind === "perks" ? PERK_TIER_LIST[tier].map((name) => ({ name, perk: perksByName.get(normalizeTierListName(PERK_TIER_NAME_ALIASES[name] ?? name)) })) : [];
        const count = kind === "killers" ? rankedKillers.length : rankedPerks.length;
        return <section className="tier-list-row" data-tier={tier} key={tier}>
          <header><strong>{tier}</strong><small>{count} {kind === "killers" ? `tueur${count > 1 ? "s" : ""}` : `perk${count > 1 ? "s" : ""}`}</small></header>
          <div className="tier-list-killers" role="list">
            {kind === "killers" ? rankedKillers.map((killer) => <TierListItem key={killer.id} name={killer.name.fr ?? killer.name.en ?? killer.id} image={killerPortraitUrl(killer)} />)
              : rankedPerks.map(({ name, perk }) => <TierListItem key={name} name={name} image={perk ? perkIconUrl(perk) : null} perk />)}
          </div>
        </section>;
      })}
    </section>
  </main>;
}

function TierListItem({ name, image, perk = false }: { name: string; image: string | null; perk?: boolean }) {
  const content = image ? <img src={image} alt={name} loading="lazy" /> : <span>{name}</span>;
  return <article className={`tier-list-killer${perk ? " tier-list-perk" : ""}`} role="listitem" title={name} data-name={perk ? name : undefined}>{perk ? <span className="tier-list-perk-icon">{content}</span> : content}</article>;
}

function normalizeTierListName(value: string): string {
  return value.replace(/œ/g, "oe").replace(/æ/g, "ae").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function parseFixedStatistics(source: string): FixedStatisticsBlock[] {
  const blocks: FixedStatisticsBlock[] = [];
  const lines = source.replace(/\r/g, "").split("\n");
  for (let index = 0; index < lines.length;) {
    const line = lines[index]?.trim() ?? "";
    if (!line || line === "---") { index += 1; continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) { const [, marks = "#", text = ""] = heading; blocks.push({ type: "heading", level: marks.length, text }); index += 1; continue; }
    if (line.startsWith("|") && /^\|\s*:?-+/.test(lines[index + 1]?.trim() ?? "")) {
      const columns = tableCells(line);
      index += 2;
      const rows: string[][] = [];
      while ((lines[index]?.trim() ?? "").startsWith("|")) { rows.push(tableCells(lines[index] ?? "")); index += 1; }
      blocks.push({ type: "table", columns, rows });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index]?.trim() ?? "";
      if (!current || current === "---" || current.startsWith("#") || current.startsWith("|")) break;
      paragraph.push(current);
      index += 1;
    }
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") }); else index += 1;
  }
  return blocks;
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
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
  installState,
  canInstallApplication,
  isInstallingApplication,
  onInstallApplication,
  onViewChange,
  onMenuChange,
  onHelp,
  onResetScenario
}: {
  activeView: AppView;
  menu: TopbarMenu;
  savedBuildCount: number;
  hasBuild: boolean;
  installState: InstallState;
  canInstallApplication: boolean;
  isInstallingApplication: boolean;
  onInstallApplication: () => void;
  onViewChange: (view: AppView) => void;
  onMenuChange: (menu: TopbarMenu) => void;
  onHelp: () => void;
  onResetScenario: () => void;
}) {
  const installButtonLabel = installState === "installed"
    ? "Application installée"
    : isInstallingApplication
      ? "Installation..."
      : "Installer l’application";
  const installHint = installState === "installed"
    ? "La web app est déjà installée sur cet appareil."
    : canInstallApplication
      ? "Installer la web app dans une fenêtre dédiée du navigateur."
      : "L’installation sera proposée dès que le navigateur l’autorisera.";

  return (
    <header className="site-header analyzer-topbar">
      <button className="brand" type="button" onClick={() => onViewChange("build")}>
        <span className="brand-mark" aria-hidden="true">
          {appLogoUrl ? <img className="brand-logo" src={appLogoUrl} alt="" /> : <span className="brand-mark-text">Ⅳ</span>}
        </span>
        <span>Build Analyzer</span>
      </button>
      <nav className="main-navigation" aria-label="Navigation principale">
        {(["build", "killers", "perks", "tiers", "constants"] as AppView[]).map((view) => (
          <button className={activeView === view ? "active" : ""} type="button" onClick={() => onViewChange(view)} aria-current={activeView === view ? "page" : undefined} key={view}>
            <span aria-hidden="true">{view === "build" ? "⌘" : view === "killers" ? "☠" : view === "perks" ? "◇" : view === "tiers" ? "♜" : "≡"}</span>
            {view === "constants" ? "Constantes" : view === "tiers" ? "Tiers List" : `${view[0]?.toUpperCase()}${view.slice(1)}`}
          </button>
        ))}
      </nav>
      <div className="topbar-actions">
        {installState !== "installed" && (
          <button className={`install-app-button ${canInstallApplication ? "available" : installState}`} type="button" onClick={onInstallApplication} disabled={!canInstallApplication} title={installHint} aria-label={installButtonLabel}>
            <span className="install-app-button-full">{installButtonLabel}</span>
            <span className="install-app-button-compact">Installer</span>
          </button>
        )}
        <button className="topbar-icon-button help-button" type="button" onClick={onHelp} aria-label="How to play ?"><span aria-hidden="true">?</span><span className="topbar-icon-tooltip" role="tooltip">How to play ?</span></button>
        <button className="topbar-icon-button" type="button" onClick={() => onMenuChange(menu === "settings" ? null : "settings")} aria-label="Paramètres" aria-expanded={menu === "settings"}>⚙</button>
      </div>
      {menu === "help" && (
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

function SettingsModal({ soundEnabled, volume, onSoundEnabledChange, onVolumeChange, onClose }: {
  soundEnabled: boolean;
  volume: number;
  onSoundEnabledChange: (enabled: boolean) => void;
  onVolumeChange: (volume: number) => void;
  onClose: () => void;
}) {
  return <div className="app-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="app-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><h2 id="settings-title">Paramètres</h2><button type="button" onClick={onClose} aria-label="Fermer">×</button></header>
      <label className="sound-toggle"><input type="checkbox" checked={soundEnabled} onChange={(event) => onSoundEnabledChange(event.target.checked)} /><span>Activer le son</span></label>
      <label className="field"><span>Volume musique</span><input type="range" min="0" max="1" step="0.05" value={volume} disabled={!soundEnabled} onChange={(event) => onVolumeChange(Number(event.target.value))} /></label>
    </section>
  </div>;
}

function HowToPlayModal({ onClose }: { onClose: () => void }) {
  return <div className="app-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="app-modal how-to-play-modal" role="dialog" aria-modal="true" aria-labelledby="how-to-play-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><h2 id="how-to-play-title">How to play ?</h2><button type="button" onClick={onClose} aria-label="Fermer">×</button></header>
      <div className="how-to-play-content">{renderHowToPlay(howToPlayText)}</div>
    </section>
  </div>;
}

function renderHowToPlay(source: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r/g, "").split("\n");
  for (let index = 0; index < lines.length;) {
    const line = lines[index]?.trim() ?? "";
    if (!line || line === "---") { index += 1; continue; }
    if (line.startsWith("# ")) { blocks.push(<p className="how-to-play-intro" key={`title-${index}`}>{formatGuideText(line.slice(2))}</p>); index += 1; continue; }
    if (line.startsWith("## ")) { blocks.push(<h3 key={`heading-${index}`}>{formatGuideText(line.slice(3))}</h3>); index += 1; continue; }
    if (line.startsWith("* ")) {
      const items: string[] = [];
      while ((lines[index]?.trim() ?? "").startsWith("* ")) { items.push((lines[index] ?? "").trim().slice(2)); index += 1; }
      blocks.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{formatGuideText(item)}</li>)}</ul>);
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index]?.trim() ?? "";
      if (!current || current === "---" || current.startsWith("#") || current.startsWith("* ")) break;
      paragraph.push(current);
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{formatGuideText(paragraph.join(" "))}</p>);
  }
  return blocks;
}

function formatGuideText(value: string): ReactNode[] {
  return value.split(/(\*\*.*?\*\*)/g).filter(Boolean).map((part, index) => part.startsWith("**") && part.endsWith("**")
    ? <strong key={index}>{part.slice(2, -2)}</strong>
    : part
  );
}

function KillerInfoModal({ killer, killers, onClose }: { killer: Killer; killers: readonly Killer[]; onClose: () => void }) {
  const [infoKiller, setInfoKiller] = useState(killer);
  const railRef = useRef<HTMLDivElement>(null);
  const portrait = killerPortraitUrl(infoKiller);
  const killerLoop = [...killers, ...killers, ...killers];

  useEffect(() => {
    setInfoKiller(killer);
  }, [killer]);

  useEffect(() => {
    const rail = railRef.current;
    if (rail) rail.scrollLeft = rail.scrollWidth / 3;
  }, [killers.length]);

  const moveRail = (direction: -1 | 1) => railRef.current?.scrollBy({ left: direction * 260, behavior: "smooth" });
  const keepRailLooping = () => {
    const rail = railRef.current;
    if (!rail) return;
    const third = rail.scrollWidth / 3;
    if (rail.scrollLeft < 4 || rail.scrollLeft > rail.scrollWidth - rail.clientWidth - 4) rail.scrollLeft = third;
  };
  return <div className="app-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="app-modal killer-info-modal" role="dialog" aria-modal="true" aria-labelledby="killer-info-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><h2 id="killer-info-title">{infoKiller.name.fr ?? infoKiller.name.en}</h2><div className="killer-info-carousel"><button type="button" onClick={() => moveRail(-1)} aria-label="Tueurs précédents">‹</button><div className="killer-info-profiles" ref={railRef} onScroll={keepRailLooping} onWheel={(event) => { event.preventDefault(); event.currentTarget.scrollBy({ left: event.deltaY, behavior: "auto" }); }}>{killerLoop.map((candidate, index) => { const candidatePortrait = killerPortraitUrl(candidate); const name = candidate.name.fr ?? candidate.name.en ?? candidate.id; return <button className={candidate.id === infoKiller.id ? "selected" : ""} type="button" key={`${candidate.id}-${index}`} onClick={() => setInfoKiller(candidate)} aria-label={`Afficher le pouvoir de ${name}`} aria-pressed={candidate.id === infoKiller.id}>{candidatePortrait ? <img src={candidatePortrait} alt="" /> : name.slice(0, 1)}</button>; })}</div><button type="button" onClick={() => moveRail(1)} aria-label="Tueurs suivants">›</button></div><button className="killer-info-close" type="button" onClick={onClose} aria-label="Fermer">×</button></header>
      <div className="killer-info-content" key={infoKiller.id}>{portrait && <img src={portrait} alt="" />}<p>{killerPowerDescription(infoKiller)}</p></div>
    </section>
  </div>;
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

function createCategoryOverrideRepository(): { repository: LocalCategoryOverrideRepository; overrides: Record<string, PerkCategory[]> } {
  try {
    const repository = new LocalCategoryOverrideRepository(window.localStorage);
    return { repository, overrides: repository.list() };
  } catch {
    const repository = new LocalCategoryOverrideRepository(createMemoryStorage());
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

function detectInstallState(): InstallState {
  return isStandaloneApp() ? "installed" : "unsupported";
}

function runUiTransition(update: () => void): void {
  const documentWithTransitions = document as Document & {
    startViewTransition?: (callback: () => void) => { finished: Promise<void> };
  };
  if (typeof documentWithTransitions.startViewTransition === "function") {
    documentWithTransitions.startViewTransition(() => {
      update();
    });
    return;
  }
  update();
}

function isStandaloneApp(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}
