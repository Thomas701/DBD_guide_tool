import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer, normalizePath } from "vite";

test("Vite ignore les profils Chrome et les copies temporaires sans ignorer les sources", { timeout: 10_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dbd-vite-watch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDirectory = join(root, "src");
  for (const directory of [sourceDirectory, join(root, ".data", "dbd-statistics-chrome-profile", "Default", "Network"), join(root, ".tmp-install", "clone neuf")]) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, directory === sourceDirectory ? "main.ts" : "Cookies"), "fixture");
  }
  const server = await createServer({
    root,
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "silent"
  });
  t.after(() => server.close());
  const deadline = Date.now() + 5_000;
  while (!server.watcher.getWatched()[normalizePath(sourceDirectory)]?.includes("main.ts") && Date.now() < deadline) {
    await delay(20);
  }
  const watched = Object.entries(server.watcher.getWatched()).flatMap(([directory, files]) => files.map(file => normalizePath(relative(root, join(directory, file)))));
  assert.ok(watched.includes("src/main.ts"), "Les sources doivent rester surveillées.");
  assert.deepEqual(watched.filter(path => /^\.data(?:\/|$)/.test(path)), [], "Le profil Chrome ne doit pas être surveillé.");
  assert.deepEqual(watched.filter(path => /^\.tmp-/.test(path)), [], "Les copies temporaires ne doivent pas être surveillées.");
});
