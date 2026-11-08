import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { request } from "node:http";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuildCreation, requestedNewBuildCount } from "./assistant-response.mjs";

const jakeRequest = "Je ne joue qu'avec Jake park, créer moi:\n- le meilleur build possible pour faire les générateurs rapidement\n- le meilleur build possible pour tenir une chase face à un tueur";

test("une demande de deux builds pour Jake exige deux sauvegardes, même si le premier résultat ne contient que du texte", async () => {
  assert.equal(requestedNewBuildCount(jakeRequest), 2);
  assert.equal(requestedNewBuildCount("Crée-moi trois builds pour Jake"), 3);
  assert.equal(requestedNewBuildCount("Peux-tu me créer deux builds ?"), 2);
  assert.equal(requestedNewBuildCount("Comment créer deux builds pour Jake ?"), 0);
  assert.equal(requestedNewBuildCount("Explique cette phrase : crée-moi deux builds"), 0);
  assert.equal(requestedNewBuildCount("Crée un build sans sauvegarder"), 0);
  assert.equal(requestedNewBuildCount("Ne crée pas de builds"), 0);
  const actions = ["Générateurs", "Poursuite"].map((name) => ({ type: "save_build", buildId: null, name: `Jake — ${name}`, side: "survivor", killerId: "jake", perkIds: ["survivor-deja-vu", "survivor-resilience", "survivor-lithe", "survivor-five-moves-ahead"] }));
  let calls = 0;
  const response = await ensureBuildCreation(jakeRequest, "Contexte complet", async (prompt) => {
    calls++;
    assert.ok(prompt.startsWith("Contexte complet"));
    if (calls === 1) return { answer: "Voici mes conseils.", actions: [] };
    assert.match(prompt, /2 nouveaux builds sauvegardés/);
    return { answer: "Voici les deux builds.", actions };
  });
  assert.equal(calls, 2);
  assert.deepEqual(response.actions, actions);
  let failedCalls = 0;
  await assert.rejects(ensureBuildCreation(jakeRequest, "Contexte", async () => { failedCalls++; return { answer: "Brouillon", actions: [{ type: "set_current_build" }] }; }), /Aucun build sauvegardé/);
  assert.equal(failedCalls, 2);
});

test("le proxy transmet le prompt complet et préserve les accents entre deux morceaux UTF-8", { timeout: 15_000 }, async (t) => {
  const prelude = `
    import { Server } from "node:http";
    const listen = Server.prototype.listen;
    Server.prototype.listen = function (...args) {
      this.once("listening", () => process.send({ port: this.address().port }));
      return listen.apply(this, args);
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url) !== "https://api.openai.com/v1/responses") return realFetch(url, init);
      const body = JSON.parse(init.body);
      if (!body.text) return new Response(JSON.stringify({ output_text: body.input }));
      const repaired = body.input.includes("=== CONTRÔLE AVANT APPLICATION ===");
      const actions = repaired ? ["Générateurs", "Poursuite"].map(name => ({type:"save_build",buildId:null,name,side:"survivor",killerId:"jake",perkIds:["survivor-deja-vu","survivor-resilience","survivor-lithe","survivor-five-moves-ahead"]})) : [];
      return new Response(JSON.stringify({output_text:JSON.stringify({answer:body.input,actions})}));
    };
  `;
  const child = fork(new URL("./openai-assistant-proxy.mjs", import.meta.url), [], {
    execArgv: ["--import", `data:text/javascript,${encodeURIComponent(prelude)}`],
    env: { ...process.env, OPENAI_ASSISTANT_PORT: "0", OPENAI_API_KEY: "test-only" },
    silent: true,
    windowsHide: true
  });
  t.after(async () => {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  });
  const [{ port }] = await once(child, "message");
  const prompt = "Catalogue retravaillé : durée, épuisement, générateurs.\n".repeat(5_000);
  const body = { provider: "openai", message: "Analyse", prompt, context: {}, history: [] };
  const payload = Buffer.from(JSON.stringify(body));
  const split = payload.indexOf(Buffer.from("é"), 10_000) + 1;
  const responsePromise = new Promise((resolve, reject) => {
    const outgoing = request(`http://127.0.0.1:${port}/api/assistant/message`, { method: "POST", headers: { "Content-Type": "application/json" } }, async (response) => {
      try {
        assert.equal(response.statusCode, 200);
        response.setEncoding("utf8");
        let text = "";
        for await (const chunk of response) text += chunk;
        resolve(JSON.parse(text));
      } catch (error) { reject(error); }
    });
    outgoing.on("error", reject);
    outgoing.write(payload.subarray(0, split));
    void delay(20).then(() => outgoing.end(payload.subarray(split)));
  });
  assert.ok((await responsePromise).answer === prompt, "Le prompt complet doit arriver sans caractères corrompus.");

  const legacy = await fetch(`http://127.0.0.1:${port}/api/build-assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Question précédente", context: { name: "Piégeur" }, history: [] })
  });
  assert.equal(legacy.status, 200);
  const { answer } = await legacy.json();
  assert.match(answer, /Contexte du build \(JSON\).*\n.*Piégeur/);
  assert.match(answer, /Question précédente/);

  const creation = await fetch(`http://127.0.0.1:${port}/api/assistant/message`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "openai", message: jakeRequest, context: { name: "Contexte conservé" }, history: [{ role: "user", content: "Historique conservé" }], actionMode: true })
  });
  assert.equal(creation.status, 200);
  const repaired = await creation.json();
  assert.equal(repaired.actions.length, 2);
  assert.match(repaired.answer, /CONTRÔLE AVANT APPLICATION/);
  assert.match(repaired.answer, /Contexte conservé/);
  assert.match(repaired.answer, /Historique conservé/);
  assert.ok(repaired.answer.includes(jakeRequest));
});

