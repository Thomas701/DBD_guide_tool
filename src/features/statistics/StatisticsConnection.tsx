import { useEffect, useState } from "react";
import { supabase } from "../../app/cloud.js";
import { statisticsExtensionMessage } from "../../services/statistics-extension.js";

export function StatisticsConnection() {
  const [installed, setInstalled] = useState(false);
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void supabase!.rpc("statistics_collector_status").then(({ data }) => { if (active) setLinked(Boolean(data?.remote)); }, () => undefined);
    void (async () => {
      const session = await supabase!.auth.getSession();
      const reply = await statisticsExtensionMessage({ type: "DBD_EXTENSION_STATUS" });
      if (active) { setInstalled(true); if (reply.userId === session.data.session?.user.id) setLinked(true); }
    })().catch(() => undefined);
    return () => { active = false; };
  }, []);
  async function connect(): Promise<void> {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const extension = await statisticsExtensionMessage({ type: "DBD_EXTENSION_STATUS" });
      if (!extension.remoteSupported) throw new Error("Mettez l’extension à jour vers la version 0.3.0, puis rechargez cette page.");
      const session = await supabase!.auth.getSession();
      if (!session.data.session) throw new Error("Reconnectez-vous à votre compte.");
      const result = await supabase!.rpc("create_statistics_collector");
      if (result.error) throw result.error;
      const reply = await statisticsExtensionMessage({ type: "DBD_EXTENSION_PAIR", pairing: {
        userId: session.data.session.user.id,
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        collectorToken: result.data,
      } });
      setInstalled(true); setLinked(true);
      setNotice(reply.loginRequired ? "Ouvrez Behaviour ci-dessous et connectez le compte de ce joueur une fois. Vous pourrez ensuite fermer le navigateur." : "Activation distante en cours. Supabase prendra ensuite le relais, même navigateur fermé et PC éteint.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Connexion impossible."); }
    finally { setBusy(false); }
  }
  async function disconnect(): Promise<void> {
    setBusy(true); setError(null);
    try {
      const session = await supabase!.auth.getSession();
      const result = await supabase!.rpc("revoke_statistics_collector");
      if (result.error) throw result.error;
      await statisticsExtensionMessage({ type: "DBD_EXTENSION_DISCONNECT", userId: session.data.session?.user.id }).catch(() => undefined);
      setLinked(false); setNotice("Synchronisation désactivée. Vos statistiques enregistrées restent conservées.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Déconnexion impossible."); }
    finally { setBusy(false); }
  }
  return <section className="statistics-connection" aria-label="Connexion Behaviour">
    <h2>Vos statistiques Behaviour</h2>
    <p>Chaque joueur associe une première fois son compte Behaviour avec l’extension. Ses jetons de connexion sont conservés chiffrés dans Supabase pour permettre la collecte distante.</p>
    <p>Le serveur synchronise ensuite les statistiques toutes les cinq minutes, même navigateur fermé et PC éteint. La connexion est renouvelée automatiquement tant que Behaviour l’autorise.</p>
    <p><a href="https://stats.deadbydaylight.com/statistics/" target="_blank" rel="noreferrer">Se connecter à Behaviour</a> · Vous pouvez fermer l’onglet après la connexion.</p>
    {!installed && <p><a className="secondary-button" href={`${import.meta.env.BASE_URL}dbd-statistics-extension.zip`} download>Télécharger l’extension Chrome / Edge</a> <a href={`${import.meta.env.BASE_URL}extension-installation.html`} target="_blank" rel="noreferrer">Instructions d’installation</a></p>}
    <button className="primary-button" type="button" disabled={busy} onClick={() => void connect()}>{busy ? "Veuillez patienter…" : linked ? "Reconnecter Behaviour" : "Connecter mes statistiques"}</button>
    {linked && <button className="secondary-button" type="button" disabled={busy} onClick={() => void disconnect()}>Désactiver la synchronisation</button>}
    {linked && <p>La désactivation arrête la collecte distante et supprime les jetons Behaviour du serveur.</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
