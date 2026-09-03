import { spawn } from "node:child_process";

const root = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const appUrl = process.env.DBD_APP_URL ?? "http://127.0.0.1:5173";
const assistantBaseUrl = process.env.DBD_ASSISTANT_SERVER_URL ?? "http://127.0.0.1:8787";
const assistantUrl = new URL("/api/assistant/status", assistantBaseUrl).toString();
const smokeTest = process.env.DBD_WEBAPP_SMOKE_TEST === "1";
const children = [];

if (!await responds(assistantUrl)) children.push(startService("Build Assistant", ["run", "assistant:proxy"]));
if (!await responds(appUrl)) children.push(startService("Interface Vite", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"]));

try {
  await Promise.all([waitFor(appUrl, 45_000), waitFor(assistantUrl, 45_000)]);
  if (!smokeTest) openBrowser(appUrl);
  console.log(`\nBuild Analyzer prêt : ${appUrl}`);
  if (smokeTest) {
    console.log("Vérification de démarrage terminée.");
  } else {
    console.log("Laissez cette fenêtre ouverte. Appuyez sur Ctrl+C pour arrêter l’application.\n");
    await waitForSignalOrServiceExit();
  }
} finally {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

function startService(label, args) {
  const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : npm;
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", npm, ...args] : args;
  const outputTail = [];
  const child = spawn(command, commandArgs, {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  captureOutput(child.stdout, outputTail, label);
  captureOutput(child.stderr, outputTail, label);
  return Object.assign(child, { label, outputTail });
}

function captureOutput(stream, outputTail, label) {
  if (!stream) return;
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      outputTail.push(`[${label}] ${trimmed}`);
      if (outputTail.length > 40) outputTail.shift();
    }
  });
}

async function waitFor(url, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await responds(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  const details = children.flatMap((child) => child.outputTail ?? []);
  const suffix = details.length > 0 ? `\n\nDernières lignes utiles :\n${details.join("\n")}` : "";
  throw new Error(`Délai dépassé pendant le démarrage de ${url}${suffix}`);
}

async function responds(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForSignalOrServiceExit() {
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
    for (const child of children) child.once("exit", (code) => { if (code) resolve(); });
  });
}

function openBrowser(url) {
  const [command, args] = process.platform === "win32"
    ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}
