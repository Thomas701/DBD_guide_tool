import { useState } from "react";

import { killerPortraitUrl } from "../../app/assets.js";
import { difficultyLabels, sizeLabels } from "../../app/labels.js";
import type { Killer } from "../../domain/killer.js";

interface SelectedKillerCardProps {
  killer: Killer | null;
  onChange: () => void;
  onRemove: () => void;
  terrorPlayback: { currentTime: number; duration: number; isPlaying: boolean; volume: number };
  onTerrorRadiusToggle: () => void;
  onTerrorRadiusSeek: (currentTime: number) => void;
  onTerrorRadiusVolumeChange: (volume: number) => void;
  onShowInfo: (killer: Killer) => void;
}

export function SelectedKillerCard({ killer, onChange, onRemove, terrorPlayback, onTerrorRadiusToggle, onTerrorRadiusSeek, onTerrorRadiusVolumeChange, onShowInfo }: SelectedKillerCardProps) {
  const [volumeControlOpen, setVolumeControlOpen] = useState(false);
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
            {killer.terrorRadius > 0 && <span className="terror-audio-control" onMouseLeave={() => setVolumeControlOpen(false)}><label className={`terror-radius-player${volumeControlOpen ? " volume-open" : ""}`} onClick={(event) => event.stopPropagation()}><button className="killer-card-audio" type="button" onClick={(event) => { event.stopPropagation(); onTerrorRadiusToggle(); }} aria-label="Lire ou mettre en pause le rayon de terreur">{terrorPlayback.isPlaying ? "❚❚" : "▶"}</button><span>{formatTime(terrorPlayback.currentTime)} / {formatTime(terrorPlayback.duration)}</span><input className="terror-timing-range" type="range" min="0" max={terrorPlayback.duration || 0} step="0.1" value={Math.min(terrorPlayback.currentTime, terrorPlayback.duration || 0)} onChange={(event) => onTerrorRadiusSeek(Number(event.target.value))} /><input className="terror-volume-range" type="range" min="0" max="1" step="0.05" value={terrorPlayback.volume} onChange={(event) => onTerrorRadiusVolumeChange(Number(event.target.value))} aria-label="Volume du rayon de terreur" /><button className="terror-volume-toggle" type="button" onClick={(event) => event.stopPropagation()} onMouseEnter={() => setVolumeControlOpen(true)} onFocus={() => setVolumeControlOpen(true)} aria-label="Régler le volume du rayon de terreur">🔊</button></label></span>}
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
