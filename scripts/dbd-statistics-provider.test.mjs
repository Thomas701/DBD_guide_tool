import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { chromium } from "playwright";

import { buildMatchHistoryEntryId, DbdStatisticsProvider, extractEmblemsFromHtml, extractParticipantLoadoutFromHtml, extractMatchHistoryEntriesFromHtml, isMatchHistoryUrl, isStatisticsUrl, listeningProcessIds, normalizeMatchHistoryCard, parseMatchDateLabel, selectMatchesForEnrichment, statisticsBrowserExecutable, takeMatchesUntilKnown } from "./dbd-statistics-provider.mjs";

test("reconnaît uniquement une page de statistiques DBD", () => {
  assert.equal(isStatisticsUrl("https://stats.deadbydaylight.com/statistics/"), true);
  assert.equal(isStatisticsUrl("https://stats.deadbydaylight.com/fr/statistics"), true);
  assert.equal(isStatisticsUrl("https://account.bhvr.com/"), false);
});

test("reconnaît uniquement une page d'historique des parties DBD", () => {
  assert.equal(isMatchHistoryUrl("https://stats.deadbydaylight.com/match-history/"), true);
  assert.equal(isMatchHistoryUrl("https://stats.deadbydaylight.com/fr/match-history"), true);
  assert.equal(isMatchHistoryUrl("https://stats.deadbydaylight.com/statistics/"), false);
});

test("refuse d'ouvrir une page extérieure dans le Chrome contrôlé", async () => {
  await assert.rejects(new DbdStatisticsProvider().showPage("https://example.com/"), { code: "INVALID_URL" });
});

test("détecte Chrome à un emplacement utilisateur ou système", t => {
  t.mock.method(fs, "existsSync", path => /chrome(?:\.exe)?$/i.test(path) && (process.platform !== "win32" || path.startsWith(process.env.LOCALAPPDATA ?? "")));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.match(statisticsBrowserExecutable(), /chrome(?:\.exe)?$/i);
});

test("explique comment préparer le navigateur sur une machine vierge", t => {
  t.mock.method(fs, "existsSync", path => path === chromium.executablePath());
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.throws(statisticsBrowserExecutable, { code: "BROWSER_NOT_FOUND", message: /Google Chrome est nécessaire/ });
});

test("ferme la connexion interactive puis lit en arrière-plan, même avec plusieurs demandes", async (t) => {
  const state = mockStatisticsChrome(t);
  const provider = new DbdStatisticsProvider();
  const [first, second] = await Promise.all([provider.connect(), provider.connect()]);
  assert.deepEqual(first, second);
  assert.equal(state.loginClicks, 1);
  assert.deepEqual(state.launches, [true, false, true], "une seule fenêtre visible pour se connecter");
  assert.deepEqual(state.historyModes, [true], "aucune lecture d’historique dans la fenêtre visible");
  assert.equal(state.running, false, "la session dédiée se ferme après la lecture");
  assert.equal(provider.status().phase, "success");
  assert.ok(provider.status().logs.some(log => log.message.includes("Fermeture de la fenêtre")));
  await provider.connect();
  assert.deepEqual(state.launches, [true, false, true, true], "la synchronisation suivante reste invisible");
});

test("réutilise une fenêtre déjà connectée et nettoie ses onglets en double", async (t) => {
  const state = mockStatisticsChrome(t, { visible: true, authenticated: true, duplicate: true });
  const provider = new DbdStatisticsProvider();
  await provider.connect();
  assert.deepEqual(state.launches, [true], "ne rouvre aucune fenêtre visible");
  assert.equal(state.duplicateClosed, 1);
  assert.deepEqual(state.historyModes, [true]);
  assert.equal(state.running, false);
});

test("plusieurs clics d’ouverture réutilisent la même fenêtre et la même page", async (t) => {
  const state = mockStatisticsChrome(t, { authenticated: true });
  const provider = new DbdStatisticsProvider();
  const url = "https://stats.deadbydaylight.com/match-history/";
  await Promise.all([provider.showPage(url), provider.showPage(url), provider.showPage(url)]);
  assert.deepEqual(state.launches, [false]);
  assert.equal(state.pages.filter(page => page.url() === url).length, 1);
  await provider.connect();
  assert.equal(state.running, false);
});

test("une erreur de lecture arrête aussi le navigateur en arrière-plan", async (t) => {
  const state = mockStatisticsChrome(t, { authenticated: true, readError: true });
  const provider = new DbdStatisticsProvider();
  await assert.rejects(provider.connect(), /Lecture interrompue/);
  assert.equal(state.running, false);
  assert.deepEqual(state.launches, [true]);
  assert.equal(provider.status().phase, "error");
});

