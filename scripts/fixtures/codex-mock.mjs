import assert from "node:assert/strict";
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

const root = process.env.DBD_CODEX_MOCK_ROOT;
const profile = join(root, ".dbd-build-tool", "codex");
assert.equal(process.env.CODEX_HOME, profile);
for (const key of ["CODEX_SQLITE_HOME", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "OPENAI_API_KEY", "OPENAI_IDENTITY_TOKEN_FILE", "OPENAI_FEDERATION_RULE_ID", "OPENAI_WORKLOAD_IDENTITY_CONTEXT"]) assert.equal(process.env[key], undefined, key);
const args = process.argv.slice(2);
assert.ok(args.includes('cli_auth_credentials_store="file"'));
const loggedIn = join(profile, "mock-account.json");
const models = [
  { model: "test-solver", displayName: "Solveur de test", isDefault: true },
  { model: "test-fast", displayName: "Rapide de test", isDefault: false }
];
const reply = { answer: "Voici les changements demandés.", actions: [{ type: "set_killer_tier", killerId: "trapper", tier: "A+" }] };
const read = async (file, fallback) => { try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { if (error.code === "ENOENT") return fallback; throw error; } };

if (args[0] === "app-server") {
  for await (const line of createInterface({ input: process.stdin })) {
    const { id, method, params } = JSON.parse(line);
    if (id === undefined) continue;
    let result;
    if (method === "initialize") result = { userAgent: "codex-test" };
    else if (method === "account/read") result = { account: await read(loggedIn, null) };
    else if (method === "model/list") result = params.cursor ? { data: [models[1], { model: "hidden-test", displayName: "Masqué", hidden: true }], nextCursor: null } : { data: [models[0]], nextCursor: "second-page" };
    else if (method === "account/rateLimits/read") {
      const limits = await read(join(root, "mock-limits.json"), { rateLimits: { limitId: "codex", primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_800_000_000 }, secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: 1_800_500_000 } } });
      if (limits === null) { console.log(JSON.stringify({ id, error: { code: -1, message: "Quota indisponible" } })); continue; }
      result = limits;
    } else throw new Error(`Méthode inattendue : ${method}`);
    console.log(JSON.stringify({ id, result }));
  }
} else if (args[0] === "login") {
  console.log("https://auth.openai.com/oauth/authorize?test=1");
  await new Promise((resolve) => setTimeout(resolve, 250));
  const account = await read(join(root, "mock-next-account.json"), { type: "chatgpt", email: "application@example.com", planType: "plus" });
  await writeFile(loggedIn, JSON.stringify(account));
} else if (args[0] === "logout") {
  await rm(loggedIn, { force: true });
} else if (args[0] === "exec") {
  const account = await read(loggedIn, null);
  assert.ok(account);
  const model = args[args.indexOf("--model") + 1];
  assert.ok(models.some((entry) => entry.model === model));
  assert.ok(args.includes("read-only") && args.includes("--output-schema"));
  let prompt = "";
  for await (const chunk of process.stdin) prompt += chunk;
  assert.ok(prompt.includes("Actions disponibles"));
  await appendFile(join(root, "mock-executions.jsonl"), `${JSON.stringify({ model, email: account.email })}\n`);
  if (prompt.includes("Je ne joue qu'avec Jake park, créer moi:")) {
    const creates = prompt.includes("=== CONTRÔLE AVANT APPLICATION ===");
    const actions = creates ? [
      { type: "save_build", buildId: null, name: "Jake — Générateurs", side: "survivor", killerId: "jake", perkIds: ["survivor-deja-vu", "survivor-resilience", "survivor-fast-track", "survivor-built-to-last"] },
      { type: "save_build", buildId: null, name: "Jake — Poursuite", side: "survivor", killerId: "jake", perkIds: ["survivor-lithe", "survivor-five-moves-ahead", "survivor-finesse", "survivor-off-the-record"] }
    ] : [];
    console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ answer: creates ? "Voici les deux builds pour Jake Park." : "Voici deux suggestions de builds.", actions }) } }));
  } else if (prompt.includes("REGRESSION_MODEL_REFUSED")) {
    const message = "The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account.";
    console.error("Model metadata not found. Defaulting to fallback metadata.");
    for (const event of [{ type: "thread.started", thread_id: "test-thread" }, { type: "item.completed", item: { type: "error", message: "Model metadata not found" } }, { type: "turn.started" }, { type: "error", message }, { type: "turn.failed", error: { message } }]) console.log(JSON.stringify(event));
    process.exitCode = 1;
  } else if (prompt.includes("REGRESSION_TURN_FAILED_ZERO")) {
    console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(reply) } }));
    console.log(JSON.stringify({ type: "turn.failed", error: { message: "Connexion interrompue" } }));
  } else {
    console.log(JSON.stringify({ type: "item.completed", item: { type: "error", message: "Model metadata not found" } }));
    console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(reply) } }));
  }
} else throw new Error(`Commande inattendue : ${args[0]}`);
