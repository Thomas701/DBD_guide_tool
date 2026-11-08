import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";

import { isSecurityChallenge } from "./chatgpt-browser-provider.mjs";
import { CodexChatGPTProvider, codexExecutable, codexFailureMessage, codexQuotas, lastAgentMessage } from "./codex-assistant-provider.mjs";

test("le moteur intégré démarre sans Codex installé globalement ni PATH", () => {
  const customPath = process.env.CODEX_CLI_PATH;
  delete process.env.CODEX_CLI_PATH;
  try {
    const executable = codexExecutable();
    assert.ok(isAbsolute(executable));
    assert.match(executable, /node_modules/);
    const version = execFileSync(executable, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 15_000, env: { ...process.env, PATH: "" }, stdio: ["ignore", "pipe", "pipe"] });
    assert.match(version, /codex-cli \d+\.\d+\.\d+/);
  } finally {
    if (customPath === undefined) delete process.env.CODEX_CLI_PATH;
    else process.env.CODEX_CLI_PATH = customPath;
  }
});

test("un profil natif neuf ne réutilise ni le compte VS Code ni une clé héritée", { timeout: 30_000 }, async (t) => {
  const profileDirectory = await mkdtemp(join(tmpdir(), "dbd-codex-isolation-"));
  t.after(() => rm(profileDirectory, { recursive: true, force: true }));
  const provider = new CodexChatGPTProvider({ profileDirectory });
  const status = await provider.status();
  assert.equal(status.installed, true);
  assert.equal(status.connected, false);
  assert.equal(status.account, null);
  assert.deepEqual(status.quotas, []);
  assert.match(status.detail, /connexion est indépendante de VS Code/);
});

test("extrait le dernier message assistant du flux JSONL Codex", () => {
  const output = [
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Première réponse" } }),
    JSON.stringify({ type: "turn.completed" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Réponse finale" } })
  ].join("\n");

  assert.equal(lastAgentMessage(output), "Réponse finale");
});

test("extrait l’erreur finale du flux signalé sans afficher les événements ni les avertissements", () => {
  const message = "The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account.";
  const output = [
    { type: "thread.started", thread_id: "test-thread" },
    { type: "item.completed", item: { type: "error", message: "Model metadata for `gpt-5.4` not found. Defaulting to fallback metadata." } },
    { type: "turn.started" },
    { type: "error", message },
    { type: "turn.failed", error: { message } }
  ].map((event) => JSON.stringify(event)).join("\n");
  assert.equal(codexFailureMessage(`${output}\nAvertissement sur stderr`), message);
  assert.equal(lastAgentMessage(output), "");
});

test("un avertissement de métadonnées ne transforme pas une réponse réussie en erreur", () => {
  const output = [
    { type: "item.completed", item: { type: "error", message: "Model metadata not found" } },
    { type: "item.completed", item: { type: "agent_message", text: "Bonjour !" } },
    { type: "turn.completed" }
  ].map((event) => JSON.stringify(event)).join("\n");
  assert.equal(codexFailureMessage(output), "");
  assert.equal(lastAgentMessage(output), "Bonjour !");
});

test("une erreur terminale sans détail reste un échec lisible", () => {
  assert.match(codexFailureMessage('{"type":"turn.failed","error":null}'), /pas pu terminer/);
  assert.equal(codexFailureMessage('{"type":"error","message":"Connexion interrompue"}'), "Connexion interrompue");
});

test("les quotas conservent toutes les périodes sans inventer de pourcentage manquant", () => {
  const result = codexQuotas({ rateLimitsByLimitId: {
    codex: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_800_000_000 }, secondary: { usedPercent: 100, windowDurationMins: 10080 } },
    special: { limitName: "Modèle spécial", primary: { windowDurationMins: 60, usedPercent: null } },
    missing: null
  } });
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].windows, [{ remainingPercent: 75, durationMinutes: 300, resetsAt: 1_800_000_000 }, { remainingPercent: 0, durationMinutes: 10080, resetsAt: null }]);
  assert.equal(result[1].name, "Modèle spécial");
  assert.equal(result[1].windows[0].remainingPercent, null);
  assert.deepEqual(codexQuotas({}), []);
  assert.equal(codexQuotas({ rateLimitsByLimitId: {}, rateLimits: { primary: { usedPercent: 0 } } })[0].windows[0].remainingPercent, 100);
});

test("détecte la vérification de sécurité française de Cloudflare", () => {
  assert.equal(isSecurityChallenge("auth.openai.com\nVérification de sécurité en cours\nVérifiez que vous êtes humain"), true);
  assert.equal(isSecurityChallenge("ChatGPT\nComment puis-je vous aider ?"), false);
});