function mockStatisticsChrome(t, { visible = false, authenticated = false, duplicate = false, readError = false } = {}) {
  const state = { running: visible, headless: !visible, authenticated, launches: [], historyModes: [], pages: [], loginClicks: 0, duplicateClosed: 0, browser: null };
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const originalExists = fs.existsSync;
  t.mock.method(fs, "existsSync", path => /chrome(?:\.exe)?$/i.test(String(path)) || originalExists(path));
  t.mock.method(globalThis, "fetch", async url => {
    assert.equal(String(url), "http://127.0.0.1:9333/json/version");
    return { ok: state.running, json: async () => ({ "User-Agent": state.headless ? "HeadlessChrome/" : "Chrome/" }) };
  });
  const makePage = initialUrl => {
    let url = initialUrl;
    const page = {
      url: () => url,
      goto: async target => { url = target; }, reload: async () => {}, bringToFront: async () => {},
      close: async () => { state.pages = state.pages.filter(candidate => candidate !== page); state.duplicateClosed++; },
      setViewportSize: async () => {}, waitForLoadState: async () => {},
      content: async () => { state.historyModes.push(state.headless); now += 16_000; return ""; },
      evaluate: async () => ({ atBottom: true }),
      locator: selector => ({
        isVisible: async () => isStatisticsUrl(url) && (selector.includes("General-Stats") ? state.authenticated : selector.includes("login-btn") && !state.authenticated),
        locator: name => ({ innerText: async () => { if (readError) throw new Error("Lecture interrompue"); return name.includes("hours") ? "10 hrs" : "50"; } }),
        getAttribute: async () => state.authenticated ? "true" : "false",
        evaluate: async () => { state.loginClicks++; state.authenticated = true; },
      }),
    };
    state.pages.push(page);
    return page;
  };
  const makeBrowser = () => {
    state.pages = [];
    makePage("https://stats.deadbydaylight.com/statistics/");
    if (duplicate) makePage("https://stats.deadbydaylight.com/statistics/");
    const context = { pages: () => state.pages, newPage: async () => makePage("about:blank") };
    let disconnected = () => {};
    const browser = { isConnected: () => state.running && state.browser === browser, contexts: () => [context],
      on: (_event, callback) => { disconnected = callback; },
      newBrowserCDPSession: async () => ({ send: async command => { assert.equal(command, "Browser.close"); state.running = false; } }),
      close: async () => { state.running = false; disconnected(); },
    };
    state.browser = browser;
    return browser;
  };
  if (visible) makeBrowser();
  t.mock.method(childProcess, "spawn", (_command, args) => {
    state.headless = args.includes("--headless=new");
    state.launches.push(state.headless);
    state.running = true;
    makeBrowser();
    return { unref() {} };
  });
  t.mock.method(chromium, "connectOverCDP", async () => state.browser);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return state;
}

test("identifie uniquement le processus Windows qui écoute sur le port CDP", () => {
  const output = [
    "TCP    127.0.0.1:9333    0.0.0.0:0    LISTENING    4242",
    "TCP    127.0.0.1:5173    0.0.0.0:0    LISTENING    5151",
    "TCP    127.0.0.1:9333    127.0.0.1:51000    ESTABLISHED    4242"
  ].join("\r\n");
  assert.deepEqual(listeningProcessIds(output, 9333), ["4242"]);
});

test("arrête l'historique au premier match déjà présent", () => {
  const entries = [{ id: "new-2" }, { id: "new-1" }, { id: "known" }, { id: "older" }];
  assert.deepEqual(takeMatchesUntilKnown(entries, new Set(["known", "older"])), {
    entries: entries.slice(0, 2),
    reachedKnownMatch: true
  });
  assert.deepEqual(takeMatchesUntilKnown(entries, new Set()), {
    entries,
    reachedKnownMatch: false
  });
});

test("reprend un ancien match incomplet au-delà du premier match connu", () => {
  const entries = [{ id: "new" }, { id: "known" }, { id: "incomplete" }, { id: "older" }];
  const firstPage = selectMatchesForEnrichment(entries.slice(0, 2), new Set(["known", "incomplete"]), new Set(["incomplete"]));
  assert.equal(firstPage.pendingFound, false);
  const result = selectMatchesForEnrichment(entries, new Set(["known", "incomplete"]), new Set(["incomplete"]));
  assert.equal(result.pendingFound, true);
  assert.deepEqual(result.selected.map(({ entry, index }) => [entry.id, index]), [["new", 0], ["incomplete", 2]]);
});

