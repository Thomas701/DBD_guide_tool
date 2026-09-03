import { killerPortraitUrl } from "../../app/assets.js";
import { difficultyLabels, sizeLabels } from "../../app/labels.js";
import type { Killer } from "../../domain/killer.js";

interface SelectedKillerCardProps {
  killer: Killer | null;
  onChange: () => void;
  onRemove: () => void;
}

export function SelectedKillerCard({ killer, onChange, onRemove }: SelectedKillerCardProps) {
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
        <button className="selected-killer-main" type="button" onClick={onChange} aria-label="Changer de tueur">
          <span className="selected-killer-image">
            {portrait ? <img src={portrait} alt="" /> : <span className="image-placeholder" aria-hidden="true">?</span>}
            <span className="tier-mark">{killer.tier}</span>
          </span>
          <span className="selected-killer-info">
            <strong>{killer.name.fr ?? killer.name.en ?? killer.id}</strong>
            {killer.name.en && killer.name.en !== killer.name.fr && <small>{killer.name.en}</small>}
            <span className="killer-facts">
              <span><i>Movement Speed</i><b>{killer.speed.toFixed(2)} m/s</b></span>
              <span><i>Terror Radius</i><b>{killer.terrorRadius} m</b></span>
              <span><i>Size</i><b>{sizeLabels[killer.size]}</b></span>
              <span><i>Difficulty</i><b>{difficultyLabels[killer.difficulty]}</b></span>
            </span>
          </span>
        </button>
        <button className="selected-killer-remove" type="button" onClick={onRemove} aria-label={`Retirer ${killer.name.fr ?? killer.name.en ?? killer.id}`}>×</button>
      </div>
    </div>
  );
}
