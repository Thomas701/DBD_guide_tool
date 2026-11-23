import assert from "node:assert/strict";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const root = new URL("../DBDImages-main/DBDImages-main/images/", import.meta.url);
const browser = await chromium.launch({ headless: true });
let before = 0, after = 0, count = 0;
try {
  const page = await browser.newPage();
  for (const kind of ["perks/killer", "perks/survivor", "characters/killer", "characters/survivor"]) {
    for (const name of await readdir(new URL(`${kind}/`, root))) {
      if (!name.endsWith(".png")) continue;
      const source = new URL(`${kind}/${name}`, root), target = new URL(`${kind}/${name.replace(/\.png$/, ".webp")}`, root);
      const original = await readFile(source);
      if (!(await stat(target).catch(() => null)) || process.argv.includes("--force")) {
        const result = await page.evaluate(async ({ data, maxSize }) => {
          const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
          const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
          const context = canvas.getContext("2d"); context.imageSmoothingQuality = "high";
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL("image/webp", .78).split(",")[1];
        }, { data: original.toString("base64"), maxSize: 256 });
        const optimized = Buffer.from(result, "base64");
        assert.equal(optimized.toString("ascii", 8, 12), "WEBP");
        await writeFile(target, optimized);
      }
      before += original.length; after += (await stat(target)).size; count++;
    }
  }
  console.log(JSON.stringify({ icons: count, originalMB: +(before / 1e6).toFixed(2), optimizedMB: +(after / 1e6).toFixed(2), reduction: `${Math.round((1 - after / before) * 100)}%` }));
} finally { await browser.close(); }