test("normalise une carte killer d'historique en entrée structurée", () => {
  const entry = normalizeMatchHistoryCard({
    textLines: [
      "The Dredge",
      "Score",
      "32,411",
      "Merciless Killer",
      "18,724",
      "17,890",
      "5,587",
      "12,773",
      "Sep 17, 8:11 PM",
      "Midwich Elementary School",
      "9:01"
    ],
    characterImageUrl: "https://images.example/dredge.png",
    loadoutIconUrls: ["perk-1", "perk-2", "perk-3", "perk-4", "power", "addon"],
    participantImageUrls: ["survivor-1", "survivor-2", "survivor-3", "survivor-4"],
    mapImageUrl: "https://images.example/midwich.jpg"
  }, "https://stats.deadbydaylight.com/match-history/", new Date("2026-09-17T20:30:00.000Z"));

  assert.equal(entry?.role, "killer");
  assert.equal(entry?.characterName, "The Dredge");
  assert.equal(entry?.resultLabel, "Merciless Killer");
  assert.equal(entry?.score, 32411);
  assert.equal(entry?.playedAtLabel, "Sep 17, 8:11 PM");
  assert.equal(entry?.durationLabel, "9:01");
  assert.equal(entry?.mapName, "Midwich Elementary School");
  assert.deepEqual(entry?.perkIconUrls, ["perk-1", "perk-2", "perk-3", "perk-4"]);
  assert.deepEqual(entry?.equipmentIconUrls, ["power", "addon"]);
  assert.deepEqual(entry?.participants.map((participant) => participant.score), [18724, 17890, 5587, 12773]);
  assert.deepEqual(entry?.participants.map((participant) => participant.valueLabel), ["18,724", "17,890", "5,587", "12,773"]);
  assert.match(entry?.id ?? "", /^[a-f0-9]{40}$/);
});

test("normalise une carte survivant 2v8 et extrait la file", () => {
  const entry = normalizeMatchHistoryCard({
    textLines: [
      "Jake Park",
      "Score",
      "32,249",
      "Escaped",
      "20,895",
      "23,395",
      "21,072",
      "11,296",
      "20,713",
      "20,824",
      "30,244",
      "34,714",
      "35,133",
      "2v8",
      "Sep 17, 1:00 AM",
      "Mount Ormond Resort",
      "10:20"
    ],
    characterImageUrl: "https://images.example/jake.png",
    loadoutIconUrls: ["perk-1", "perk-2", "perk-3", "perk-4", "item", "addon-1", "addon-2"],
    participantImageUrls: ["p-1", "p-2", "p-3", "p-4", "p-5", "p-6", "p-7", "p-8", "p-9"],
    mapImageUrl: "https://images.example/ormond.jpg"
  }, "https://stats.deadbydaylight.com/match-history/", new Date("2026-09-17T09:00:00.000Z"));

  assert.equal(entry?.role, "survivor");
  assert.equal(entry?.queueLabel, "2v8");
  assert.equal(entry?.mapName, "Mount Ormond Resort");
  assert.equal(entry?.participants.length, 9);
  assert.deepEqual(entry?.participants.slice(0, 3).map((participant) => participant.score), [20895, 23395, 21072]);
  assert.deepEqual(entry?.participants.slice(0, 3).map((participant) => participant.valueLabel), ["20,895", "23,395", "21,072"]);
});

test("convertit une date d'historique sans année en ISO cohérent", () => {
  assert.equal(parseMatchDateLabel("Sep 17, 8:11 PM", new Date("2026-09-17T20:30:00.000Z")), "2026-09-17T20:11:00.000Z");
});

test("extrait correctement les cartes depuis le HTML complet de match-history", async () => {
  const html = await readFile(resolveFixture("../html_history_match_example.txt"), "utf8");
  const entries = extractMatchHistoryEntriesFromHtml(html, "https://stats.deadbydaylight.com/match-history/", new Date("2026-09-17T21:00:00.000Z"));

  assert.equal(entries.length, 30);
  assert.equal(entries[0]?.characterName, "The Dredge");
  assert.equal(entries[0]?.resultLabel, "Merciless Killer");
  assert.equal(entries[0]?.mapName, "Midwich Elementary School");
  assert.equal(entries[0]?.participants.length, 4);
  assert.equal(entries.some((entry) => entry.role === "survivor" && entry.queueLabel === "2v8"), true);
  assert.equal(entries.some((entry) => entry.characterName === "Jake Park"), true);

  const jakePark = entries.find((entry) => entry.characterName === "Jake Park");
  assert.equal(jakePark?.participants.length, 9);
  assert.deepEqual(jakePark?.equipmentIconLabels, ["Guide"]);
  assert.equal(jakePark?.participants.filter((participant) => participant.imageUrl?.includes("characters/survivors/S43.png")).length, 3);
  assert.equal(jakePark?.participants.some((participant) => participant.resultLabel === "Escaped"), true);
  assert.equal(jakePark?.participants.some((participant) => participant.resultLabel === "Sacrificed"), true);
  assert.equal(jakePark?.participants.some((participant) => participant.name === "Thalita Lyra"), true);
});

