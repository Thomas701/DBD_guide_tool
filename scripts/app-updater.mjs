import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = process.cwd();
const remote = process.env.DBD_UPDATE_REMOTE ?? "origin";
const branch = process.env.DBD_UPDATE_BRANCH ?? "main";

export class AppUpdateError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "AppUpdateError";
    this.status = status;
  }
}

export async function getAppUpdateStatus({ fetchRemote = true } = {}) {
  try {
    await git(["rev-parse", "--is-inside-work-tree"]);
    const currentBranch = await git(["branch", "--show-current"]);
    if (currentBranch !== branch) return unavailable(`La mise à jour nécessite la branche « ${branch} » (branche actuelle : « ${currentBranch || "détachée"} »).`);

    if (fetchRemote) await git(["fetch", "--quiet", remote, branch], 60_000);
    const currentRevision = await git(["rev-parse", "HEAD"]);
    const latestRevision = await git(["rev-parse", `${remote}/${branch}`]);
    const dirty = hasBlockingChanges(await git(["status", "--porcelain", "--untracked-files=no"]));
    const relation = await revisionRelation(currentRevision, latestRevision);
    const currentVersion = await packageVersion(currentRevision);
    const latestVersion = await packageVersion(latestRevision);

    if (shouldBlockForChanges(relation, dirty)) return status(false, currentVersion, latestVersion, currentRevision, latestRevision, "Des fichiers locaux ont été modifiés. Enregistrez ou annulez ces changements avant la mise à jour.", true);
    if (relation === "behind") return status(true, currentVersion, latestVersion, currentRevision, latestRevision, "Une nouvelle version est disponible sur GitHub.");
    if (relation === "diverged") return status(false, currentVersion, latestVersion, currentRevision, latestRevision, "La version locale a divergé de GitHub. Une mise à jour automatique serait risquée.", true);
    return status(false, currentVersion, latestVersion, currentRevision, latestRevision, relation === "ahead" ? "Cette installation est plus récente que GitHub." : "L’application est à jour.");
  } catch (error) {
    if (isGitMissing(error)) return unavailable("Git est absent. Cliquez sur « Installer Git et mettre à jour » pour l’installer automatiquement.", true);
    return unavailable(commandError(error, "Impossible de vérifier les mises à jour GitHub."));
  }
}

export async function applyAppUpdate() {
  let before = await getAppUpdateStatus();
  let gitInstalled = false;
  if (before.gitMissing) {
    await installGit();
    gitInstalled = true;
    before = await getAppUpdateStatus();
  }
  if (!before.supported) throw new AppUpdateError(503, before.message);
  if (!before.available) return { ...before, gitInstalled };

  const lockChanged = Boolean(await git(["diff", "--name-only", before.currentRevision, before.latestRevision, "--", "package-lock.json"]));
  await git(["merge", "--ff-only", before.latestRevision], 60_000);
  if (lockChanged) await installDependencies();

  const after = await getAppUpdateStatus({ fetchRemote: false });
  return {
    ...after,
    message: lockChanged
      ? "Mise à jour installée. Fermez puis relancez Build Analyzer pour charger les nouvelles dépendances."
      : "Mise à jour installée. Rechargement de l’application…",
    updated: true,
    gitInstalled,
    restartRequired: lockChanged
  };
}

export function classifyRevisions(currentRevision, latestRevision, currentIsAncestor, latestIsAncestor) {
  if (currentRevision === latestRevision) return "same";
  if (currentIsAncestor) return "behind";
  if (latestIsAncestor) return "ahead";
  return "diverged";
}

export function hasBlockingChanges(statusOutput) {
  return statusOutput.split(/\r?\n/).some((line) => line && line.slice(3).replaceAll("\\", "/") !== ".data/current-build.json");
}

export function shouldBlockForChanges(relation, dirty) {
  return relation === "behind" && dirty;
}

export function isGitMissing(error) {
  return error instanceof Error && /spawn git(?:\.exe)? ENOENT|git(?:\.exe)?[^\n]*(?:not found|introuvable)/i.test(error.message);
}

async function revisionRelation(currentRevision, latestRevision) {
  return classifyRevisions(
    currentRevision,
    latestRevision,
    await gitSucceeds(["merge-base", "--is-ancestor", currentRevision, latestRevision]),
    await gitSucceeds(["merge-base", "--is-ancestor", latestRevision, currentRevision])
  );
}

async function packageVersion(revision) {
  const source = await git(["show", `${revision}:package.json`]);
  const value = JSON.parse(source)?.version;
  return typeof value === "string" && value.trim() ? value : "inconnue";
}

async function installDependencies() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  await run(npm, ["install", "--include=dev", "--no-audit", "--no-fund"], 300_000);
  const lockFile = path.join(repositoryRoot, "package-lock.json");
  const stampFile = path.join(repositoryRoot, "node_modules", ".dbd-package-lock.sha256");
  const hash = createHash("sha256").update(await readFile(lockFile)).digest("hex").toUpperCase();
  await writeFile(stampFile, hash, "ascii");
}

async function installGit() {
  if (process.platform !== "win32") throw new AppUpdateError(503, "Git est absent. Installez-le depuis votre gestionnaire de paquets, puis réessayez.");
  try {
    await run("winget", ["install", "--id", "Git.Git", "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements"], 300_000);
  } catch (error) {
    throw new AppUpdateError(503, commandError(error, "Git n’a pas pu être installé automatiquement. Vérifiez que winget est disponible."));
  }
  const gitDirectory = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "cmd");
  process.env.Path = `${gitDirectory}${path.delimiter}${process.env.Path ?? ""}`;
  try {
    await git(["--version"]);
  } catch (error) {
    throw new AppUpdateError(503, commandError(error, "Git a été installé, mais reste introuvable. Fermez puis relancez Build Analyzer."));
  }
}

function status(available, currentVersion, latestVersion, currentRevision, latestRevision, message, blocked = false) {
  return {
    supported: true,
    available,
    blocked,
    currentVersion,
    latestVersion,
    currentRevision: currentRevision.slice(0, 7),
    latestRevision: latestRevision.slice(0, 7),
    message
  };
}

function unavailable(message, gitMissing = false) {
  return { supported: false, available: false, blocked: true, gitMissing, currentVersion: null, latestVersion: null, currentRevision: null, latestRevision: null, message };
}

function git(args, timeout = 30_000) {
  return run("git", ["-c", `safe.directory=${repositoryRoot.replaceAll("\\", "/")}`, ...args], timeout);
}

async function gitSucceeds(args) {
  try {
    await git(args);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Délai dépassé pour ${command}.`));
    }, timeout);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${command} s’est arrêté avec le code ${code}.`));
    });
  });
}

function commandError(error, fallback) {
  const message = error instanceof Error ? error.message.trim() : "";
  return message ? `${fallback} ${message}` : fallback;
}
