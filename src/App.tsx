import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import howToPlayText from "../partie_dbd.txt?raw";
import fixedStatisticsText from "../statistiques_fixe.txt?raw";
import { isHostedApp } from "./app/cloud.js";
import { appStorage } from "./services/account-storage.js";

import { appLogoUrl, killerPortraitUrl, killerTerrorRadiusUrl, killerThemeUrl, originalKillerThemeUrl, perkIconUrl } from "./app/assets.js";
import { killers, perks, survivors } from "./app/catalog.js";
import { MAX_BUILD_PERKS, type Build } from "./domain/build.js";
import type { PerkCategory } from "./domain/category.js";
import { KILLER_TIERS, type Killer, type KillerTier } from "./domain/killer.js";
import type { Perk, PerkSide } from "./domain/perk.js";
import { BuildAnalyzer } from "./features/build-analyzer/BuildAnalyzer.js";
import { BuildAssistant } from "./features/build-assistant/BuildAssistant.js";
import { hasMeaningfulDescriptionContent, sanitizeDescriptionHtml } from "./components/rich-description-html.js";
import { BuildEditor } from "./features/build-editor/BuildEditor.js";
import { BuildSummary } from "./features/build-summary/BuildSummary.js";
import { BlindTestView } from "./features/blind-test/BlindTestView.js";
import { SelectedKillerCard } from "./features/build-workspace/SelectedKillerCard.js";
import { KillerSelector } from "./features/killer-selector/KillerSelector.js";
import { PerkInspectorPanel } from "./features/perk-browser/PerkInspectorPanel.js";
import { PerkBrowser } from "./features/perk-browser/PerkBrowser.js";
import { PerkFiltersPanel } from "./features/perk-browser/PerkFiltersPanel.js";
import { SavedBuilds } from "./features/saved-builds/SavedBuilds.js";
import { TierListView } from "./features/tier-list/TierListView.js";
import { StatisticsAutoSync } from "./features/statistics/StatisticsAutoSync.js";
import { StatisticsView } from "./features/statistics/StatisticsView.js";
import {
  CATEGORY_OVERRIDES_STORAGE_KEY,
  DESCRIPTION_OVERRIDES_STORAGE_KEY,
  LocalCategoryOverrideRepository,
  LocalDescriptionOverrideRepository
} from "./services/description-overrides.js";
import { BUILDS_STORAGE_KEY, LocalBuildRepository } from "./services/build-repository.js";
import { ASSISTANT_SERVER_STORAGE_KEY, normalizeServerUrl } from "./services/assistant-provider.js";
import { applyAssistantActions, validateAssistantSnapshot, type AssistantAction, type AssistantActionSnapshot } from "./services/assistant-actions.js";
import { LocalTierOverrideRepository, rankPerks, TIER_OVERRIDES_STORAGE_KEY, type TierOverrides } from "./services/tier-list.js";
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
import { perkCooldown } from "./services/perk-cooldown.js";
import { killerPowerDescription } from "./services/killer-powers.js";
import { checkAppUpdate, installAppUpdate, type AppUpdateStatus } from "./services/app-updater.js";

type TopbarMenu = "help" | "settings" | null;
type InstallState = "available" | "unsupported" | "installed";
type CatalogView = Extract<AppView, "killers" | "perks" | "constants">;
const DEFAULT_PANE_LAYOUT = DEFAULT_APP_SESSION.paneLayout;
const DEFAULT_ASSISTANT_SERVER = import.meta.env.VITE_ASSISTANT_SERVER_URL
  ?? import.meta.env.VITE_OPENAI_ASSISTANT_ENDPOINT
  ?? "http://127.0.0.1:8787";
const APP_UPDATE_SERVER = import.meta.env.VITE_APP_UPDATE_SERVER_URL ?? "http://127.0.0.1:8787";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface TerrorRadiusPlayback {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  volume: number;
}

