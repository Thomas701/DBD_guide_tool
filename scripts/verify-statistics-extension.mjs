import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createStatisticsParser } from "../shared/statistics-parser.mjs";
import { buildMatchHistoryEntryId } from "./match-history-id.mjs";

const root = process.cwd();
const profile = await mkdtemp(join(root, ".tmp-extension-browser-"));
const extension = resolve(".tmp-statistics-extension");
let context;
try {
  context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  assert.equal(new URL(worker.url()).host, "kiefmoeclpffgabjgaadfnmnfnocpffm");
  const parser = createStatisticsParser(buildMatchHistoryEntryId);
  const original = await readFile("html_history_match_example.txt", "utf8");
  const card = original.match(parser.MATCH_HISTORY_BUTTON_PATTERN)?.[0];
  assert.ok(card);
  await context.addInitScript(() => {
    const token = `header.${btoa(JSON.stringify({ sub: "behaviour-test-alice" }))}.signature`;
    localStorage.setItem("auth-store", JSON.stringify({ state: { authToken: { token } } }));
  });
  await context.route("https://stats.deadbydaylight.com/**", route => {
    const overview = '<section data-cy="General-Stats-section"><span data-cy="Total-hours-played-in-matches-value">100</span><span data-cy="Total-matches-played-value">20</span><span data-cy="Total-Bloodpoints-earned-value">2000</span></section>';
    const history = `${card}<script>document.querySelector('button').onclick = () => { const modal = document.createElement('div'); modal.dataset.cy = 'modal'; modal.innerHTML = '<img src="https://assets.live.bhvraccount.com/emblems/test.png"><button data-cy="modal-close-btn">Close</button>'; modal.querySelector('button').onclick=()=>modal.remove(); document.body.append(modal); };</script>`;
    return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body>${new URL(route.request().url()).pathname.includes("match-history") ? history : overview}</body></html>` });
  });
  await context.route("https://assets.live.bhvraccount.com/**", route => route.abort());
  const page = await context.newPage();
  async function collect(kind) {
    await page.goto(`https://stats.deadbydaylight.com/${kind === "overview" ? "statistics" : "match-history"}/`);
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        return await worker.evaluate(async kind => {
          const tabs = await chrome.tabs.query({ url: `https://stats.deadbydaylight.com/${kind === "overview" ? "statistics" : "match-history"}/*` });
          return chrome.tabs.sendMessage(tabs.at(-1).id, { type: "DBD_COLLECT", kind, knownMatches: [] });
        }, kind);
      } catch (error) { if (attempt === 19) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
    }
  }
  const overview = await collect("overview");
  assert.equal(overview.ok, true);
  assert.equal(overview.statistics.hoursPlayed, "100");
  assert.equal(overview.fingerprint, createHash("sha256").update("behaviour-test-alice").digest("hex"));
  const history = await collect("history");
  assert.equal(history.ok, true, history.error);
  assert.equal(history.fingerprint, overview.fingerprint);
  assert.equal(history.matches.length, 1);
  assert.equal(history.matches[0].id, buildMatchHistoryEntryId(history.matches[0]));
  assert.deepEqual(history.matches[0].emblemIconUrls, ["https://assets.live.bhvraccount.com/emblems/test.png"]);
  assert.deepEqual(history.completeMatchIds, [], "Incomplete participant details must remain eligible for another attempt.");
  assert.ok(!JSON.stringify({ overview, history }).includes("header."), "The collector must not return the Behaviour token.");
  console.log("Chrome extension checks passed: real extension loading, shared parser, stable player identity, detail extraction and no Behaviour token in the payload.");
} finally {
  await context?.close();
  if (!resolve(profile).startsWith(`${resolve(root)}\\.tmp-extension-browser-`) && !resolve(profile).startsWith(`${resolve(root)}/.tmp-extension-browser-`)) throw new Error("Unexpected browser profile path.");
  await rm(profile, { recursive: true, force: true });
}
