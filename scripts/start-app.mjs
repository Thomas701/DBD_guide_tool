import { spawn } from "node:child_process";

const root = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const appUrl = "http://127.0.0.1:5173";
const assistantUrl = "http://127.0.0.1:8787/api/assistant/status";
const children = [];

if (!await responds(assistantUrl)) children.push(start(["run", "assistant:proxy"]));
if (!await responds(appUrl)) children.push(start(["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"]));

try {
  await Promise.all([waitFor(appUrl, 45_000), waitFor(assistantUrl, 45_000)]);
  if (process.env.DBD_NO_OPEN_BROWSER !== "1") openBrowser(appUrl);
  console.log(`\nBuild Analyzer prêt : ${appUrl}`);
  console.log("Laissez cette fenêtre ouverte. Appuyez sur Ctrl+C pour arrêter l’application.\n");
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
    for (const child of children) child.once("exit", (code) => { if (code) resolve(); });
  });
} finally {
  for (const child of children) child.kill();
}

function start(args) {
  const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : npm;
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", npm, ...args] : args;
  return spawn(command, commandArgs, { cwd: root, stdio: "inherit", windowsHide: false });
}

async function waitFor(url, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await responds(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`Délai dépassé pendant le démarrage de ${url}`);
}

async function responds(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function openBrowser(url) {
  const [command, args] = process.platform === "win32"
    ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}
