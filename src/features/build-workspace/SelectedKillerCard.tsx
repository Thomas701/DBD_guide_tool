import { killerPortraitUrl } from "../../app/assets.js";
import { difficultyLabels, sizeLabels } from "../../app/labels.js";
import type { Killer } from "../../domain/killer.js";

interface SelectedKillerCardProps {
  killer: Killer | null;
  onChange: () => void;
}

export function SelectedKillerCard({ killer, onChange }: SelectedKillerCardProps) {
  if (!killer) {
    return (
      <section className="analyzer-panel killer-sidebar-card" aria-labelledby="selected-killer-title">
        <div className="compact-section-heading">
          <div><span className="section-icon target-icon" aria-hidden="true">⌾</span><h2 id="selected-killer-title">Selected Killer</h2></div>
        </div>
        <button className="empty-killer-card" type="button" onClick={onChange}>
          <span aria-hidden="true">+</span>
          <strong>Choisir un tueur</strong>
          <small>Ouvre le catalogue dans la zone centrale</small>
        </button>
      </section>
    );
  }
  const portrait = killerPortraitUrl(killer);
  return (
    <section className="analyzer-panel killer-sidebar-card" aria-labelledby="selected-killer-title">
      <div className="compact-section-heading">
        <div>
          <span className="section-icon target-icon" aria-hidden="true">⌾</span>
          <h2 id="selected-killer-title">Selected Killer</h2>
        </div>
      </div>
      <button className="selected-killer-compact" type="button" onClick={onChange} aria-label="Changer de tueur">
        <span className="selected-killer-image">
          {portrait ? <img src={portrait} alt="" /> : <span className="image-placeholder" aria-hidden="true">?</span>}
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
    </section>
  );
}
