import { useEffect, useState } from "react";
import { communityRpc, type AdministrationUser } from "../../services/community.js";

const date = (value: string | null) => value ? new Date(value).toLocaleString("fr-FR") : "Jamais";
export function AdministrationView({ onInspect, canManageAccounts = false }: { onInspect?: ((user: AdministrationUser) => void) | undefined; canManageAccounts?: boolean }) {
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{ total: number; users: AdministrationUser[] }>({ total: 0, users: [] });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState<string | null>(null);
  async function manage(user: AdministrationUser, action: "admin_promote_consultant" | "admin_delete_account"): Promise<void> {
    if (!canManageAccounts || busy) return;
    if (action === "admin_delete_account" && !window.confirm(`Supprimer définitivement le compte ${user.email ?? user.id} et toutes ses données ?`)) return;
    setBusy(user.id); setError(null);
    try { await communityRpc(action, { target_user: user.id }); setRevision(value => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Modification impossible."); }
    finally { setBusy(null); }
  }
  useEffect(() => {
    let active = true; setLoading(true); setError(null);
    void communityRpc<typeof result>("admin_users", { page_index: page }).then(data => { if (active) { setResult(data); if (!data.users.length && page > 0) setPage(page - 1); } })
      .catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, revision]);
  return <main className="community-page" aria-label="Administration">
    <h1>Administration</h1><p>Comptes de l’application. L’icône œil ouvre une consultation en lecture seule.</p>
    {error && <p role="alert">{error}</p>}{loading ? <p role="status">Chargement des utilisateurs…</p> : <>
      <div className="community-table-scroll"><table><thead><tr><th>Email</th><th>Création du compte</th><th>Rôle</th><th>Behaviour synchronisé</th><th>Dernière connexion</th><th>Consulter</th>{canManageAccounts && <th>Gestion du compte</th>}</tr></thead>
        <tbody>{result.users.map(user => <tr key={user.id}><td>{user.email ?? "Sans email"}</td><td>{date(user.created_at)}</td>
          <td>{user.administrator ? "Administrateur" : user.consultant ? "Consultant" : "Joueur"}</td><td>{user.behaviour_synced ? "Oui" : "Non"}</td><td>{date(user.last_sign_in_at)}</td>
          <td><button type="button" className="manager-icon-button" disabled={!onInspect} aria-label={`Visualiser ${user.email ?? user.id} en lecture seule`} onClick={() => onInspect?.(user)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
          </button></td>{canManageAccounts && <td className="community-account-actions">
            {!user.administrator && !user.consultant && <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => void manage(user, "admin_promote_consultant")}>Promouvoir consultant</button>}
            <button type="button" className="secondary-button danger" disabled={busy !== null} onClick={() => void manage(user, "admin_delete_account")}>Supprimer le compte</button>
          </td>}</tr>)}</tbody></table></div>
      <CommunityPagination page={page} total={result.total} onChange={setPage} />
    </>}
  </main>;
}

export function CommunityPagination({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / 50));
  return <nav className="community-pagination" aria-label="Pagination"><button type="button" className="secondary-button" disabled={page === 0} onClick={() => onChange(page - 1)}>Précédent</button>
    <span>Page {page + 1} / {pages} · {total} joueur{total > 1 ? "s" : ""}</span>
    <button type="button" className="secondary-button" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>Suivant</button></nav>;
}
