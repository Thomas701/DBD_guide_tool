import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_URL } from "../extension/config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, ".tmp-statistics-extension");
const archive = join(root, "dist", "dbd-statistics-extension.zip");
await mkdir(output, { recursive: true });
await mkdir(join(root, "dist"), { recursive: true });
const files = ["manifest.json", "background.mjs", "content.js", "policy.mjs", "config.mjs", "behaviour-session.mjs", "INSTALLATION.txt"];
for (const file of files) await copyFile(join(root, "extension", file), join(output, file));
for (const file of ["statistics-parser.mjs", "match-history-identity.mjs"]) {
  await copyFile(join(root, "shared", file), join(output, file));
  files.push(file);
}
const appUrl = new URL(process.env.VITE_SITE_URL ?? APP_URL);
if (appUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(appUrl.hostname)) throw new Error("Le site de l’extension doit utiliser HTTPS.");
await writeFile(join(output, "config.mjs"), `export const APP_URL = ${JSON.stringify(appUrl.href)};\n`);
const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
manifest.externally_connectable.matches = [`${appUrl.origin}/*`];
await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2));

const quote = value => `'${value.replaceAll("'", "''")}'`;
const result = process.platform === "win32"
  ? spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Compress-Archive -LiteralPath ${files.map(file => quote(join(output, file))).join(",")} -DestinationPath ${quote(archive)} -Force`], { stdio: "inherit", windowsHide: true })
  : spawnSync("python3", ["-m", "zipfile", "-c", archive, ...files], { cwd: output, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error("Création du ZIP de l’extension impossible.");
console.log(`Extension prête : ${resolve(archive)}`);
