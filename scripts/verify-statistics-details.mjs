import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { readMatchDetailsFromPage } from "./dbd-statistics-provider.mjs";

// Regression for animated/replaced buttons; uses a separate page without the official account.
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const context = await browser.newContext();
const cwd = process.cwd();
const workspace = await mkdtemp(join(tmpdir(), "dbd-statistics-details-"));
try {
  process.chdir(workspace); // Keep synthetic HTML snapshots out of the real archive.
  const page = await context.newPage();
  await page.route("https://assets.live.bhvraccount.com/**", route => route.abort());
  const base = "https://assets.live.bhvraccount.com/";
  const entry = {
    role: "survivor", characterName: "Dwight", durationLabel: "9:01",
    participants: [0, 1].map(index => ({ imageUrl: `${base}characters/survivors/Dwight.png`, score: 100 + index })),
  };
  await page.setContent('<style>@keyframes moving { from { transform: translateX(0); } to { transform: translateX(100px); } } button { animation: moving .15s infinite alternate; }</style><button data-cy="killer-match-card-btn">Match</button>');
  await page.evaluate(({ entry, base }) => {
    document.querySelector("button").onclick = () => {
      const modal = document.createElement("div");
      modal.dataset.cy = "modal";
      modal.innerHTML = '<button data-cy="modal-close-btn">Close</button><div data-cy="Duration-card"><span class="text-neutral-text-xlight grow text-start text-lg font-bold">5:15</span></div><div data-cy="Players-card"></div>';
      modal.querySelector("button").onclick = () => modal.remove();
      entry.participants.forEach((participant, index) => {
        const button = document.createElement("button");
        button.dataset.cy = "survivor-opponent-btn";
        button.innerHTML = `<img src="${participant.imageUrl}">${participant.score}`;
        button.onclick = () => {
          const selected = document.createElement("div");
          selected.dataset.cy = "participant-match-details";
          selected.innerHTML = `<button data-cy="back-btn">Back</button><div data-cy="Duration-card"><span class="text-neutral-text-xlight grow text-start text-lg font-bold">${index === 0 ? "9:01" : "7:34"}</span></div><img src="${base}perks/Participant${index}.png">`;
          const bind = back => { back.onclick = () => selected.remove(); };
          bind(selected.querySelector("button"));
          // React can replace an animated control while Playwright waits for stability.
          const replacement = setInterval(() => {
            if (!selected.isConnected) return clearInterval(replacement);
            const back = selected.querySelector("button");
            const next = back.cloneNode(true);
            bind(next);
            back.replaceWith(next);
          }, 40);
          modal.append(selected);
        };
        modal.querySelector('[data-cy="Players-card"]').append(button);
      });
      document.body.append(modal);
    };
  }, { entry, base });
  const result = await readMatchDetailsFromPage(page, 0, entry);
  assert.equal(result.survivalTimeLabel, "5:15", "Personal duration is read independently from match duration");
  assert.deepEqual(result.participants.map(participant => participant.survivalTimeLabel), ["9:01", "7:34"]);
  assert.deepEqual(result.participants.map(participant => participant.perkIconUrls), [[`${base}perks/Participant0.png`], [`${base}perks/Participant1.png`]]);
  assert.equal(await page.locator('[data-cy="modal"]').count(), 0);
  console.log("Animated/replaced back buttons, equal match duration, distinct participant loadouts: OK");
} finally {
  process.chdir(cwd);
  await context.close();
  await rm(workspace, { recursive: true, force: true });
}
process.exit(0);
