export const behaviourPlayer = (role = "VE_Camper", name = "Jake Park") => ({
  playerRole: role, characterName: { name, image: { path: `characters/${name}.png` } },
  leaderboardScore: 14277, playerTimeInMatch: 701,
  playerStatus: { name: "SACRIFICED" }, killerMatchStatus: { name: "RUTHLESS KILLER" },
  characterLoadout: { perks: [{ name: "Hyperfocus", image: { path: "perks/S33P03.png" } }], offering: null, power: null, addOns: [] },
  emblems: [{ emblem_id: "Emblem_Survivor_Benevolent", emblem_name: "BENEVOLENT", emblem_quality: "Gold" }],
});
export const behaviourHistory = [{
  matchStat: { gameType: { id: "Online" }, matchStartTime: 1795132504, matchDuration: 809.5, map: { name: "Father Campbell's Chapel", image: { path: "maps/Asy_Chapel.png" } } },
  playerStat: behaviourPlayer(), opponentStat: [behaviourPlayer("VE_Slasher", "The Trapper"), behaviourPlayer("VE_Camper", "Meg Thomas")],
}];
export const behaviourOverview = { data: { "all-time": { global: { general: { totalHoursPlayed: 330, totalMatchesPlayed: 1832, bpEarnedThroughMatch: 136494114 } } } } };
export const behaviourProfile = { nickName: "Compte Behaviour", accounts: [{ type: "egs", userName: "Donoteet" }, { type: "steam", userName: "Steam Player" }] };
export const behaviourProviders = [{ provider: "egs", status: "owned" }, { provider: "steam", status: "owned" }];
export const behaviourToken = subject => `header.${Buffer.from(JSON.stringify({ sub: subject })).toString("base64url")}.signature`;
export const behaviourSession = () => ({ authToken: { token: behaviourToken("alice"), expirationDate: Date.now() + 3600_000 }, refreshToken: { token: "private-refresh", expirationDate: Date.now() + 86400_000 }, provider: "egs" });