export default function App({ isAdmin = !isHostedApp }: { isAdmin?: boolean }) {
  const [nextStatisticsSyncAt, setNextStatisticsSyncAt] = useState<number | null>(null);
  const [initialSession] = useState(loadPersistedAppSession);
  const [activeView, setActiveView] = useState<AppView>(initialSession.activeView === "administration" && !isAdmin ? "build" : initialSession.activeView);
  const [side, setSide] = useState<PerkSide>(initialSession.side);
  const [buildSessions, setBuildSessions] = useState(initialSession.buildSessions);
  const [topbarMenu, setTopbarMenu] = useState<TopbarMenu>(null);
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(initialSession.soundEnabled);
  const [musicVolume, setMusicVolume] = useState(initialSession.musicVolume);
  const [blindTestRunning, setBlindTestRunning] = useState(false);
  const [terrorRadiusPlayback, setTerrorRadiusPlayback] = useState<TerrorRadiusPlayback>({ currentTime: 0, duration: 0, isPlaying: false, volume: 0.7 });
  const [killerInfo, setKillerInfo] = useState<Killer | null>(null);
  const [selectedKillerId, setSelectedKillerId] = useState<string | null>(initialSession.selectedKillerId);
  const [selectedPerkId, setSelectedPerkId] = useState<string | null>(initialSession.selectedPerkId);
  const [equippedPerkIds, setEquippedPerkIds] = useState<string[]>(initialSession.equippedPerkIds);
  const [activeBuildId, setActiveBuildId] = useState<string | null>(initialSession.activeBuildId);
  const [buildName, setBuildName] = useState(initialSession.buildName);
  const [conversationKey, setConversationKey] = useState(initialSession.conversationKey);
  const [catalogPerks, setCatalogPerks] = useState<Perk[]>(() => perks);
  const [perkFilters, setPerkFilters] = useState<PerkFilters>({ ...DEFAULT_PERK_FILTERS, side: initialSession.side, categories: [] });
  const [killerOptions, setKillerOptions] = useState<KillerListOptions>({ ...DEFAULT_KILLER_OPTIONS });
  const [killerListView, setKillerListView] = useState(false);
  const [killerFiltersVisible, setKillerFiltersVisible] = useState(true);
  const [perkFilterDetailsOpen, setPerkFilterDetailsOpen] = useState({ characters: false, categories: false });
  const [savedBuilds, setSavedBuilds] = useState<Build[]>([]);
  const [descriptionRepositoryState] = useState(createDescriptionOverrideRepository);
  const [descriptionOverrides, setDescriptionOverrides] = useState<Record<string, string>>(descriptionRepositoryState.overrides);
  const [categoryRepositoryState] = useState(createCategoryOverrideRepository);
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, PerkCategory[]>>(categoryRepositoryState.overrides);
  const [tierRepositoryState] = useState(createTierOverrideRepository);
  const [tierOverrides, setTierOverrides] = useState<TierOverrides>(tierRepositoryState.overrides);
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
  const terrorRadiusTrackUrlRef = useRef<string | null>(null);
  const terrorRadiusPlaybackRequestRef = useRef(0);
  const killerCatalogRef = useRef<HTMLElement>(null);
  const perkCatalogRef = useRef<HTMLElement>(null);
  const previousViewRef = useRef<AppView | null>(null);
  const catalogScrollPositionsRef = useRef({ ...initialSession.catalogScrollPositions });
  const buildRepository = repositoryState.repository;
  const descriptionOverrideRepository = descriptionRepositoryState.repository;
  const categoryOverrideRepository = categoryRepositoryState.repository;
  const effectivePerks = useMemo(() => catalogPerks.map((perk) => ({
    ...perk,
    cooldown: perkCooldown(perk, descriptionOverrides[perk.id]),
    categories: categoryOverrides[perk.id] ?? perk.categories
  })), [catalogPerks, categoryOverrides, descriptionOverrides]);
  const effectiveKillers = useMemo(() => killers.map((killer) => ({ ...killer, tier: tierOverrides.killers[killer.id] ?? killer.tier })), [tierOverrides.killers]);
  const perkTierList = useMemo(() => rankPerks(effectivePerks, tierOverrides.perks), [effectivePerks, tierOverrides.perks]);
  const activeCharacters = side === "survivor" ? survivors : effectiveKillers;
  const selectedKiller = selectedKillerId ? activeCharacters.find((character) => character.id === selectedKillerId) ?? null : null;
  const selectedNativePerk = selectedPerkId ? catalogPerks.find((perk) => perk.id === selectedPerkId) ?? null : null;
  const selectedPerk = selectedPerkId ? effectivePerks.find((perk) => perk.id === selectedPerkId) ?? null : null;
  const selectedPerkOwner = selectedPerk?.characterId ? activeCharacters.find((character) => character.id === selectedPerk.characterId) ?? null : null;
  const equippedPerks = useMemo(() => equippedPerkIds.flatMap((id) => {
    const perk = effectivePerks.find((candidate) => candidate.id === id);
    return perk ? [perk] : [];
  }), [equippedPerkIds, effectivePerks]);
  const calculation = useMemo(
    () => selectedKiller ? calculateBuild({ killer: selectedKiller, perks: equippedPerks, scenario, side }) : null,
    [selectedKiller, equippedPerks, scenario, side]
  );
  const currentBuildExport = useMemo(() => createCurrentBuildExport({
    activeBuildId,
    buildName,
    killer: selectedKiller,
    side,
    perks: equippedPerks,
    scenario,
    calculation,
    perkDescriptionOverrides: descriptionOverrides
  }), [activeBuildId, buildName, selectedKiller, equippedPerks, scenario, calculation, descriptionOverrides, side]);

  useEffect(() => {
    killerThemeAudioRef.current = new Audio();
    originalThemeAudioRef.current = new Audio();
    terrorRadiusAudioRef.current = new Audio();
    return () => [killerThemeAudioRef, originalThemeAudioRef, terrorRadiusAudioRef].forEach(({ current }) => current?.pause());
  }, []);

  useEffect(() => {
    [killerThemeAudioRef.current, originalThemeAudioRef.current].forEach((audio) => {
      if (!audio) return;
      audio.volume = musicVolume;
      if (!soundEnabled) audio.pause();
    });
    const terrorRadiusAudio = terrorRadiusAudioRef.current;
    if (terrorRadiusAudio) {
      terrorRadiusAudio.volume = terrorRadiusPlayback.volume;
      if (!soundEnabled) terrorRadiusAudio.pause();
    }
  }, [soundEnabled, musicVolume, terrorRadiusPlayback.volume]);

  useEffect(() => {
    const session: AppSession = {
      activeView,
      side,
      soundEnabled,
      musicVolume,
      selectedKillerId,
      selectedPerkId,
      equippedPerkIds,
      activeBuildId,
      buildName,
      conversationKey,
      scenario,
      buildSessions: { ...buildSessions, [side]: { selectedKillerId, selectedPerkId, equippedPerkIds, activeBuildId, buildName, conversationKey, scenario } },
      paneLayout,
      sidebarLayout,
      catalogScrollPositions: { ...catalogScrollPositionsRef.current }
    };
    try { appStorage.setItem(APP_SESSION_STORAGE_KEY, JSON.stringify(session)); } catch { /* Reprise indisponible si le navigateur bloque le stockage. */ }
  }, [activeView, side, soundEnabled, musicVolume, selectedKillerId, selectedPerkId, equippedPerkIds, activeBuildId, buildName, conversationKey, scenario, buildSessions, paneLayout, sidebarLayout]);

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
    if (isHostedApp) return;
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
      conditions: { ...current.conditions, ...Object.fromEntries(missingConditions.map((condition) => [condition, side !== "survivor" || (condition === "survivor_healthy" ? !current.conditions.survivor_injured && !current.conditions.survivor_downed : !["survivor_exhausted", "survivor_injured", "survivor_downed"].includes(condition))])) },
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
    const syncTierOverrides = (event: StorageEvent): void => {
      if (event.key === TIER_OVERRIDES_STORAGE_KEY || event.key === null) {
        try { setTierOverrides(tierRepositoryState.repository.list()); } catch (error) { setRepositoryMessage(errorMessage(error)); }
      }
    };
    window.addEventListener("storage", syncBuilds);
    window.addEventListener("storage", syncDescriptionOverrides);
    window.addEventListener("storage", syncCategoryOverrides);
    window.addEventListener("storage", syncTierOverrides);
    return () => {
      window.removeEventListener("storage", syncBuilds);
      window.removeEventListener("storage", syncDescriptionOverrides);
      window.removeEventListener("storage", syncCategoryOverrides);
      window.removeEventListener("storage", syncTierOverrides);
    };
  }, [buildRepository, categoryOverrideRepository, descriptionOverrideRepository, tierRepositoryState.repository]);

  const defaultName = selectedKiller ? defaultBuildName(selectedKiller) : "";
  const activeSavedBuild = activeBuildId ? savedBuilds.find((build) => build.id === activeBuildId) ?? null : null;
  const hasUnsavedBuildChanges = activeSavedBuild !== null
    && isBuildDirty(activeSavedBuild, selectedKillerId, buildName, equippedPerkIds, side);
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

  function rememberCurrentBuild(): void {
    setBuildSessions((current) => ({ ...current, [side]: { selectedKillerId, selectedPerkId, equippedPerkIds, activeBuildId, buildName, conversationKey, scenario } }));
  }

  function toggleSide(): void {
    runUiTransition(() => {
      const nextSide: PerkSide = side === "killer" ? "survivor" : "killer";
      rememberCurrentBuild();
      const remembered = buildSessions[nextSide];
      setSide(nextSide);
      setSelectedKillerId(remembered.selectedKillerId);
      setSelectedPerkId(remembered.selectedPerkId);
      setEquippedPerkIds(remembered.equippedPerkIds);
      setActiveBuildId(savedBuilds.some((build) => build.id === remembered.activeBuildId && build.side === nextSide) ? remembered.activeBuildId : null);
      setBuildName(remembered.buildName);
      setScenario(remembered.scenario);
      setConversationKey(remembered.conversationKey === "empty-build" ? newConversationKey("draft") : remembered.conversationKey);
      setRepositoryMessage(null);
      setPerkFilters({ ...DEFAULT_PERK_FILTERS, side: nextSide, categories: [] });
      setKillerOptions({ ...DEFAULT_KILLER_OPTIONS, sortBy: nextSide === "survivor" ? "name" : DEFAULT_KILLER_OPTIONS.sortBy });
      setActiveView("killers");
      setTopbarMenu(null);
      stopTerrorRadius();
      killerThemeAudioRef.current?.pause();
      originalThemeAudioRef.current?.pause();
    });
  }

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
      if (side === "killer") void playKillerTheme(killer);
    });
  }

  function removeKiller(): void {
    runUiTransition(() => {
      setSelectedKillerId(null);
      setActiveView("killers");
      setTopbarMenu(null);
      stopTerrorRadius();
      if (side === "killer") {
        killerThemeAudioRef.current?.pause();
        if (killerThemeAudioRef.current) killerThemeAudioRef.current.currentTime = 0;
        originalThemeAudioRef.current?.pause();
        if (originalThemeAudioRef.current) originalThemeAudioRef.current.currentTime = 0;
        void playOriginalKillerTheme();
      }
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
      const draft = { name: buildName, killerId: selectedKiller.id, side, perkIds: equippedPerkIds };
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
      const saved = buildRepository.create({ name: `${buildName} (copie)`, killerId: selectedKiller.id, side, perkIds: equippedPerkIds });
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
    const buildSide = build.side;
    const characters = buildSide === "survivor" ? survivors : killers;
    const killer = characters.find((candidate) => candidate.id === build.killerId);
    if (!killer) {
      setRepositoryMessage(`Impossible de charger « ${build.name} » : ${buildSide === "survivor" ? "survivant" : "tueur"} absent du catalogue.`);
      return;
    }
    const knownPerkIds = build.perkIds.filter((id) => catalogPerks.some((perk) => perk.id === id && perk.side === buildSide));
    const missingPerkCount = build.perkIds.length - knownPerkIds.length;
    if (buildSide !== side) rememberCurrentBuild();
    setSide(buildSide);
    setPerkFilters({ ...DEFAULT_PERK_FILTERS, side: buildSide, categories: [] });
    setSelectedKillerId(killer.id);
    setEquippedPerkIds(knownPerkIds);
    setActiveBuildId(missingPerkCount === 0 ? build.id : null);
    setBuildName(missingPerkCount === 0 ? build.name : `${build.name} (récupéré)`);
    setScenario(emptyScenario());
    setConversationKey(missingPerkCount === 0 ? buildConversationKey(build.id) : newConversationKey("recovered"));
    setSelectedPerkId((current) => current && !knownPerkIds.includes(current) ? null : current);
    setActiveView("build");
    stopTerrorRadius();
    if (buildSide === "killer") void playKillerTheme(killer);
    setRepositoryMessage(missingPerkCount === 0
      ? `Build « ${build.name} » chargé.`
      : `Build chargé avec ${missingPerkCount} perk absente. L’original est préservé ; sauvegardez une copie récupérée.`);
  }

  function duplicateBuild(build: Build): void {
    try {
      const duplicate = buildRepository.duplicate(build.id, `${build.name} (copie)`);
      setSavedBuilds(buildRepository.list());
      if (duplicate.side !== side) rememberCurrentBuild();
      setSide(duplicate.side);
      setPerkFilters({ ...DEFAULT_PERK_FILTERS, side: duplicate.side, categories: [] });
      setSelectedKillerId(duplicate.killerId);
      setEquippedPerkIds([...duplicate.perkIds]);
      setActiveBuildId(duplicate.id);
      setBuildName(duplicate.name);
      setScenario(emptyScenario());
      setConversationKey(`build:${duplicate.id}`);
      setSelectedPerkId((current) => current && !duplicate.perkIds.includes(current) ? null : current);
      setActiveView("build");
      stopTerrorRadius();
      const killer = (duplicate.side === "survivor" ? survivors : killers).find((candidate) => candidate.id === duplicate.killerId);
      if (killer && duplicate.side === "killer") void playKillerTheme(killer);
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
      const healthStates = ["survivor_healthy", "survivor_injured", "survivor_downed"];
      if (side === "survivor" && active && healthStates.includes(condition)) {
        healthStates.filter((state) => state !== condition).forEach((state) => { conditions[state] = false; });
      }
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
    if (!isAdmin) throw new Error("Cette modification est réservée aux administrateurs.");
    setDescriptionOverrides(descriptionOverrideRepository.update(perkId, html));
  }

  function moveTier(kind: keyof TierOverrides, id: string, tier: KillerTier): void {
    const known = kind === "killers" ? effectiveKillers.some((killer) => killer.id === id) : effectivePerks.some((perk) => perk.id === id);
    if (!known || !(KILLER_TIERS as readonly string[]).includes(tier)) throw new Error("Entrée ou tier inconnu.");
    setTierOverrides(tierRepositoryState.repository.update(kind, id, tier));
  }

  function applyChatActions(actions: readonly AssistantAction[], snapshot: AssistantActionSnapshot): string[] {
    if (actions.length === 0) return [];
    const currentBuilds = buildRepository.list();
    validateAssistantSnapshot(actions, snapshot, { currentBuild: currentBuildExport, savedBuilds: currentBuilds, perks: effectivePerks, perkDescriptionOverrides: descriptionOverrides });
    return applyAssistantActions(actions, { killers: effectiveKillers, survivors, perks: effectivePerks, builds: currentBuilds }, {
      updateDescription: (perkId, html) => {
        const sanitized = sanitizeDescriptionHtml(html);
        if (!hasMeaningfulDescriptionContent(sanitized)) throw new Error("Description vide après nettoyage.");
        saveDescriptionOverride(perkId, sanitized);
      },
      updateKillerTier: (id, tier) => moveTier("killers", id, tier),
      updatePerkTier: (id, tier) => moveTier("perks", id, tier),
      saveBuild: (action) => {
        const saved = action.buildId === null ? buildRepository.create(action) : buildRepository.update(action.buildId, action);
        setSavedBuilds(buildRepository.list());
        if (saved.id === activeBuildId) loadBuild(saved);
      },
      setCurrentBuild: (action) => {
        if (action.side !== side) rememberCurrentBuild();
        setActiveBuildId(null);
        setConversationKey(newConversationKey("draft"));
        setSide(action.side);
        setPerkFilters({ ...DEFAULT_PERK_FILTERS, side: action.side, categories: [] });
        setSelectedKillerId(action.killerId);
        setEquippedPerkIds([...action.perkIds]);
        setBuildName(action.name);
        setSelectedPerkId(null);
        setScenario(emptyScenario());
      }
    });
  }

  function resetDescriptionOverride(perkId: string): void {
    if (!isAdmin) return;
    setDescriptionOverrides(descriptionOverrideRepository.delete(perkId));
  }

  function saveCategoryOverride(perkId: string, categories: readonly PerkCategory[]): void {
    if (!isAdmin) return;
    setCategoryOverrides(categoryOverrideRepository.update(perkId, categories));
  }

  function resetCategoryOverride(perkId: string): void {
    if (!isAdmin) return;
    setCategoryOverrides(categoryOverrideRepository.delete(perkId));
  }

  async function saveNativePerkChanges(perkId: string, changes: { descriptionHtml?: string; categories?: readonly PerkCategory[] }): Promise<void> {
    if (!isAdmin) throw new Error("Cette modification est réservée aux administrateurs.");
    try {
      if (isHostedApp) {
        if (changes.descriptionHtml !== undefined) setDescriptionOverrides(descriptionOverrideRepository.update(perkId, changes.descriptionHtml));
        if (changes.categories !== undefined) setCategoryOverrides(categoryOverrideRepository.update(perkId, changes.categories));
        setRepositoryMessage("Personnalisations enregistrées dans votre compte.");
        return;
      }
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
    if (view === "administration" && !isAdmin) return;
    runUiTransition(() => {
      if (activeView === "perks" && view !== "perks" && selectedPerkId && !equippedPerkIds.includes(selectedPerkId)) {
        setSelectedPerkId(null);
      }
      if (view === "constants") {
        themePlaybackRequestRef.current += 1;
        killerThemeAudioRef.current?.pause();
        originalThemeAudioRef.current?.pause();
      } else if (activeView === "constants" && side === "killer" && selectedKiller && terrorRadiusAudioRef.current?.paused !== false) {
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
    if (!soundEnabled || blindTestRunning) return;
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
    theme.loop = true;
    theme.src = url;
    theme.onended = null;
    void theme.play().catch(() => undefined);
  }

  async function playOriginalKillerTheme(request = ++themePlaybackRequestRef.current): Promise<void> {
    if (!soundEnabled || blindTestRunning) return;
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
    terrorRadiusPlaybackRequestRef.current += 1;
    const audio = terrorRadiusAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setTerrorRadiusPlayback((current) => ({ ...current, currentTime: 0, isPlaying: false }));
  }

  async function toggleTerrorRadius(killer: Killer): Promise<void> {
    if (blindTestRunning || killer.terrorRadius <= 0) return;
    const audio = terrorRadiusAudioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      resumeThemeMusic();
      return;
    }

    const request = ++terrorRadiusPlaybackRequestRef.current;
    const url = await killerTerrorRadiusUrl(killer.id);
    if (request !== terrorRadiusPlaybackRequestRef.current || !url) return;
    if (terrorRadiusTrackUrlRef.current !== url) {
      audio.src = url;
      audio.currentTime = 0;
      terrorRadiusTrackUrlRef.current = url;
    }
    audio.volume = terrorRadiusPlayback.volume;
    audio.ontimeupdate = () => setTerrorRadiusPlayback((current) => ({ ...current, currentTime: audio.currentTime }));
    audio.onloadedmetadata = () => setTerrorRadiusPlayback((current) => ({ ...current, duration: audio.duration }));
    audio.onplay = () => setTerrorRadiusPlayback((current) => ({ ...current, isPlaying: true }));
    audio.onpause = () => setTerrorRadiusPlayback((current) => ({ ...current, isPlaying: false }));
    audio.onended = () => {
      setTerrorRadiusPlayback((current) => ({ ...current, currentTime: 0, isPlaying: false }));
      resumeThemeMusic();
    };
    pauseThemeMusic();
    await audio.play().catch(() => resumeThemeMusic());
  }

  function seekTerrorRadius(currentTime: number): void {
    const audio = terrorRadiusAudioRef.current;
    if (!audio) return;
    audio.currentTime = currentTime;
    setTerrorRadiusPlayback((current) => ({ ...current, currentTime }));
  }

  function setTerrorRadiusVolume(volume: number): void {
    const audio = terrorRadiusAudioRef.current;
    if (audio) audio.volume = volume;
    setTerrorRadiusPlayback((current) => ({ ...current, volume }));
  }

  function startBlindTestSession(): void {
    setBlindTestRunning(true);
    themePlaybackRequestRef.current += 1;
    killerThemeAudioRef.current?.pause();
    originalThemeAudioRef.current?.pause();
    stopTerrorRadius();
  }

  function stopBlindTestSession(): void {
    setBlindTestRunning(false);
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

  function restoreCatalogScroll(view: Exclude<CatalogView, "constants">): void {
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
      <StatisticsAutoSync serverUrl={currentAssistantServerUrl()} onSchedule={setNextStatisticsSyncAt} />
      <Topbar
        isAdmin={isAdmin}
        activeView={activeView}
        side={side}
        menu={topbarMenu}
        savedBuildCount={savedBuilds.filter((build) => build.side === side).length}
        hasBuild={selectedKiller !== null}
        installState={installState}
        canInstallApplication={canInstallApplication}
        isInstallingApplication={isInstallingApp}
        onInstallApplication={() => { void installApplication(); }}
        onViewChange={showView}
        onToggleSide={toggleSide}
        onMenuChange={setTopbarMenu}
        onHelp={() => setHowToPlayOpen(true)}
        onResetScenario={() => setScenario(emptyScenario())}
      />
      {topbarMenu === "settings" && <SettingsModal soundEnabled={soundEnabled} volume={musicVolume} onSoundEnabledChange={setSoundEnabled} onVolumeChange={setMusicVolume} onClose={() => setTopbarMenu(null)} />}
      {howToPlayOpen && <HowToPlayModal onClose={() => setHowToPlayOpen(false)} />}
      {killerInfo && <KillerInfoModal killer={killerInfo} killers={killers} onClose={() => setKillerInfo(null)} />}

      <BlindTestView active={activeView === "blindtest"} killers={killers} soundEnabled={soundEnabled} onSessionStart={startBlindTestSession} onSessionStop={stopBlindTestSession} />
      {activeView === "blindtest" ? null : activeView === "administration" && isAdmin ? <main aria-label="Administration" /> : activeView === "constants" ? <ConstantsView scrollTop={catalogScrollPositionsRef.current.constants} onScroll={(scrollTop) => rememberCatalogScroll("constants", scrollTop)} /> : activeView === "tiers" ? <TierListView killers={effectiveKillers} survivors={survivors} perkTierList={perkTierList} descriptionOverrides={descriptionOverrides} onMove={moveTier} /> : activeView === "statistics" ? <StatisticsView serverUrl={currentAssistantServerUrl()} nextSyncAt={nextStatisticsSyncAt} canEdit={isAdmin} /> : <main className={`analyzer-workspace view-${activeView}`} ref={workspaceRef} style={workspaceStyle}>
        <aside className={`analyzer-sidebar left-sidebar${activeView === "perks" ? " perks-sidebar" : ""}`}>
          <section className={`analyzer-panel selected-loadout-panel${activeView === "perks" ? " perks-loadout-panel" : ""}`} aria-label="Personnage et perks sélectionnés">
            <SelectedKillerCard killer={selectedKiller} side={side} onChange={() => showView("killers")} onRemove={removeKiller} terrorPlayback={terrorRadiusPlayback} onTerrorRadiusToggle={() => selectedKiller && void toggleTerrorRadius(selectedKiller)} onTerrorRadiusSeek={seekTerrorRadius} onTerrorRadiusVolumeChange={setTerrorRadiusVolume} onShowInfo={setKillerInfo} />
            <div className="build-editor-scroll-region">
              <BuildEditor perks={equippedPerks} selectedPerkId={selectedPerkId} compact={activeView === "perks"} onRemove={togglePerk} onBrowse={browsePerk} scenario={scenario} onConditionChange={setScenarioCondition} onPerkStateChange={setPerkRuntimeState} />
            </div>
          </section>
          <PerkFiltersPanel characters={activeCharacters} side={side} filters={perkFilters} detailsOpen={perkFilterDetailsOpen} onChange={updatePerkFilters} onDetailsOpenChange={updatePerkFilterDetailsOpen} />
        </aside>

        <ResizeHandle orientation="vertical" label="Redimensionner la sidebar gauche" onDelta={(delta) => resizeColumn("left", delta)} onReset={() => setPaneLayout(DEFAULT_PANE_LAYOUT)} />

        <div className={`analyzer-main-column ${activeView === "build" ? "build-view" : "catalog-view"}`}>
          {activeView === "build" && (
            <>
              {selectedKiller && calculation
                ? <BuildAnalyzer calculation={calculation} perks={equippedPerks} character={selectedKiller} side={side} serverUrl={currentAssistantServerUrl()} />
                : <EmptyCenterPanel title="Impact Analysis" action={`Choisir un ${side === "survivor" ? "survivant" : "tueur"}`} onAction={() => showView("killers")}>Sélectionnez un {side === "survivor" ? "survivant" : "tueur"} pour commencer l’analyse.</EmptyCenterPanel>}
              <ResizeHandle orientation="horizontal" label="Redimensionner l’analyse et l’assistant" onDelta={resizeCenter} onReset={() => setPaneLayout(DEFAULT_PANE_LAYOUT)} />
              <BuildAssistant currentBuild={currentBuildExport} allKillers={effectiveKillers} allSurvivors={survivors} allPerks={effectivePerks} savedBuilds={savedBuilds} perkTierList={perkTierList} howToPlay={howToPlayText} constants={fixedStatisticsText} perkDescriptionOverrides={descriptionOverrides} onApplyActions={applyChatActions} />
            </>
          )}

          {activeView === "killers" && (
            <section
              className="analyzer-panel impact-analysis workspace-catalog-panel killers-workspace-panel"
              ref={killerCatalogRef}
              onScroll={(event) => rememberCatalogScroll("killers", event.currentTarget.scrollTop)}
            >
              <KillerSelector killers={activeCharacters} side={side} selectedKillerId={selectedKillerId} options={killerOptions} listView={killerListView} filtersVisible={killerFiltersVisible} onOptionsChange={setKillerOptions} onListViewChange={setKillerListView} onFiltersVisibleChange={setKillerFiltersVisible} onShowInfo={setKillerInfo} onSelect={selectKiller} />
            </section>
          )}

          {activeView === "perks" && (
            <section
              className="analyzer-panel impact-analysis workspace-catalog-panel perks-workspace-panel"
              ref={perkCatalogRef}
              onScroll={(event) => rememberCatalogScroll("perks", event.currentTarget.scrollTop)}
            >
              {!selectedKiller && <p className="catalog-notice">Sélectionnez un {side === "survivor" ? "survivant" : "tueur"} avant d’ajouter des perks au build.</p>}
              <PerkBrowser
                perks={effectivePerks}
                characters={activeCharacters}
                side={side}
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
              canEdit={isAdmin}
              perk={selectedPerk}
              owner={selectedPerkOwner}
              descriptionOverride={descriptionOverrides[selectedPerk.id] ?? null}
              categoryOverride={Object.hasOwn(categoryOverrides, selectedPerk.id) ? categoryOverrides[selectedPerk.id] ?? [] : null}
              nativeCategories={selectedNativePerk?.categories ?? selectedPerk.categories}
              canEquip={selectedKiller !== null}
              isEquipped={equippedPerkIds.includes(selectedPerk.id)}
              buildIsFull={equippedPerkIds.length >= MAX_BUILD_PERKS}
              side={side}
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
                side={side}
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

function ConstantsView({ scrollTop, onScroll }: { scrollTop: number; onScroll: (scrollTop: number) => void }) {
  const [query, setQuery] = useState("");
  const pageRef = useRef<HTMLElement>(null);
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

  useEffect(() => {
    pageRef.current?.scrollTo({ top: scrollTop, behavior: "auto" });
  }, []);

  return <main className="constants-page" ref={pageRef} onScroll={(event) => onScroll(event.currentTarget.scrollTop)}>
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
  isAdmin,
  activeView,
  side,
  menu,
  savedBuildCount,
  hasBuild,
  installState,
  canInstallApplication,
  isInstallingApplication,
  onInstallApplication,
  onViewChange,
  onToggleSide,
  onMenuChange,
  onHelp,
  onResetScenario
}: {
  isAdmin: boolean;
  activeView: AppView;
  side: PerkSide;
  menu: TopbarMenu;
  savedBuildCount: number;
  hasBuild: boolean;
  installState: InstallState;
  canInstallApplication: boolean;
  isInstallingApplication: boolean;
  onInstallApplication: () => void;
  onViewChange: (view: AppView) => void;
  onToggleSide: () => void;
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
      <div className="brand-group">
        <button className="brand" type="button" onClick={() => onViewChange("build")}>
          <span className="brand-mark" aria-hidden="true">
            {appLogoUrl ? <img className="brand-logo" src={appLogoUrl} alt="" /> : <span className="brand-mark-text">Ⅳ</span>}
          </span>
          <span>Build Analyzer</span>
        </button>
        <button className="role-toggle" type="button" onClick={onToggleSide} aria-label={side === "killer" ? "Passer au mode Survivant" : "Passer au mode Tueur"} title={side === "killer" ? "Mode Tueur — passer en Survivant" : "Mode Survivant — passer en Tueur"}>
          <RoleIcon side={side} />
        </button>
      </div>
      <nav className="main-navigation" aria-label="Navigation principale">
        {(["build", "killers", "perks", "tiers", "blindtest", "constants", "statistics", ...(isAdmin ? ["administration"] : [])] as AppView[]).map((view) => (
          <button className={activeView === view ? "active" : ""} type="button" onClick={() => onViewChange(view)} aria-current={activeView === view ? "page" : undefined} key={view}>
            <span aria-hidden="true">{view === "build" ? "⌘" : view === "killers" ? side === "survivor" ? "◉" : "☠" : view === "perks" ? "◇" : view === "tiers" ? "♜" : view === "blindtest" ? "♪" : "≡"}</span>
            {view === "killers" ? side === "survivor" ? "Survivants" : "Killers" : view === "constants" ? "Constantes" : view === "tiers" ? "Tiers List" : view === "blindtest" ? "BlindTest" : view === "statistics" ? "Statistique" : `${view[0]?.toUpperCase()}${view.slice(1)}`}
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

function RoleIcon({ side }: { side: PerkSide }) {
  return side === "killer"
    ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="7" r="3" /><path d="M5 21v-2a7 7 0 0 1 14 0v2M3 12h18" /></svg>
    : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20 20 4M8 4h8l2 5-6 5-6-5 2-5ZM9 17h6" /></svg>;
}

function SettingsModal({ soundEnabled, volume, onSoundEnabledChange, onVolumeChange, onClose }: {
  soundEnabled: boolean;
  volume: number;
  onSoundEnabledChange: (enabled: boolean) => void;
  onVolumeChange: (volume: number) => void;
  onClose: () => void;
}) {
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (isHostedApp) return;
    let active = true;
    void checkAppUpdate(APP_UPDATE_SERVER)
      .then((status) => { if (active) setUpdateStatus(status); })
      .catch((error) => { if (active) setUpdateError(error instanceof Error ? error.message : "Vérification impossible."); });
    return () => { active = false; };
  }, []);

  async function updateApplication(): Promise<void> {
    if (!(updateStatus?.available || updateStatus?.gitMissing) || updating) return;
    setUpdating(true);
    setUpdateError(null);
    try {
      const status = await installAppUpdate(APP_UPDATE_SERVER);
      setUpdateStatus(status);
      setUpdating(false);
      if (!status.restartRequired) window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "Mise à jour impossible.");
      setUpdating(false);
    }
  }

  const versionLabel = updateStatus?.currentVersion
    ? `Installée : v${updateStatus.currentVersion} (${updateStatus.currentRevision})${updateStatus.latestVersion ? ` · GitHub : v${updateStatus.latestVersion} (${updateStatus.latestRevision})` : ""}`
    : null;
  const canUpdate = Boolean(updateStatus?.available || updateStatus?.gitMissing);

  return <div className="app-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="app-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><h2 id="settings-title">Paramètres</h2><button type="button" onClick={onClose} aria-label="Fermer">×</button></header>
      <label className="sound-toggle"><input type="checkbox" checked={soundEnabled} onChange={(event) => onSoundEnabledChange(event.target.checked)} /><span>Activer le son</span></label>
      <label className="field"><span>Volume musique</span><input type="range" min="0" max="1" step="0.05" value={volume} disabled={!soundEnabled} onChange={(event) => onVolumeChange(Number(event.target.value))} /></label>
      <div className="settings-update">
        {isHostedApp ? <p>Le site reçoit automatiquement les mises à jour publiées sur GitHub.</p> : <>
        <div><strong>Mise à jour</strong>{versionLabel && <small>{versionLabel}</small>}</div>
        <button className="primary-button" type="button" onClick={() => { void updateApplication(); }} disabled={!canUpdate || updating}>
          {updating ? "Mise à jour…" : updateStatus?.gitMissing ? "Installer Git et mettre à jour" : updateStatus?.available ? "Mettre à jour" : updateStatus ? updateStatus.blocked || !updateStatus.supported ? "Indisponible" : "À jour" : updateError ? "Service à redémarrer" : "Vérification…"}
        </button>
        <p className={updateError ? "error" : ""} role="status">{updateError ?? updateStatus?.message ?? "Recherche d’une nouvelle version sur GitHub…"}</p>
        </>}
      </div>
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
    appStorage.setItem(BUILD_CONVERSATIONS_STORAGE_KEY, JSON.stringify({ ...mappings, [buildId]: conversationKey }));
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
    appStorage.setItem(BUILD_CONVERSATIONS_STORAGE_KEY, JSON.stringify(mappings));
  } catch {
    // Aucune incidence sur la suppression du build lui-même.
  }
}

function readBuildConversations(): Record<string, string> {
  const raw = appStorage.getItem(BUILD_CONVERSATIONS_STORAGE_KEY);
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function isBuildDirty(build: Build, selectedKillerId: string | null, buildName: string, equippedPerkIds: readonly string[], side: PerkSide): boolean {
  return build.side !== side || build.killerId !== selectedKillerId || build.name !== buildName || !sameValuesInOrder(build.perkIds, equippedPerkIds);
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
    const storage = appStorage;
    storage.getItem(BUILDS_STORAGE_KEY);
    return { repository: new LocalBuildRepository(storage), persistent: true, warning: null };
  } catch {
    return { repository: new LocalBuildRepository(createMemoryStorage()), persistent: false, warning: "Stockage local indisponible : les builds seront conservés seulement pour cette session." };
  }
}

function createDescriptionOverrideRepository(): { repository: LocalDescriptionOverrideRepository; overrides: Record<string, string> } {
  try {
    const storage = appStorage;
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
    const repository = new LocalCategoryOverrideRepository(appStorage);
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

function createTierOverrideRepository(): { repository: LocalTierOverrideRepository; overrides: TierOverrides } {
  try {
    const repository = new LocalTierOverrideRepository(appStorage);
    return { repository, overrides: repository.list() };
  } catch {
    return { repository: new LocalTierOverrideRepository(createMemoryStorage()), overrides: { killers: {}, perks: {} } };
  }
}

function loadPersistedAppSession(): AppSession {
  try {
    return readAppSession(
      appStorage.getItem(APP_SESSION_STORAGE_KEY),
      new Set([...killers, ...survivors].map((character) => character.id)),
      new Set(perks.map((perk) => perk.id))
    );
  } catch {
    return readAppSession(null, new Set(), new Set());
  }
}

function currentAssistantServerUrl(): string {
  try {
    return normalizeServerUrl(appStorage.getItem(ASSISTANT_SERVER_STORAGE_KEY) ?? DEFAULT_ASSISTANT_SERVER);
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
