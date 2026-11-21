import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import App from "../../App.js";
import { authRedirectUrl, emailAuthEnabled, isHostedApp, supabase } from "../../app/cloud.js";
import { createAccountStorage, setAccountStorage } from "../../services/account-storage.js";
import { CloudWorkspace, workspaceRemote } from "../../services/cloud-workspace.js";
import "./account.css";

export function AccountApp() {
  if (!isHostedApp) return <App />;
  if (!supabase) return <AccountCard><h1>Configuration du site requise</h1><p>Les paramètres Supabase doivent être renseignés avant de publier l’application.</p></AccountCard>;
  return <CloudAccountApp client={supabase} />;
}

function CloudAccountApp({ client }: { client: SupabaseClient }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    void client.auth.getSession().then(({ data: result, error: failure }) => {
      if (!active) return;
      if (failure) setError(failure.message);
      setSession(result.session);
      setLoading(false);
    }).catch((cause: unknown) => { if (active) { setError(message(cause)); setLoading(false); } });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [client]);
  if (loading) return <AccountCard><p role="status">Restauration de votre connexion…</p></AccountCard>;
  if (!session || recovery) return <LoginForm client={client} recovery={recovery} onRecovered={() => setRecovery(false)} initialError={error} />;
  return <AccountWorkspace key={session.user.id} client={client} user={session.user} />;
}

function LoginForm({ client, recovery, onRecovered, initialError }: { client: SupabaseClient; recovery: boolean; onRecovered: () => void; initialError: string | null }) {
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      if (recovery) {
        const result = await client.auth.updateUser({ password });
        if (result.error) throw result.error;
        setPassword(""); onRecovered();
      } else if (mode === "reset") {
        const result = await client.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl() });
        if (result.error) throw result.error;
        setNotice("Si ce compte existe, un lien de réinitialisation vous sera envoyé.");
      } else if (mode === "signup") {
        const result = await client.auth.signUp({ email, password, options: { emailRedirectTo: authRedirectUrl() } });
        if (result.error) throw result.error;
        if (!result.data.session) setNotice("Consultez vos emails pour confirmer votre inscription.");
      } else {
        const result = await client.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
      }
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function google(): Promise<void> {
    setBusy(true); setError(null);
    try {
      const result = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: authRedirectUrl() } });
      if (result.error) throw result.error;
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <AccountCard>
    <span className="eyebrow">Dead by Daylight</span>
    <h1>Build Analyzer</h1>
    <p>Retrouvez vos builds, personnalisations et statistiques sur vos appareils.</p>
    {!recovery && <button className="secondary-button account-google" type="button" disabled={busy} onClick={() => void google()}>Continuer avec Google</button>}
    {(emailAuthEnabled || recovery) && <form onSubmit={(event) => void submit(event)}>
      <h2>{recovery ? "Nouveau mot de passe" : mode === "signup" ? "Créer un compte" : mode === "reset" ? "Mot de passe oublié" : "Connexion"}</h2>
      {!recovery && <label>Email<input type="email" name="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy} /></label>}
      {(recovery || mode !== "reset") && <label>Mot de passe<input type="password" name="password" autoComplete={recovery || mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signin" && !recovery ? 1 : 8} required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>}
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "Veuillez patienter…" : recovery ? "Enregistrer le mot de passe" : mode === "signup" ? "S’inscrire" : mode === "reset" ? "Envoyer le lien" : "Se connecter"}</button>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!recovery && emailAuthEnabled && <div className="account-links">
      <button className="text-button" type="button" disabled={busy} onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(null); setNotice(null); }}>{mode === "signup" ? "J’ai déjà un compte" : "Créer un compte"}</button>
      <button className="text-button" type="button" disabled={busy} onClick={() => { setMode(mode === "reset" ? "signin" : "reset"); setError(null); setNotice(null); }}>{mode === "reset" ? "Revenir à la connexion" : "Mot de passe oublié ?"}</button>
    </div>}
    <small>Votre connexion est conservée sur ce navigateur. Déconnectez-vous après utilisation sur un appareil partagé.</small>
  </AccountCard>;
}

