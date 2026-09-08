import { useEffect, useRef, useState } from "react";

import { killerBreathingUrl, killerPortraitUrl, killerTerrorRadiusUrl, killerThemeUrl } from "../../app/assets.js";
import type { Killer } from "../../domain/killer.js";
import { blindTestResultComment, getBlindTestPlayback, pickWeightedBlindTestTrack, type BlindTestAudioKind, type BlindTestTrack } from "../../services/blind-test.js";

type BlindTestSource = BlindTestAudioKind | "all";
type BlindTestPhase = "setup" | "loading" | "question" | "result" | "complete";

interface BlindTestViewProps {
  active: boolean;
  killers: readonly Killer[];
  soundEnabled: boolean;
  onSessionStart: () => void;
  onSessionStop: () => void;
}

interface BlindTestRun {
  tracks: readonly BlindTestTrack[];
  totalQuestions: number;
  seconds: number;
  answered: number;
}

const sourceLabels: Record<BlindTestSource, string> = {
  theme: "Musique thème",
  terror: "Rayon de terreur",
  breathing: "Respiration",
  all: "TOUT"
};

export function BlindTestView({ active, killers, soundEnabled, onSessionStart, onSessionStop }: BlindTestViewProps) {
  const [source, setSource] = useState<BlindTestSource>("all");
  const [questionCount, setQuestionCount] = useState(10);
  const [seconds, setSeconds] = useState(10);
  const [volume, setVolume] = useState(0.7);
  const [phase, setPhase] = useState<BlindTestPhase>("setup");
  const [question, setQuestion] = useState<BlindTestTrack | null>(null);
  const [selectedKillerId, setSelectedKillerId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [score, setScore] = useState(0);
  const [result, setResult] = useState<boolean | null>(null);
  const [filter, setFilter] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const weightsRef = useRef<Record<string, number>>({});
  const runRef = useRef<BlindTestRun | null>(null);
  const requestRef = useRef(0);
  const currentQuestionRef = useRef<BlindTestTrack | null>(null);
  const selectedKillerRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const resultTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    audioRef.current = new Audio();
    return () => stopBlindTest();
  }, []);

  useEffect(() => {
    if (!soundEnabled && phase !== "setup" && phase !== "complete") stopBlindTest();
  }, [soundEnabled]);

  function clearTimers(): void {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    if (resultTimeoutRef.current !== null) window.clearTimeout(resultTimeoutRef.current);
    timerRef.current = null;
    timeoutRef.current = null;
    resultTimeoutRef.current = null;
  }

  function updateBlindTestVolume(nextVolume: number): void {
    setVolume(nextVolume);
    if (audioRef.current) audioRef.current.volume = nextVolume;
  }

  function stopBlindTest(): void {
    requestRef.current += 1;
    clearTimers();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.onended = null;
    }
    runRef.current = null;
    currentQuestionRef.current = null;
    selectedKillerRef.current = null;
    setQuestion(null);
    setSelectedKillerId(null);
    setCountdown(0);
    setResult(null);
    setPhase("setup");
    onSessionStop();
  }

  async function loadTracks(): Promise<BlindTestTrack[]> {
    const kinds = source === "all" ? (["theme", "terror", "breathing"] as const) : [source];
    const resolved = await Promise.all(killers.flatMap((killer) => kinds.map(async (kind) => {
      const url = kind === "theme"
        ? await killerThemeUrl(killer.id)
        : kind === "terror"
          ? await killerTerrorRadiusUrl(killer.id)
          : await killerBreathingUrl(killer.id);
      return url ? { id: `${kind}:${killer.id}`, killerId: killer.id, kind, url } satisfies BlindTestTrack : null;
    })));
    return resolved.filter((track): track is BlindTestTrack => track !== null);
  }

  async function startBlindTest(): Promise<void> {
    if (!soundEnabled) return;
    const request = ++requestRef.current;
    setPhase("loading");
    setScore(0);
    setResult(null);
    onSessionStart();
    const tracks = await loadTracks();
    if (request !== requestRef.current) return;
    if (tracks.length === 0) {
      setPhase("setup");
      onSessionStop();
      return;
    }
    runRef.current = { tracks, totalQuestions: questionCount, seconds, answered: 0 };
    weightsRef.current = Object.fromEntries(tracks.map((track) => [track.id, 1]));
    startQuestion();
  }

  async function startQuestion(): Promise<void> {
    clearTimers();
    const run = runRef.current;
    const audio = audioRef.current;
    if (!run || !audio) return;
    const pick = pickWeightedBlindTestTrack(run.tracks, weightsRef.current);
    if (!pick) return stopBlindTest();
    weightsRef.current = pick.weights;
    currentQuestionRef.current = pick.track;
    selectedKillerRef.current = null;
    setQuestion(pick.track);
    setSelectedKillerId(null);
    setFilter("");
    setResult(null);
    setPhase("question");
    audio.pause();
    audio.src = pick.track.url;
    audio.volume = volume;
    audio.currentTime = 0;
    const request = ++requestRef.current;
    await waitForMetadata(audio);
    if (request !== requestRef.current || currentQuestionRef.current?.id !== pick.track.id) return;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : run.seconds;
    const playback = getBlindTestPlayback(duration, run.seconds, pick.track.kind);
    const questionDuration = run.seconds;
    audio.loop = playback.loop;
    audio.currentTime = playback.startTime;
    const deadline = performance.now() + questionDuration * 1000;
    const updateCountdown = (): void => setCountdown(Math.max(0, Math.ceil((deadline - performance.now()) / 1000)));
    updateCountdown();
    timerRef.current = window.setInterval(updateCountdown, 100);
    timeoutRef.current = window.setTimeout(() => finishQuestion(pick.track.id), questionDuration * 1000);
    audio.onended = playback.loop ? null : () => finishQuestion(pick.track.id);
    await audio.play().catch(() => finishQuestion(pick.track.id));
  }

  function finishQuestion(trackId: string): void {
    if (currentQuestionRef.current?.id !== trackId) return;
    clearTimers();
    audioRef.current?.pause();
    const correct = selectedKillerRef.current === currentQuestionRef.current.killerId;
    setResult(correct);
    setScore((current) => current + (correct ? 1 : 0));
    setPhase("result");
    const run = runRef.current;
    if (!run) return;
    run.answered += 1;
    resultTimeoutRef.current = window.setTimeout(() => {
      if (!runRef.current) return;
      if (run.answered >= run.totalQuestions) {
        currentQuestionRef.current = null;
        setPhase("complete");
        onSessionStop();
        return;
      }
      void startQuestion();
    }, 2500);
  }

  const normalizedFilter = filter.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const visibleKillers = killers.filter((killer) => (killer.name.fr ?? killer.name.en ?? killer.id)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(normalizedFilter));
  const run = runRef.current;
  const currentKiller = question ? killers.find((killer) => killer.id === question.killerId) ?? null : null;
  const selectedKiller = selectedKillerId ? killers.find((killer) => killer.id === selectedKillerId) ?? null : null;
  const isRunning = phase === "loading" || phase === "question" || phase === "result";

  return <main className={`blind-test-page${active ? "" : " blind-test-hidden"}`} aria-hidden={!active}>
    <label className="blind-test-volume">
      <span>Volume BlindTest</span>
      <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => updateBlindTestVolume(Number(event.target.value))} />
    </label>
    {!isRunning && phase !== "complete" ? <section className="blind-test-setup">
      <header><h1>BlindTest</h1><p>Identifiez le tueur avant la fin du compte à rebours.</p></header>
      <div className="blind-test-fields">
        <label className="blind-test-field"><span>Source audio</span><select value={source} onChange={(event) => setSource(event.target.value as BlindTestSource)}>{(Object.keys(sourceLabels) as BlindTestSource[]).map((kind) => <option key={kind} value={kind}>{sourceLabels[kind]}</option>)}</select></label>
        <label className="blind-test-field"><span>Nombre de questions</span><span className="blind-test-stepper"><button type="button" aria-label="Retirer une question" disabled={questionCount <= 1} onClick={() => setQuestionCount((count) => Math.max(1, count - 1))}>−</button><strong>{questionCount}</strong><button type="button" aria-label="Ajouter une question" disabled={questionCount >= 50} onClick={() => setQuestionCount((count) => Math.min(50, count + 1))}>+</button></span></label>
        <label className="blind-test-field"><span>Temps par question : {seconds} s</span><input type="range" min="1" max="20" value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} /></label>
      </div>
      <button className="blind-test-play" type="button" disabled={!soundEnabled} onClick={() => void startBlindTest()}>▶ Play</button>
      {!soundEnabled && <small className="blind-test-muted">Activez le son dans les paramètres pour lancer une partie.</small>}
    </section> : phase === "complete" ? <section className="blind-test-complete"><span className="eyebrow">Partie terminée</span><h1>{score} / {run?.totalQuestions ?? questionCount}</h1><p>{blindTestResultComment(score, run?.totalQuestions ?? questionCount)}</p><button className="blind-test-play" type="button" onClick={() => { setPhase("setup"); setQuestion(null); }}>Nouvelle partie</button></section> : <section className="blind-test-game">
      <header className="blind-test-score"><span>Score</span><strong>{score} / {run?.totalQuestions ?? questionCount}</strong><small>Question {(run?.answered ?? 0) + 1}</small></header>
      <button className="blind-test-abandon" type="button" onClick={stopBlindTest}>Abandonner</button>
      <div className={`blind-test-countdown${phase === "result" ? result ? " correct" : " incorrect" : ""}`}>
        <div className="blind-test-answer"><span>Votre choix</span><div className="blind-test-answer-portrait">{selectedKiller && killerPortraitUrl(selectedKiller) ? <img src={killerPortraitUrl(selectedKiller)!} alt="Portrait du tueur sélectionné" /> : <strong>?</strong>}</div></div>
        <strong className="blind-test-countdown-value">{phase === "loading" ? "…" : countdown}</strong>
        <div className="blind-test-answer"><span>Réponse</span><div className="blind-test-answer-portrait">{phase === "result" && currentKiller && killerPortraitUrl(currentKiller) ? <img src={killerPortraitUrl(currentKiller)!} alt="Portrait du tueur révélé" /> : <strong>?</strong>}</div></div>
      </div>
      <section className="blind-test-killers" aria-label="Choisir un tueur"><label><span>Rechercher un tueur</span><input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Nom du tueur" autoComplete="off" /></label><div>{visibleKillers.map((killer) => <button key={killer.id} type="button" disabled={phase !== "question"} className={selectedKillerId === killer.id ? "selected" : ""} onClick={() => { selectedKillerRef.current = killer.id; setSelectedKillerId(killer.id); }}><span>{killerPortraitUrl(killer) ? <img src={killerPortraitUrl(killer)!} alt="" /> : "?"}</span>{killer.name.fr ?? killer.name.en ?? killer.id}</button>)}</div></section>
    </section>}
  </main>;
}

async function waitForMetadata(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return;
  await new Promise<void>((resolve) => {
    audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
    audio.addEventListener("error", () => resolve(), { once: true });
  });
}