test("les comptes Codex restent indépendants, le modèle choisi est utilisé et les quotas sont transmis fidèlement", { timeout: 45_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dbd-assistant-"));
  const cli = fileURLToPath(new URL("./fixtures/codex-mock.mjs", import.meta.url));
  const profile = join(directory, ".dbd-build-tool", "codex");
  const loggedIn = join(profile, "mock-account.json");
  const vscodeProfile = join(directory, ".codex");
  await mkdir(vscodeProfile);
  await writeFile(join(vscodeProfile, "auth.json"), "session-vscode-intacte");
  const reply = { answer: "Voici les changements demandés.", actions: [{ type: "set_killer_tier", killerId: "trapper", tier: "A+" }] };
  const prelude = `
    import { Server } from "node:http";
    import childProcess from "node:child_process";
    import os from "node:os";
    import { syncBuiltinESMExports } from "node:module";
    const listen = Server.prototype.listen;
    Server.prototype.listen = function (...args) { this.once("listening", () => process.send({port:this.address().port})); return listen.apply(this,args); };
    const realSpawn = childProcess.spawn;
    childProcess.spawn = (command,args,options) => command === "__mock_codex__" ? realSpawn(process.execPath,[${JSON.stringify(cli)},...args],options) : realSpawn(command,args,options);
    os.homedir = () => ${JSON.stringify(directory)};
    syncBuiltinESMExports();
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("https://api.openai.com/v1/models/")) return new Response("{}", {status:init.headers.Authorization === "Bearer test-session-key" ? 200 : 401});
      if (String(url) === "https://api.openai.com/v1/responses") {
        const body = JSON.parse(init.body);
        if (init.headers.Authorization !== "Bearer test-session-key" || body.store !== false || body.text?.format?.strict !== true || !body.input.includes("Actions disponibles")) return new Response("{}", {status:400});
        return new Response(JSON.stringify({output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(${JSON.stringify(reply)})}]}]}));
      }
      return realFetch(url,init);
    };
  `;
  const child = fork(new URL("./openai-assistant-proxy.mjs", import.meta.url), [], {
    execArgv: ["--import", `data:text/javascript,${encodeURIComponent(prelude)}`],
    env: { ...process.env, OPENAI_ASSISTANT_PORT: "0", OPENAI_API_KEY: "inherited-secret", CODEX_API_KEY: "inherited-secret", CODEX_ACCESS_TOKEN: "inherited-secret", CODEX_HOME: vscodeProfile, CODEX_SQLITE_HOME: vscodeProfile, OPENAI_IDENTITY_TOKEN_FILE: "inherited-secret", OPENAI_FEDERATION_RULE_ID: "inherited-secret", OPENAI_WORKLOAD_IDENTITY_CONTEXT: "inherited-secret", CODEX_CLI_PATH: "__mock_codex__", CODEX_ASSISTANT_MODEL: "", DBD_CODEX_MOCK_ROOT: directory },
    silent: true, windowsHide: true
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    await rm(directory, { recursive: true, force: true });
    assert.ok(!output.includes("test-session-key"));
  });
  const [{ port }] = await once(child, "message");
  const base = `http://127.0.0.1:${port}`;
  const send = async (path, method = "GET", body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  await send("/api/assistant/openai/connect", "DELETE");
  assert.equal((await send("/api/assistant/openai/status")).body.connected, false);
  const connection = await send("/api/assistant/openai/connect", "POST", { apiKey: "test-session-key", model: "gpt-5-mini" });
  assert.equal(connection.status, 200);
  assert.equal(connection.body.connected, true);
  assert.ok(!JSON.stringify(connection.body).includes("test-session-key"));
  assert.equal((await send("/api/assistant/openai/connect", "POST", { apiKey: "invalid-key", model: "gpt-5-mini" })).status, 401);
  assert.equal((await send("/api/assistant/openai/status")).body.connected, true);
  const request = { provider: "openai", message: "Adapte la tier list", prompt: "Question et catalogue", context: null, history: [], actionMode: true };
  assert.deepEqual((await send("/api/assistant/message", "POST", request)).body, reply);
  assert.equal((await send("/api/assistant/openai/connect", "DELETE")).body.connected, false);
  assert.equal((await send("/api/assistant/message", "POST", request)).status, 503);
  assert.equal((await send("/api/assistant/codex/status")).body.connected, false);
  assert.equal((await send("/api/assistant/codex/login", "POST")).body.loginPending, true);
  let connected = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const status = (await send("/api/assistant/codex/status")).body;
    if (status.loginUrl) assert.equal(new URL(status.loginUrl).hostname, "auth.openai.com");
    if (status.connected) { connected = true; break; }
    await delay(100);
  }
  assert.equal(connected, true);
  assert.equal(JSON.parse(await readFile(loggedIn, "utf8")).email, "application@example.com");
  const metadata = (await send("/api/assistant/codex/status")).body;
  assert.equal(metadata.account.email, "application@example.com");
  assert.equal(metadata.account.plan, "plus");
  assert.deepEqual(metadata.models.map((entry) => entry.id), ["test-solver", "test-fast"]);
  assert.equal(metadata.selectedModel, "test-solver");
  assert.deepEqual(metadata.quotas[0].windows.map((window) => window.remainingPercent), [75, 40]);
  assert.equal((await send("/api/assistant/codex/model", "POST", { model: "not-in-catalog" })).status, 502);
  assert.equal((await send("/api/assistant/codex/model", "POST", { model: "test-fast" })).body.selectedModel, "test-fast");
  assert.equal(JSON.parse(await readFile(join(profile, "build-assistant-settings.json"), "utf8")).model, "test-fast");
  assert.deepEqual((await send("/api/assistant/message", "POST", { ...request, provider: "codex" })).body, reply);
  const [execution] = (await readFile(join(directory, "mock-executions.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(execution, { model: "test-fast", email: "application@example.com" });
  const jakeBuilds = await send("/api/assistant/message", "POST", { ...request, provider: "codex", message: jakeRequest, prompt: jakeRequest });
  assert.equal(jakeBuilds.status, 200);
  assert.equal(jakeBuilds.body.actions.length, 2);
  assert.ok(jakeBuilds.body.actions.every((action) => action.type === "save_build" && action.buildId === null && action.side === "survivor" && action.killerId === "jake" && action.perkIds.length === 4));
  const refusedModel = await send("/api/assistant/message", "POST", { ...request, provider: "codex", prompt: "REGRESSION_MODEL_REFUSED" });
  assert.equal(refusedModel.status, 502);
  assert.equal(refusedModel.body.code, "MODEL_UNAVAILABLE");
  assert.match(refusedModel.body.error, /modèle n’est pas disponible/);
  assert.doesNotMatch(refusedModel.body.error, /thread\.started|turn\.failed|fallback metadata|"type"/);
  assert.equal(refusedModel.body.actions, undefined);
  const failedTurn = await send("/api/assistant/message", "POST", { ...request, provider: "codex", prompt: "REGRESSION_TURN_FAILED_ZERO" });
  assert.equal(failedTurn.status, 502);
  assert.equal(failedTurn.body.error, "Connexion interrompue");
  assert.equal(failedTurn.body.actions, undefined);
  assert.deepEqual((await send("/api/assistant/message", "POST", { ...request, provider: "codex" })).body, reply);
  await writeFile(join(directory, "mock-limits.json"), "null");
  const noQuota = (await send("/api/assistant/codex/status?refresh=1")).body;
  assert.equal(noQuota.connected, true);
  assert.deepEqual(noQuota.quotas, []);
  assert.match(noQuota.quotaDetail, /indisponible/);
  const disconnected = await send("/api/assistant/codex/logout", "POST");
  assert.equal(disconnected.body.connected, false);
  assert.equal(disconnected.body.account, null);
  assert.deepEqual(disconnected.body.quotas, []);
  assert.equal((await send("/api/assistant/message", "POST", { ...request, provider: "codex" })).status, 401);
  assert.equal(await readFile(join(vscodeProfile, "auth.json"), "utf8"), "session-vscode-intacte");
  await writeFile(join(directory, "mock-next-account.json"), JSON.stringify({ type: "chatgpt", email: "second-account@example.com", planType: "pro" }));
  await send("/api/assistant/codex/login", "POST");
  let secondAccount;
  for (let attempt = 0; attempt < 30; attempt++) {
    secondAccount = (await send("/api/assistant/codex/status?refresh=1")).body;
    if (secondAccount.connected) break;
    await delay(100);
  }
  assert.equal(secondAccount.account.email, "second-account@example.com");
  assert.equal(secondAccount.selectedModel, "test-fast");
  assert.equal(await readFile(join(vscodeProfile, "auth.json"), "utf8"), "session-vscode-intacte");
  const denied = await fetch(`${base}/api/assistant/openai/connect`, { method: "POST", headers: { Origin: "https://example.com", "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "test-session-key", model: "gpt-5-mini" }) });
  assert.equal(denied.status, 403);
});
