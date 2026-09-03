import { killerById, perkById } from "../../app/catalog.js";
import type { Build } from "../../domain/build.js";

interface SavedBuildsProps {
  builds: readonly Build[];
  activeBuildId: string | null;
  buildName: string;
  buildNamePlaceholder: string;
  hasUnsavedChanges: boolean;
  canResetStorage: boolean;
  canEdit: boolean;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onNew: () => void;
  onLoad: (build: Build) => void;
  onDelete: (build: Build) => void;
  onResetStorage: () => void;
}

interface SavedBuildLauncherProps {
  builds: readonly Build[];
  message: string | null;
  canResetStorage: boolean;
  onLoad: (build: Build) => void;
  onResetStorage: () => void;
}

export function SavedBuildLauncher({ builds, message, canResetStorage, onLoad, onResetStorage }: SavedBuildLauncherProps) {
  if (builds.length === 0 && !message && !canResetStorage) return null;
  return (
    <section className="page-shell saved-launcher" aria-labelledby="saved-launcher-title">
      <div><p className="eyebrow">Reprendre</p><h2 id="saved-launcher-title">Builds sauvegardés</h2></div>
      {message && <p className="repository-message" role="status">{message}</p>}
      {canResetStorage && <button className="secondary-button storage-reset" type="button" onClick={onResetStorage}>Réinitialiser le stockage illisible</button>}
      <div className="launcher-list">
        {builds.map((build) => (
          <button className="launcher-build" type="button" key={build.id} onClick={() => onLoad(build)}>
            <strong>{build.name}</strong><small>{buildSummary(build)}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

export function SavedBuilds({
  builds,
  activeBuildId,
  buildName,
  buildNamePlaceholder,
  hasUnsavedChanges,
  canResetStorage,
  canEdit,
  onNameChange,
  onSave,
  onSaveAs,
  onNew,
  onLoad,
  onDelete,
  onResetStorage
}: SavedBuildsProps) {
  return (
    <div className="build-manager-content" aria-labelledby="saved-builds-title">
      <div className="compact-section-heading">
        <div>
          <span className="section-icon" aria-hidden="true">□</span>
          <h2 id="saved-builds-title">Build Manager</h2>
          {hasUnsavedChanges && <span className="unsaved-dot" title="Modifications non enregistrées" aria-label="Modifications non enregistrées" />}
        </div>
        <button className="text-button" type="button" onClick={onNew} disabled={!canEdit}>Nouveau</button>
      </div>

      <div className="open-build-row">
        <label className="open-build-field">
          <span className="sr-only">Ouvrir un build</span>
          <select value={activeBuildId ?? ""} onChange={(event) => {
            const build = builds.find((candidate) => candidate.id === event.target.value);
            if (build) onLoad(build);
          }} disabled={builds.length === 0}>
            <option value="">Ouvrir un build…</option>
            {builds.map((build) => <option value={build.id} key={build.id}>{build.name}</option>)}
          </select>
        </label>
        <button
          className="manager-icon-button danger"
          type="button"
          disabled={!activeBuildId}
          onClick={() => {
            const build = builds.find((candidate) => candidate.id === activeBuildId);
            if (build) onDelete(build);
          }}
          aria-label="Supprimer le build sélectionné"
          title="Supprimer le build sélectionné"
        ><TrashIcon /></button>
      </div>

      <div className="manager-edit-row">
        <label className="manager-name-field">
          <span>Build Name</span>
          <input type="text" value={buildName} onChange={(event) => onNameChange(event.target.value)} maxLength={80} placeholder={buildNamePlaceholder} disabled={!canEdit} />
        </label>
        <button className="manager-icon-button" type="button" onClick={onSaveAs} disabled={!canEdit || !buildName.trim()} aria-label="Dupliquer le build" title="Dupliquer"><DuplicateIcon /></button>
        <button className="primary-button manager-save-button" type="button" onClick={onSave} disabled={!canEdit || !buildName.trim()}>Sauvegarder</button>
      </div>
      {canResetStorage && <button className="secondary-button storage-reset" type="button" onClick={onResetStorage}>Réinitialiser le stockage illisible</button>}
    </div>
  );
}

function DuplicateIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="2" /><path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" /></svg>;
}

function TrashIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 7h16M10 3h4M18 7l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7M10 11v6M14 11v6" /></svg>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function buildSummary(build: Build): string {
  const killer = killerById.get(build.killerId);
  const killerName = killer?.name.fr ?? killer?.name.en ?? build.killerId;
  const perkNames = build.perkIds.map((id) => {
    const perk = perkById.get(id);
    return perk?.name.fr ?? perk?.name.en ?? `[${id}]`;
  });
  return `${killerName} · ${perkNames.length > 0 ? perkNames.join(", ") : "aucune perk"}`;
}
