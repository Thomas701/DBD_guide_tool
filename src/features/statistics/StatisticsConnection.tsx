import { useEffect, useRef, useState } from "react";
import { supabase } from "../../app/cloud.js";
import { statisticsBrowser, statisticsExtensionMessage, statisticsStoreUrl } from "../../services/statistics-extension.js";

const SETUP_KEY = "dbd-statistics-setup";

export function StatisticsConnection() {
  const browser = statisticsBrowser(navigator.userAgent);
  const [installed, setInstalled] = useState(false);
  const [linked, setLinked] = useState(false);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [storeUrl, setStoreUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busyRef = useRef(false), attempted = useRef(false), userId = useRef<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    let active = true, checking = false;
    void fetch(`${import.meta.env.BASE_URL}extension-store.json`).then(response => response.json()).then(data => {
      if (active) setStoreUrl(statisticsStoreUrl(data.chromeWebStoreUrl));
    }).catch(() => undefined);
    async function check(): Promise<void> {
      if (checking || busyRef.current) return;
      const current = generation.current;
      checking = true;
      try {
        const session = await supabase!.auth.getSession();
        const owner = session.data.session?.user.id ?? null;
        const [server, extension] = await Promise.all([
          supabase!.rpc("statistics_collector_status"),
          statisticsExtensionMessage({ type: "DBD_EXTENSION_STATUS" }).catch(() => null),
        ]);
        if (!active || busyRef.current || current !== generation.current) return;
        userId.current = owner;
        const available = Boolean(extension?.guidedSetupSupported);
        setInstalled(available); setReady(true);
        const waiting = Boolean(owner && sessionStorage.getItem(SETUP_KEY) === owner);
        setPending(waiting);
        if (!server.error) {
          setLinked(Boolean(server.data?.remote && server.data.state !== "waiting_for_login"));
          if (server.data?.remote && server.data.state === "success" && waiting) {
            sessionStorage.removeItem(SETUP_KEY); setPending(false); setError(null);
            setNotice("Synchronisation distante activée. Vous pouvez fermer le navigateur et éteindre votre PC.");
            return;
          }
          if (server.data?.remote && server.data.state === "waiting_for_login" && server.data.lastSeenAt) {
            sessionStorage.removeItem(SETUP_KEY); setPending(false);
            setError(server.data.message ?? "Behaviour demande une nouvelle connexion.");
            return;
          }
          if (waiting && server.data?.remote && server.data.state === "error") setNotice(server.data.message);
        }
        if (waiting && !server.data?.remote && extension?.userId === owner && extension.status?.includes("indisponible")) setNotice(extension.status);
        if (waiting && available && !attempted.current) { attempted.current = true; void connect(); }
      } finally { checking = false; }
    }
    const refresh = () => { void check().catch(() => undefined); };
    const extensionReady = (event: MessageEvent) => {
      if (event.source === window && event.origin === location.origin && event.data?.source === "DBD_STATISTICS_EXTENSION" && event.data.type === "READY") refresh();
    };
    refresh();
    const timer = window.setInterval(() => { if (sessionStorage.getItem(SETUP_KEY)) refresh(); }, 2_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("message", extensionReady);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("message", extensionReady); };
  }, []);

  async function connect(): Promise<void> {
    if (busyRef.current) return;
    generation.current++;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const extension = await statisticsExtensionMessage({ type: "DBD_EXTENSION_STATUS" });
      if (!extension.guidedSetupSupported) throw new Error("Installez la dernière version de l’extension pour continuer.");
      const session = await supabase!.auth.getSession();
      const owner = session.data.session?.user.id;
      if (!owner) throw new Error("Reconnectez-vous à votre compte.");
      let reply;
      if (extension.userId === owner && !extension.cloudConnected) {
        reply = await statisticsExtensionMessage({ type: "DBD_EXTENSION_LOGIN", userId: owner });
      } else {
        const result = await supabase!.rpc("create_statistics_collector");
        if (result.error) throw result.error;
        reply = await statisticsExtensionMessage({ type: "DBD_EXTENSION_PAIR", openLogin: true, forceLogin: extension.userId === owner && extension.cloudConnected, pairing: {
          userId: owner,
          supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
          publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          collectorToken: result.data,
        } });
      }
      setNotice(reply.loginRequired ? "Connectez-vous dans l’onglet Behaviour ouvert. L’association se terminera automatiquement." : "Connexion détectée. Transmission sécurisée à Supabase en cours…");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Connexion impossible."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function start(): void {
    if (!userId.current || busyRef.current) return;
    sessionStorage.setItem(SETUP_KEY, userId.current);
    setPending(true); setError(null);
    if (!installed) {
      attempted.current = false;
      setNotice("Installez l’extension dans l’onglet ouvert. Cette page reprendra automatiquement, sans rechargement.");
      window.open(storeUrl ?? `${import.meta.env.BASE_URL}extension-installation.html?setup=1`, "_blank", "noopener,noreferrer");
    } else { attempted.current = true; void connect(); }
  }

  async function disconnect(): Promise<void> {
    if (busyRef.current) return;
    generation.current++;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const result = await supabase!.rpc("revoke_statistics_collector");
      if (result.error) throw result.error;
      await statisticsExtensionMessage({ type: "DBD_EXTENSION_DISCONNECT", userId: userId.current }).catch(() => undefined);
      sessionStorage.removeItem(SETUP_KEY); attempted.current = false;
      setPending(false); setLinked(false); setNotice("Synchronisation désactivée. Vos statistiques enregistrées restent conservées.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Déconnexion impossible."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <section className="statistics-connection" aria-label="Connexion Behaviour">
    <h2>Vos statistiques Behaviour</h2>
    <p>Associez votre compte une fois. Vos statistiques seront ensuite synchronisées toutes les cinq minutes, même navigateur fermé et PC éteint.</p>
    {linked && !pending ? <p role="status">✓ Synchronisation distante active.</p> : <ol className="statistics-setup-steps">
      <li className={installed ? "complete" : ""}>{installed ? "✓ Extension installée" : "Installer l’extension"}</li>
      <li>Se connecter à Behaviour</li>
      <li>Synchronisation automatique</li>
    </ol>}
    {!linked && (!browser.supported ? <p>Pour associer Behaviour, ouvrez ce site sur un ordinateur avec Chrome, Edge, Opera ou un navigateur Chromium compatible. Vos statistiques resteront ensuite consultables depuis vos autres appareils.</p> : <>
      <button className="primary-button" type="button" disabled={busy || !ready} onClick={start}>
        {!ready ? "Vérification…" : busy ? "Connexion en cours…" : !installed ? "Installer l’extension et connecter Behaviour" : pending ? "Rouvrir la connexion Behaviour" : "Connecter Behaviour"}
      </button>
      {!installed && !linked && <p>Une confirmation d’installation sera demandée par {browser.name}. Le site reprend ensuite automatiquement.</p>}
    </>)}
    {linked && <button className="secondary-button" type="button" disabled={busy} onClick={() => void disconnect()}>Désactiver la synchronisation</button>}
    {pending && !linked && <button className="secondary-button" type="button" disabled={busy} onClick={() => void disconnect()}>Annuler l’association</button>}
    {pending && <p>Gardez le navigateur ouvert jusqu’à la confirmation de l’activation distante.</p>}
    {notice && <p role="status" aria-live="polite">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <details><summary>Aide et confidentialité</summary>
      <p>L’extension transmet uniquement l’autorisation Behaviour à Supabase, où elle est conservée chiffrée. Votre mot de passe reste sur le site officiel. Une reconnexion sera nécessaire si Behaviour révoque l’autorisation.</p>
      <p>Désactiver la synchronisation supprime les jetons du serveur. Vos parties enregistrées sont conservées. Sur un ordinateur partagé, utilisez un profil de navigateur distinct pour chaque joueur.</p>
      <a href={`${import.meta.env.BASE_URL}extension-installation.html`} target="_blank" rel="noreferrer">Aide à l’installation</a>
    </details>
  </section>;
}
