import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));

async function main() {
  const appUrl = new URL(process.env.DBD_APP_URL ?? "http://127.0.0.1:5173");
  const assistantBaseUrl = new URL(process.env.DBD_ASSISTANT_SERVER_URL ?? "http://127.0.0.1:8787");
  for (const url of [appUrl, assistantBaseUrl]) {
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password) throw new Error("Les serveurs de l’application doivent utiliser une adresse HTTP locale.");
  }
  const assistantUrl = new URL("/api/assistant/status", assistantBaseUrl).toString();
  const assistantPort = Number(assistantBaseUrl.port || 80);
  const smokeTest = process.env.DBD_WEBAPP_SMOKE_TEST === "1";
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const services = [
    { label: "Build Assistant", args: ["scripts/openai-assistant-proxy.mjs"], env: { OPENAI_ASSISTANT_PORT: String(assistantPort) }, ready: async () => (await assistantServerState(assistantUrl, null)) === "current" },
    { label: "Interface Vite", args: ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", appUrl.port || "80", "--strictPort"], env: { VITE_ASSISTANT_SERVER_URL: assistantBaseUrl.origin, VITE_APP_UPDATE_SERVER_URL: assistantBaseUrl.origin }, ready: async () => {
      const response = await fetch(appUrl, { signal: AbortSignal.timeout(1_000) });
      return response.ok && (await response.text()).includes("<title>DBD Build Tool</title>");
    } }
  ];
  let startup = [];
  try {
    const assistantState = await assistantServerState(assistantUrl, await localGitRevision());
    if (assistantState === "stale") await stopStaleAssistantServer(assistantUrl, assistantPort);
    startup = services.map((service) => ensureService(service, controller.signal));
    await Promise.all(startup);
    if (controller.signal.aborted) return;
    if (!smokeTest) openBrowser(appUrl.href);
    console.log(`\nBuild Analyzer prêt : ${appUrl.href}`);
    if (smokeTest) console.log("Vérification de démarrage terminée.");
    else {
      console.log("Laissez cette fenêtre ouverte. Les serveurs sont surveillés ; Ctrl+C arrête l’application.\n");
      await superviseServices(services, controller.signal);
    }
  } finally {
    controller.abort();
    await Promise.allSettled(startup);
    await Promise.all(services.map(stopService));
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

function startService(service) {
  const { label, args } = service;
  const outputTail = [];
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...service.env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  captureOutput(child.stdout, outputTail, label);
  captureOutput(child.stderr, outputTail, label);
  child.on("error", (error) => { child.spawnError = error; });
  service.child = Object.assign(child, { label, outputTail });
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

async function isReady(service) {
  try { return await service.ready(); } catch { return false; }
}

export async function ensureService(service, signal, timeout = 45_000) {
  if (await isReady(service) || signal.aborted) return;
  startService(service);
  await waitForService(service, signal, timeout);
}

async function waitForService(service, signal, timeout) {
  const deadline = Date.now() + timeout;
  while (!signal.aborted && Date.now() < deadline) {
    if (await isReady(service)) return;
    const child = service.child;
    if (child.spawnError || child.exitCode !== null || child.signalCode !== null) {
      throw serviceError(service, child.spawnError?.message ?? `arrêt inattendu (code ${child.exitCode ?? child.signalCode})`);
    }
    await delay(250, undefined, { signal }).catch(() => {});
  }
  if (!signal.aborted) throw serviceError(service, "délai de démarrage dépassé");
}

function serviceError(service, message) {
  const details = service.child?.outputTail?.join("\n") ?? "";
  return new Error(`${service.label} : ${message}.${details ? `\nDernières lignes utiles :\n${details}` : ""}`);
}

export async function superviseServices(services, signal, interval = 2_000) {
  while (!signal.aborted) {
    await delay(interval, undefined, { signal }).catch(() => {});
    if (signal.aborted) return;
    for (const service of services) {
      if (await isReady(service)) { service.failures = 0; continue; }
      const child = service.child;
      const alive = child && !child.spawnError && child.exitCode === null && child.signalCode === null;
      service.failures = (service.failures ?? 0) + 1;
      if ((!child || alive) && service.failures < 3) continue;
      service.restarts = (service.restarts ?? []).filter((time) => Date.now() - time < 60_000);
      if (service.restarts.length >= 3) throw serviceError(service, "arrêts répétés, relance automatique interrompue");
      service.restarts.push(Date.now());
      console.warn(`${service.label} ne répond plus. Relance automatique…`);
      await stopService(service);
      if (signal.aborted) return;
      startService(service);
      await waitForService(service, signal, 45_000);
      service.failures = 0;
      if (!signal.aborted) console.log(`${service.label} rétabli sur la même adresse.`);
    }
  }
}

export async function stopService(service) {
  const child = service.child;
  if (!child || child.spawnError || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = new Promise((resolve) => child.once("close", resolve));
  if (process.platform === "win32") {
    await runCommand("taskkill", ["/PID", String(child.pid), "/T", "/F"]).catch((error) => {
      if (child.exitCode === null && child.signalCode === null) throw error;
    });
  } else child.kill();
  await stopped;
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
    return typeof body.apiVersion === "number" && body.apiVersion >= 18
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

function openBrowser(url) {
  const [command, args] = process.platform === "win32"
    ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`\nImpossible de maintenir Build Analyzer en cours d’exécution :\n${error.message}`); process.exitCode = 1; });
}
