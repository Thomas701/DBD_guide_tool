import { spawn } from "node:child_process";

const root = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const appUrl = process.env.DBD_APP_URL ?? "http://127.0.0.1:5173";
const assistantBaseUrl = process.env.DBD_ASSISTANT_SERVER_URL ?? "http://127.0.0.1:8787";
const assistantUrl = new URL("/api/assistant/status", assistantBaseUrl).toString();
const assistantPort = Number(new URL(assistantBaseUrl).port || 80);
const smokeTest = process.env.DBD_WEBAPP_SMOKE_TEST === "1";
const children = [];

const assistantState = await assistantServerState(assistantUrl, await localGitRevision());
if (assistantState === "stale") await stopStaleAssistantServer(assistantUrl, assistantPort);
if (assistantState !== "current") children.push(startService("Build Assistant", ["run", "assistant:proxy"]));
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

async function assistantServerState(url, localRevision) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return "missing";
    const body = await response.json();
    if (body?.provider !== "browser") return "missing";
    return typeof body.apiVersion === "number" && body.apiVersion >= 3
      && (!localRevision || body.serviceRevision === localRevision) ? "current" : "stale";
  } catch {
    return "missing";
  }
}

async function localGitRevision() {
  try {
    return await runCommand("git", ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, "rev-parse", "HEAD"]);
  } catch {
    return null;
  }
}

async function stopStaleAssistantServer(url, port) {
  if (process.platform !== "win32") throw new Error("Un ancien Build Assistant est actif. Fermez-le, puis relancez l’application.");
  const output = await runCommand("netstat", ["-ano", "-p", "tcp"]);
  const processIds = [...new Set(output.split(/\r?\n/).flatMap((line) => {
    const columns = line.trim().split(/\s+/);
    return columns.at(-2) === "LISTENING" && columns[1]?.endsWith(`:${port}`) ? [columns.at(-1)] : [];
  }).filter((value) => /^\d+$/.test(value)))];
  if (processIds.length !== 1) throw new Error("Un ancien Build Assistant utilise le port local. Fermez le terminal Build Analyzer en cours, puis relancez l’application.");
  await runCommand("taskkill", ["/PID", processIds[0], "/T", "/F"]);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!await responds(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Le précédent Build Assistant ne s’est pas arrêté. Fermez son terminal, puis relancez l’application.");
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `${command} s’est arrêté avec le code ${code}.`)));
  });
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
