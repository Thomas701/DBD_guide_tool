import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

process.env.VITE_HOSTED_APP = "false";
const server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false }, logLevel: "error" });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("dbd-build-tool.current-session", JSON.stringify({ activeView: "blindtest", soundEnabled: true }));
    window.mediaTest = [];
    window.Audio = class extends EventTarget {
      constructor() { super(); this.readyState = 0; this.duration = 45; this.paused = true; this.currentTime = 0; this.dataset = {}; window.mediaTest.push(this); }
      get src() { return this.url ?? ""; }
      set src(value) { this.url = value; this.readyState = 0; clearTimeout(this.metadataTimer); this.metadataTimer = setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event("loadedmetadata")); }, 100); }
      removeAttribute() { clearTimeout(this.metadataTimer); this.url = ""; this.readyState = 0; }
      load() {}
      pause() { this.paused = true; }
      async play() { this.playRequested = performance.now(); await new Promise(resolve => setTimeout(resolve, 500)); this.paused = false; this.playStarted = performance.now(); }
    };
  });
  await page.route("**/api/statistics/**", route => route.fulfill({ json: { connected: false, nextSyncAt: null } }));
  await page.goto(server.resolvedUrls.local[0]);
  await page.locator(".blind-test-setup").waitFor();
  const chapterTracks = await page.evaluate(async () => {
    const { killerThemeUrl, killerTerrorRadiusUrl, killerBreathingUrl } = await import("/src/app/assets.ts");
    return Promise.all([killerThemeUrl("terrifier"), killerTerrorRadiusUrl("terrifier"), killerBreathingUrl("hag")]);
  });
  assert.match(chapterTracks[0], /Terrifier_Theme_Music\.ogg/);
  assert.match(chapterTracks[1], /TerrorRadius_Terrifier\.ogg/);
  assert.match(chapterTracks[2], /killer_breathing\/Hag_Breathing\.ogg/);
  await page.locator(".blind-test-fields select").selectOption("theme");
  await page.waitForFunction(() => window.mediaTest.some(audio => /\.og[ga]$/.test(audio.src)));
  await page.locator(".blind-test-fields input[type=range]").fill("1");
  await page.locator(".blind-test-setup .blind-test-play").click();
  await page.waitForFunction(() => window.mediaTest.some(audio => audio.playRequested && !audio.playStarted));
  assert.equal(await page.locator(".blind-test-countdown-value").innerText(), "…", "The clock must wait for actual playback");
  await page.waitForFunction(() => document.querySelector(".blind-test-countdown-value")?.textContent === "1");
  const prepared = await page.evaluate(() => window.mediaTest.filter(audio => audio.src && !audio.playRequested && audio.preload === "auto").length);
  assert.ok(prepared >= 1, "The next song must be prepared during the current question");
  await page.waitForFunction(() => window.mediaTest.some(audio => audio.src && !audio.playRequested && audio.currentTime > 0));
  await page.getByRole("button", { name: "Abandonner", exact: true }).click();
  await page.locator(".blind-test-setup").waitFor();
  await page.locator(".blind-test-setup .blind-test-play").click();
  await page.getByRole("button", { name: "Abandonner", exact: true }).click();
  await page.waitForTimeout(700);
  assert.equal(await page.locator(".blind-test-countdown-value").count(), 0, "Cancelled loading must not restart the game");
  await page.getByRole("button", { name: "Killers", exact: true }).click();
  await page.locator(".killer-card .killer-portrait img").first().waitFor();
  const nonWebp = await page.locator(".killer-card .killer-portrait img").evaluateAll(images => images.filter(image => !new URL(image.src).pathname.endsWith(".webp")).map(image => image.src));
  assert.deepEqual(nonWebp, []);
  console.log("Media checks passed: WebP icons, next-song preload, countdown after playback, cancellation while loading.");
} finally { await browser?.close(); await server.close(); }
