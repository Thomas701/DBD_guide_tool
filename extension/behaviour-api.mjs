import { matchHistoryIdentity } from "../shared/match-history-identity.mjs";
import { hashText } from "./policy.mjs";

export const BEHAVIOUR_API = "https://account-backend.bhvr.com";
export class BehaviourPlatformRequiredError extends Error {}

const ASSETS = "https://assets.live.bhvraccount.com/";
const title = value => typeof value === "string" ? value.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase()) : null;
const duration = value => { const seconds = Math.max(0, Math.trunc(value)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; };
const asset = item => typeof item?.image?.path === "string" && item.image.path ? new URL(item.image.path, ASSETS).href : null;

function playerDetails(player, gameType) {
  if (!player?.characterName?.name || !["VE_Camper", "VE_Slasher"].includes(player.playerRole) || !Number.isFinite(player.leaderboardScore)) throw new Error("Participant Behaviour invalide.");
  const loadout = player.characterLoadout;
  if (!loadout || !Array.isArray(loadout.perks) || !Array.isArray(loadout.addOns)) throw new Error("Équipement Behaviour indisponible.");
  const standardLoadout = !["Calamari", "Cake", "Firefly"].includes(gameType);
  const perks = standardLoadout ? loadout.perks : [];
  const equipment = [standardLoadout ? loadout.offering : null, loadout.power, ...(standardLoadout ? loadout.addOns : [])].filter(item => asset(item));
  const emblems = gameType !== "Calamari" && Array.isArray(player.emblems) ? player.emblems : [];
  return {
    name: player.characterName.name, role: player.playerRole === "VE_Camper" ? "survivor" : "killer",
    imageUrl: asset(player.characterName), score: player.leaderboardScore,
    valueLabel: player.leaderboardScore.toLocaleString("en-US"),
    survivalTimeLabel: Number.isFinite(player.playerTimeInMatch) ? duration(player.playerTimeInMatch) : null,
    resultLabel: title(player.playerRole === "VE_Camper" ? player.playerStatus?.name : player.killerMatchStatus?.name),
    perkIconUrls: perks.filter(asset).map(asset), perkIconLabels: perks.filter(asset).map(item => item.name ?? null),
    equipmentIconUrls: equipment.map(asset), equipmentIconLabels: equipment.map(item => item.name ?? null),
    emblemIconUrls: emblems.map(item => `${ASSETS}emblems/${item.emblem_id}_${({ Iridescent: 4, Gold: 3, Silver: 2, Bronze: 1 })[item.emblem_quality] ?? 0}.png`),
    emblemIconLabels: emblems.map(item => `${title(item.emblem_name)} - ${item.emblem_quality}`),
  };
}

export async function mapBehaviourMatches(payload, now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (!Array.isArray(payload) || payload.length > 200) throw new Error("Historique Behaviour invalide.");
  return Promise.all(payload.map(async raw => {
    const match = raw.matchStat, player = playerDetails(raw.playerStat, match?.gameType?.id);
    if (!match?.map?.name || !Number.isFinite(match.matchStartTime) || !Array.isArray(raw.opponentStat)) throw new Error("Partie Behaviour invalide.");
    const date = new Date(match.matchStartTime * 1_000);
    const sharedMatchId = await behaviourSharedMatchId(raw);
    if (!Number.isFinite(match.matchDuration || raw.playerStat.playerTimeInMatch)) throw new Error("Durée de partie Behaviour invalide.");
    // shortcut: IDs retain the original browser timezone; migrate stored dates before supporting timezone changes.
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map(part => [part.type, part.value]));
    const entry = {
      ...player, id: "", characterName: player.name, characterImageUrl: player.imageUrl,
      ...(sharedMatchId ? { sharedMatchId } : {}),
      participants: raw.opponentStat.filter(opponent => opponent.playerRole === raw.playerStat.playerRole).concat(raw.opponentStat.filter(opponent => opponent.playerRole !== raw.playerStat.playerRole)).map(opponent => playerDetails(opponent, match.gameType?.id)),
      mapName: match.map.name, mapImageUrl: asset(match.map),
      playedAt: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00.000Z`,
      playedAtLabel: new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "numeric", hour12: true }).format(date),
      durationLabel: duration(match.matchDuration || raw.playerStat.playerTimeInMatch),
      queueLabel: ({ Calamari: "2v8", Cake: "Chaos Shuffle", ChocolateBox: "My Little Oni", Firefly: "Lights Out" })[match.gameType?.id] ?? null,
      sourceUrl: "https://stats.deadbydaylight.com/match-history/", importedAt: now.toISOString(),
    };
    delete entry.name; delete entry.imageUrl; delete entry.valueLabel;
    entry.id = await hashText(matchHistoryIdentity(entry), "SHA-1");
    return entry;
  }));
}

export async function behaviourSharedMatchId(raw) {
  const match = raw?.matchStat, players = [raw?.playerStat, ...(raw?.opponentStat ?? [])];
  const killers = match?.gameType?.id === "Calamari" ? 2 : 1, survivors = killers * 4;
  if (!Number.isFinite(match?.matchStartTime) || !Number.isFinite(match?.matchDuration) || match.matchDuration <= 0 || !match?.map?.name
    || players.length !== killers + survivors || players.filter(player => player?.playerRole === "VE_Slasher").length !== killers
    || players.filter(player => player?.playerRole === "VE_Camper").length !== survivors
    || players.some(player => !player?.characterName?.name || !Number.isFinite(player.leaderboardScore))) return null;
  const roster = players.map(player => JSON.stringify([player.playerRole, player.characterName.name, player.leaderboardScore])).sort();
  return hashText(JSON.stringify([match.matchStartTime, match.matchDuration, match.map.name, match.gameType?.id, match.isCustomMatch === true, roster]));
}

export function mapBehaviourOverview(payload) {
  const general = payload?.data?.["all-time"]?.global?.general;
  if (!general || ![general.totalHoursPlayed, general.totalMatchesPlayed, general.bpEarnedThroughMatch].every(Number.isFinite)) throw new Error("Statistiques Behaviour invalides.");
  return { hoursPlayed: `${general.totalHoursPlayed.toLocaleString("en-US")} hrs`, matchesPlayed: general.totalMatchesPlayed.toLocaleString("en-US"), bloodpointsEarned: general.bpEarnedThroughMatch.toLocaleString("en-US"), sourceUrl: "https://stats.deadbydaylight.com/statistics/" };
}

export function readBehaviourNickname(profile, providers, provider) {
  // This is the source of the official header's data-cy="nav-user-nickname".
  const platform = Array.isArray(providers) && providers.some(account => account?.provider === provider)
    && !providers.some(account => account?.status === "synced") && Array.isArray(profile?.accounts)
    ? profile.accounts.find(account => account?.type === provider)?.userName : null;
  const rawName = platform || profile?.nickName;
  const name = typeof rawName === "string" ? rawName.trim() : "";
  return [...name].length >= 2 && [...name].length <= 40 && !/[\u0000-\u001f\u007f-\u009f]/.test(name) ? name : null;
}

export async function collectBehaviourStatistics(session, saveSession, request = fetch, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  async function refresh() {
    if (!session.refreshToken?.token || session.refreshToken.expirationDate <= Date.now()) throw new Error("Connexion Behaviour expirée. Reconnectez Behaviour depuis le site.");
    const response = await request(`${BEHAVIOUR_API}/sso/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grant_type: "refresh_token", client_id: "DBDStats", refresh_token: session.refreshToken.token }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(response.status >= 500 ? "Behaviour est temporairement indisponible." : "Connexion Behaviour révoquée. Reconnectez Behaviour depuis le site.");
    const data = await response.json();
    const expirationDate = new Date(data.refresh_token_expire_date).getTime();
    if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string" || !Number.isFinite(data.expires_in) || !Number.isFinite(expirationDate)) throw new Error("Renouvellement Behaviour invalide.");
    session = { ...session, authToken: { token: data.access_token, expirationDate: Date.now() + data.expires_in * 1_000, expired: false }, refreshToken: { token: data.refresh_token, expirationDate, expired: false } };
    await saveSession(session);
  }
  if (!session.authToken?.token || session.authToken.expirationDate <= Date.now() + 60_000) await refresh();
  async function get(path, missingCode) {
    const send = () => request(`${BEHAVIOUR_API}${path}`, { headers: { Authorization: `Bearer ${session.authToken.token}` }, signal: AbortSignal.timeout(20_000) });
    let response = await send();
    if (response.status === 401) { await refresh(); response = await send(); }
    if (response.status === 404 && missingCode && (await response.json()).code === missingCode) return undefined;
    if (!response.ok) throw new Error(response.status === 401 ? "Connexion Behaviour expirée. Reconnectez Behaviour depuis le site." : "Behaviour ne peut pas fournir les statistiques pour le moment.");
    return response.json();
  }
  let providers;
  if (!/^[a-z0-9_-]{1,30}$/.test(session.provider ?? "")) {
    providers = await get("/players/me/game-accounts/dbd");
    if (Array.isArray(providers) && providers.length === 0) {
      throw new BehaviourPlatformRequiredError("Behaviour ne trouve aucune plateforme Dead by Daylight pour ce compte. Associez votre compte de jeu dans les connexions de votre compte Behaviour. La synchronisation reprendra automatiquement.");
    }
    const provider = Array.isArray(providers) ? providers.find(item => item.status === "synced")?.provider ?? providers[0]?.provider : null;
    if (!/^[a-z0-9_-]{1,30}$/.test(provider ?? "")) throw new Error("Liste de plateformes Behaviour invalide.");
    session = { ...session, provider }; await saveSession(session);
  }
  const overview = await get(`/player-stats/games/dbd/providers/${session.provider}?lang=en`, "StatNotFound");
  const history = await get(`/player-stats/match-history/games/dbd/providers/${session.provider}?lang=en&limit=30`);
  const profile = await get("/players/me").catch(() => null);
  providers ??= await get("/players/me/game-accounts/dbd").catch(() => null);
  const nickname = readBehaviourNickname(profile, providers, session.provider);
  return { nickname, statistics: overview === undefined ? null : { ...mapBehaviourOverview(overview), ...(nickname ? { nickname } : {}) }, matches: await mapBehaviourMatches(history, new Date(), timeZone) };
}
