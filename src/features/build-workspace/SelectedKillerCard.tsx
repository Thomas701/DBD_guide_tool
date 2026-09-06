import { useEffect, useState } from "react";

import { killerPortraitUrl, killerTerrorRadiusUrl } from "../../app/assets.js";
import { difficultyLabels, sizeLabels } from "../../app/labels.js";
import type { Killer } from "../../domain/killer.js";

interface SelectedKillerCardProps {
  killer: Killer | null;
  onChange: () => void;
  onRemove: () => void;
  onTerrorRadiusStart: () => void;
  onTerrorRadiusStop: () => void;
  onShowInfo: (killer: Killer) => void;
}

export function SelectedKillerCard({ killer, onChange, onRemove, onTerrorRadiusStart, onTerrorRadiusStop, onShowInfo }: SelectedKillerCardProps) {
  const [terrorAudio, setTerrorAudio] = useState<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [terrorVolume, setTerrorVolume] = useState(0.7);
  const [volumeControlOpen, setVolumeControlOpen] = useState(false);

  useEffect(() => {
    terrorAudio?.pause();
    setIsPlaying(false);
    setCurrentTime(0);
  }, [killer?.id]);

  async function toggleTerrorRadius(): Promise<void> {
    if (!killer || killer.terrorRadius <= 0) return;
    if (terrorAudio && !terrorAudio.paused) {
      terrorAudio.pause();
      setIsPlaying(false);
      onTerrorRadiusStop();
      return;
    }
    const url = await killerTerrorRadiusUrl(killer.id);
    if (!url) return;
    const audio = terrorAudio?.src === url ? terrorAudio : new Audio(url);
    audio.volume = terrorVolume;
    audio.ontimeupdate = () => setCurrentTime(audio.currentTime);
    audio.onloadedmetadata = () => setDuration(audio.duration);
    audio.onended = () => { setIsPlaying(false); setCurrentTime(0); onTerrorRadiusStop(); };
    setTerrorAudio(audio);
    onTerrorRadiusStart();
    await audio.play().catch(() => { setIsPlaying(false); onTerrorRadiusStop(); });
    setIsPlaying(!audio.paused);
  }
  if (!killer) {
    return (
      <div className="killer-sidebar-card">
        <button className="empty-killer-card" type="button" onClick={onChange}>
          <span aria-hidden="true">+</span>
          <strong>Choisir un tueur</strong>
          <small>Ouvre le catalogue dans la zone centrale</small>
        </button>
      </div>
    );
  }
  const portrait = killerPortraitUrl(killer);
  return (
    <div className="killer-sidebar-card">
      <div className="selected-killer-compact">
        <div className="selected-killer-main" role="button" tabIndex={0} onClick={onChange} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onChange(); } }} aria-label="Changer de tueur">
          <span className="selected-killer-image">
            {portrait ? <img src={portrait} alt="" /> : <span className="image-placeholder" aria-hidden="true">?</span>}
            <span className="tier-mark">{killer.tier}</span>
          </span>
          <span className="selected-killer-info">
            <span className="killer-name-row"><strong>{killer.name.fr ?? killer.name.en ?? killer.id}</strong></span>
            {killer.name.en && killer.name.en !== killer.name.fr && <small>{killer.name.en}</small>}
            {killer.terrorRadius > 0 && <span className="terror-audio-control" onMouseLeave={() => setVolumeControlOpen(false)}><label className={`terror-radius-player${volumeControlOpen ? " volume-open" : ""}`} onClick={(event) => event.stopPropagation()}><button className="killer-card-audio" type="button" onClick={(event) => { event.stopPropagation(); void toggleTerrorRadius(); }} aria-label="Lire ou mettre en pause le rayon de terreur">{isPlaying ? "❚❚" : "▶"}</button><span>{formatTime(currentTime)} / {formatTime(duration)}</span><input className="terror-timing-range" type="range" min="0" max={duration || 0} step="0.1" value={Math.min(currentTime, duration || 0)} onChange={(event) => { if (terrorAudio) terrorAudio.currentTime = Number(event.target.value); }} /><input className="terror-volume-range" type="range" min="0" max="1" step="0.05" value={terrorVolume} onChange={(event) => { const volume = Number(event.target.value); setTerrorVolume(volume); if (terrorAudio) terrorAudio.volume = volume; }} aria-label="Volume du rayon de terreur" /><button className="terror-volume-toggle" type="button" onClick={(event) => event.stopPropagation()} onMouseEnter={() => setVolumeControlOpen(true)} onFocus={() => setVolumeControlOpen(true)} aria-label="Régler le volume du rayon de terreur">🔊</button></label></span>}
            <span className="killer-facts">
              <span><i>Movement Speed</i><b>{killer.speed.toFixed(2)} m/s</b></span>
              <span><i>Terror Radius</i><b>{killer.terrorRadius} m</b></span>
              <span><i>Size</i><b>{sizeLabels[killer.size]}</b></span>
              <span><i>Difficulty</i><b>{difficultyLabels[killer.difficulty]}</b></span>
            </span>
          </span>
        </div>
        <button className="killer-card-info" type="button" onClick={() => onShowInfo(killer)} aria-label={`Afficher le pouvoir de ${killer.name.fr ?? killer.id}`}>i</button>
        <button className="selected-killer-remove" type="button" onClick={onRemove} aria-label={`Retirer ${killer.name.fr ?? killer.name.en ?? killer.id}`}>×</button>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}