function resolveFixture(relativePath) {
  return new URL(relativePath, import.meta.url);
}

test("n'importe pas une carte encore incomplète pendant le chargement", () => {
  const partial = `<button data-cy="survivor-match-card-btn"><span class="font-sans text-left text-md font-bold text-neutral-text-xlight">Jake Park</span><span>Score</span><span>17,088</span><span data-cy="match-date">Sep 18, 2:07 AM</span><span data-cy="match-duration">7:57</span></button>`;
  const url = "https://stats.deadbydaylight.com/match-history/";
  assert.deepEqual(extractMatchHistoryEntriesFromHtml(partial, url), []);
  const complete = partial.replace("</button>", '<span data-cy="match-map">Gas Heaven</span></button>');
  assert.equal(extractMatchHistoryEntriesFromHtml(complete, url).length, 1);
});

test("conserve le badge des modes spéciaux et nettoie le résultat de la partie", () => {
  const card = mode => `<button data-cy="killer-match-card-btn"><span class="font-sans inline-block overflow-hidden text-ellipsis whitespace-nowrap">${mode}</span><h3 class="font-sans text-left text-md font-bold text-neutral-text-xlight">The Dredge</h3><span>Brutal Killer</span><span>Score</span><span>25,758</span><span data-cy="match-date">Nov 7, 5:04 PM</span><span data-cy="match-map">Greenville Square</span><span data-cy="match-duration">8:15</span></button>`;
  for (const mode of ["Lights Out", "Autre mode"]) {
    const [entry] = extractMatchHistoryEntriesFromHtml(card(mode), "https://stats.deadbydaylight.com/match-history/", new Date("2026-11-07T20:00:00Z"));
    assert.equal(entry.queueLabel, mode);
    assert.equal(entry.resultLabel, "Brutal Killer");
    assert.equal(buildMatchHistoryEntryId({ ...entry, queueLabel: null }), entry.id, "la correction du mode ne duplique pas une carte déjà importée");
  }
});

test("extrait l'équipement du participant sans inclure portraits et résultats", () => {
  const base = "https://assets.live.bhvraccount.com/";
  const assets = ["characters/survivors/Dwight.png", "perks/Bond.png", "perks/ProveThyself.png", "items/Medkit.png", "add-ons/Bandages.png", "offerings/Cake.png", "characterClasses/Medic.png", "stats/VE_Escaped.png"];
  const labels = ["Dwight", "Bond", "Prove Thyself", "Med-Kit", "Bandages", "Cake", "Guide", "Escaped"];
  const html = assets.map((path, index) => `<img src="${base}${path}" alt="${labels[index]}" title="${labels[index]}">`).join("");
  assert.deepEqual(extractParticipantLoadoutFromHtml(html), {
    perkIconUrls: assets.slice(1, 3).map(path => base + path),
    perkIconLabels: labels.slice(1, 3),
    equipmentIconUrls: assets.slice(3, 7).map(path => base + path),
    equipmentIconLabels: labels.slice(3, 7),
  });
});

test("extrait les quatre emblèmes sans inclure l'équipement", () => {
  const base = "https://assets.live.bhvraccount.com/";
  const html = ["Emblem_Killer_Chaser_3.png", "Emblem_Killer_Devout_4.png", "Emblem_Killer_Gatekeeper_2.png", "Emblem_Killer_Malicious_1.png", "items/Item_Slasher.png"]
    .map((path, index) => `<img src="${path.startsWith("Emblem") ? `${base}emblems/${path}` : `${base}${path}`}" alt="emblem ${index}">`).join("");
  const result = extractEmblemsFromHtml(html);
  assert.equal(result.emblemIconUrls.length, 4);
  assert.equal(result.emblemIconLabels.length, 4);
  assert.ok(result.emblemIconUrls.every(url => url.includes("/emblems/")));
});

test("l'identité reste stable après enrichissement et distingue les années", async () => {
  const html = await readFile(resolveFixture("../html_history_match_example.txt"), "utf8");
  const [entry] = extractMatchHistoryEntriesFromHtml(html, "https://stats.deadbydaylight.com/match-history/", new Date("2026-09-17T21:00:00Z"));
  assert.equal(buildMatchHistoryEntryId({ ...entry, participants: entry.participants.map(p => ({ ...p, survivalTimeLabel: "9:01", name: "Dwight" })) }), entry.id);
  assert.notEqual(buildMatchHistoryEntryId({ ...entry, playedAt: "2025-09-17T20:11:00.000Z" }), entry.id);
});