function AccountWorkspace({ client, user }: { client: SupabaseClient; user: User }) {
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState("Chargement de votre compte…");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(true);
  const schedule = useRef(() => {});
  const [workspace] = useState(() => new CloudWorkspace(createAccountStorage(window.localStorage, user.id, () => schedule.current()), workspaceRemote(client, user.id)));

  async function flush(): Promise<void> {
    if (!workspace.local.pending()) return;
    if (active.current) setStatus("Sauvegarde en cours…");
    try {
      await workspace.flush();
      if (active.current) { setStatus("Données synchronisées"); setError(null); }
    } catch (cause) {
      if (active.current) { setStatus("Changements conservés sur cet appareil"); setError(message(cause)); }
      throw cause;
    }
  }
  schedule.current = () => {
    setStatus("Changements en attente…"); setExported(false);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush().catch(() => undefined); }, 1_000);
  };
  async function load(discardLocal = false): Promise<void> {
    setBusy(true); setError(null);
    try {
      await workspace.load(discardLocal);
      if (!active.current) return;
      setAccountStorage(workspace.local.storage);
      setReady(true); setVersion(current => current + 1);
      setStatus(workspace.local.pending() ? "Changements en attente…" : "Données synchronisées");
      void flush().catch(() => undefined);
    } catch (cause) { if (active.current) setError(message(cause)); }
    finally { if (active.current) setBusy(false); }
  }
  useEffect(() => {
    active.current = true;
    void load();
    const retry = (): void => { void flush().catch(() => undefined); };
    const beforeUnload = (event: BeforeUnloadEvent): void => { if (workspace.local.pending()) { event.preventDefault(); event.returnValue = ""; } };
    const storageChanged = (event: StorageEvent): void => {
      if (!event.key?.startsWith(workspace.local.prefix)) return;
      const key = event.key.slice(workspace.local.prefix.length);
      if (!key.startsWith("dbd-build-tool.")) return;
      window.dispatchEvent(new StorageEvent("storage", { key }));
      schedule.current();
    };
    window.addEventListener("online", retry);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("storage", storageChanged);
    const interval = window.setInterval(retry, 30_000);
    return () => {
      active.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
      window.clearInterval(interval);
      window.removeEventListener("online", retry);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("storage", storageChanged);
    };
  }, [workspace]);
  function exportLocal(): void {
    const url = URL.createObjectURL(new Blob([JSON.stringify(workspace.local.snapshot(), null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "dbd-mes-donnees.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setExported(true);
  }
  async function signOut(): Promise<void> {
    setBusy(true);
    try {
      await flush();
      const result = await client.auth.signOut({ scope: "local" });
      if (result.error) throw result.error;
    } catch (cause) { if (active.current) { setError(message(cause)); setBusy(false); } }
  }
  return <>
    <div className="account-toolbar" aria-label="Mon compte">
      <span>{user.email ?? "Mon compte"}</span><span role="status">{status}</span>
      <button className="text-button" type="button" disabled={busy} onClick={() => void signOut()}>Se déconnecter</button>
    </div>
    {error && <div className="account-sync-error" role="alert">
      <p>{error}</p>
      <button className="secondary-button" type="button" onClick={exportLocal}>Exporter mes changements locaux</button>
      <button className="secondary-button" type="button" disabled={busy} onClick={() => { if (ready) void flush().catch(() => undefined); else void load(); }}>Réessayer</button>
      <button className="secondary-button" type="button" disabled={busy || (workspace.local.pending() && !exported)} onClick={() => void load(true)}>Recharger les données en ligne</button>
    </div>}
    {ready ? <App key={version} /> : !error && <AccountCard><p role="status">Chargement de vos données…</p></AccountCard>}
  </>;
}

function AccountCard({ children }: { children: React.ReactNode }) { return <main className="account-page"><section className="account-card">{children}</section></main>; }
function message(cause: unknown): string { return cause instanceof Error ? cause.message : "Connexion impossible. Réessayez."; }
