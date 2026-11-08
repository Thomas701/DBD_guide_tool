import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { ensureService, stopService, superviseServices } from "./start-app.mjs";

const source = `
  import {createServer} from "node:http";
  let healthy = true;
  createServer((request, response) => {
    if (request.url.startsWith("/exit/")) {
      response.end("stopping");
      setTimeout(() => process.exit(Number(request.url.split("/").at(-1))), 30);
    } else if (request.url === "/unhealthy") {
      healthy = false;
      response.end("unhealthy");
    } else {
      response.writeHead(healthy ? 200 : 503);
      response.end(String(process.pid));
    }
  }).listen(Number(process.env.DBD_LAUNCHER_TEST_PORT), "127.0.0.1");
`;

async function fixture(t) {
  const reserve = createServer();
  reserve.listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const url = `http://127.0.0.1:${port}`;
  const controller = new AbortController();
  const service = { label: "Serveur de test", args: ["--input-type=module", "-e", source], env: { DBD_LAUNCHER_TEST_PORT: String(port) }, ready: async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(500) });
    await response.text();
    return response.ok;
  } };
  let monitor;
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "log", () => {});
  t.after(async () => { controller.abort(); await monitor?.catch(() => {}); await stopService(service); });
  return { service, url, controller, watch() { monitor = superviseServices([service], controller.signal, 40); monitor.catch(() => {}); return monitor; } };
}

async function until(check) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(40);
  }
  assert.fail("Le serveur de test n’a pas été rétabli à temps.");
}

test("le lanceur rétablit le même port après une sortie normale ou un crash", { timeout: 20_000 }, async (t) => {
  const { service, url, controller, watch } = await fixture(t);
  await ensureService(service, controller.signal, 5_000);
  watch();
  for (const code of [0, 7]) {
    const previous = service.child;
    const exited = once(previous, "exit");
    await fetch(`${url}/exit/${code}`);
    await exited;
    await until(async () => service.child !== previous && service.failures === 0 && await service.ready().catch(() => false));
    assert.equal(await (await fetch(url)).text(), String(service.child.pid));
  }
  const child = service.child;
  const stopped = once(child, "close");
  controller.abort();
  await stopService(service);
  await stopped;
  assert.equal(await service.ready().catch(() => false), false);
});

test("un serveur déjà ouvert est préservé, surveillé puis remplacé s’il disparaît", { timeout: 15_000 }, async (t) => {
  const { service, url, controller, watch } = await fixture(t);
  const external = createServer((_request, response) => response.end("serveur existant"));
  external.listen(Number(new URL(url).port), "127.0.0.1");
  await once(external, "listening");
  t.after(() => { external.closeAllConnections(); external.close(); });
  await ensureService(service, controller.signal);
  assert.equal(service.child, undefined);
  await stopService(service);
  assert.equal(await (await fetch(url)).text(), "serveur existant");
  watch();
  await new Promise((resolve) => { external.close(resolve); external.closeAllConnections(); });
  await until(async () => service.child && service.failures === 0 && await service.ready().catch(() => false));
  assert.equal(await (await fetch(url)).text(), String(service.child.pid));
});

test("le processus vivant mais inaccessible est relancé après trois échecs", { timeout: 15_000 }, async (t) => {
  const { service, url, controller, watch } = await fixture(t);
  await ensureService(service, controller.signal, 5_000);
  const previous = service.child;
  watch();
  await fetch(`${url}/unhealthy`);
  await until(async () => service.child !== previous && service.failures === 0 && await service.ready().catch(() => false));
  assert.equal(await (await fetch(url)).text(), String(service.child.pid));
});

test("les arrêts répétés finissent par une erreur explicite, sans boucle infinie", { timeout: 20_000 }, async (t) => {
  const { service, url, controller, watch } = await fixture(t);
  await ensureService(service, controller.signal, 5_000);
  const failure = assert.rejects(watch(), /arrêts répétés/);
  failure.catch(() => {});
  for (let restart = 0; restart < 4; restart++) {
    const child = service.child;
    const exited = once(child, "exit");
    await fetch(`${url}/exit/0`);
    await exited;
    if (restart < 3) await until(async () => service.child !== child && service.failures === 0 && await service.ready().catch(() => false));
  }
  await failure;
});

test("un échec de démarrage affiche immédiatement les diagnostics, même avec un code zéro", { timeout: 8_000 }, async (t) => {
  const { service, controller } = await fixture(t);
  service.args = ["-e", "console.error('diagnostic démarrage');process.exit(0)"];
  await assert.rejects(ensureService(service, controller.signal, 5_000), /code 0[\s\S]*diagnostic démarrage/);
});

test("un port occupé produit une erreur et son occupant est laissé intact", { timeout: 8_000 }, async (t) => {
  const { service, url, controller } = await fixture(t);
  const external = createServer((_request, response) => response.writeHead(404).end("autre application"));
  external.listen(Number(new URL(url).port), "127.0.0.1");
  await once(external, "listening");
  t.after(() => { external.closeAllConnections(); external.close(); });
  await assert.rejects(ensureService(service, controller.signal, 5_000), /EADDRINUSE/);
  assert.equal(await (await fetch(url)).text(), "autre application");
});
