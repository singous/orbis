import { it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { EnginePool } from "../src/pool";
import { EngineError, MAX_REQUEST_BYTES } from "../src/protocol";
import { Worker } from "node:worker_threads";
import { setImmediate } from "node:timers/promises";

async function availablePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

it("authenticates the internal engine and serves safe transform results through owned workers", { timeout: 20_000 }, async () => {
  const port = await availablePort(), secret = "test-key-" + randomUUID();
  const process = spawn(globalThis.process.execPath, [new URL("../dist/server.mjs", import.meta.url).pathname], {
    env: { ...globalThis.process.env, ORBIS_COLLABORATION_KEY: secret, ORBIS_COLLABORATION_HOST: "127.0.0.1", ORBIS_COLLABORATION_PORT: String(port) }, stdio: "ignore",
  });
  const origin = `http://127.0.0.1:${port}`;
  const post = (body: unknown, key = secret) => fetch(origin + "/transform", { method: "POST", headers: { authorization: "Bearer " + key, "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await fetch(origin + "/healthz")).status === 200) { ready = true; break; } } catch { /* Wait for the owned listener. */ }
      await delay(50);
    }
    assert.ok(ready);
    assert.equal((await post({}, "wrong")).status, 401);
    const invalid = await post({ state: "malformed", blocks: null, update: null });
    assert.equal(invalid.status, 422);
    assert.deepEqual(await invalid.json(), { code: "INVALID_STATE" });
    const block = { id: randomUUID(), type: "paragraph", props: {}, content: [{ text: "persisted", marks: [], href: null }], children: [] };
    const response = await post({ state: null, blocks: [block], update: null });
    assert.equal(response.status, 200);
    const seeded = await response.json() as { state: string; state_vector: string; blocks: unknown[]; changed: boolean };
    assert.deepEqual(seeded.blocks, [block]);
    assert.ok(seeded.state && seeded.state_vector && seeded.changed);
    const reread = await post({ state: seeded.state, blocks: null, update: null });
    assert.equal(reread.status, 200);
    assert.equal(((await reread.json()) as { changed: boolean }).changed, false);
    const unauthenticated = await fetch(origin + "/transform", { method: "POST", body: "{}" });
    assert.equal(unauthenticated.status, 401);
    const oversized = await new Promise<number>(resolve => {
      const req = request(origin + "/transform", { method: "POST", headers: { authorization: "Bearer " + secret, "content-type": "application/json", "content-length": MAX_REQUEST_BYTES + 1 } }, response => { resolve(response.statusCode!); response.resume(); req.destroy(); });
      req.on("error", () => {});
      req.flushHeaders();
    });
    assert.equal(oversized, 413);
    const slowBodies = Array.from({ length: 2 }, () => {
      const req = request(origin + "/transform", { method: "POST", headers: { authorization: "Bearer " + secret, "content-type": "application/json", "content-length": 100 } });
      req.on("error", () => {});
      req.write("{");
      return req;
    });
    try {
      await delay(20);
      const busy = await post({ state: null, blocks: [], update: null });
      assert.equal(busy.status, 503);
      assert.deepEqual(await busy.json(), { code: "ENGINE_BUSY" });
    } finally { slowBodies.forEach(req => req.destroy()); }
  } finally {
    process.kill("SIGTERM");
    const closed = new Promise(resolve => process.once("exit", resolve));
    await Promise.race([closed, delay(2_000).then(() => process.kill("SIGKILL"))]);
  }
});

it("terminates a transform worker at its deadline and closes its replacement", { timeout: 5_000 }, async () => {
  const pool = new EnginePool(1, 1, new URL("../dist/worker.mjs", import.meta.url));
  try {
    await assert.rejects(pool.run({ state: null, blocks: [], update: null }), (error: unknown) => error instanceof EngineError && error.code === "ENGINE_TIMEOUT");
  } finally { await pool.close(); }
});

function observedWorkers() {
  const workers: Worker[] = [], exits = new Map<Worker, Promise<void>>();
  let live = 0, maximum = 0;
  return {
    workers, exits,
    maximum: () => maximum,
    factory: (url: URL) => {
      const worker = new Worker(url);
      workers.push(worker);
      maximum = Math.max(maximum, ++live);
      exits.set(worker, new Promise(resolve => worker.once("exit", () => { live--; resolve(); })));
      return worker;
    },
  };
}

it("never overlaps retired and replacement threads through repeated deadlines", { timeout: 5_000 }, async () => {
  const observed = observedWorkers();
  const pool = new EnginePool(1, 1, new URL("../dist/worker.mjs", import.meta.url), observed.factory);
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      while (observed.workers.at(-1)!.threadId === -1) await setImmediate();
      const worker = observed.workers.at(-1)!;
      await assert.rejects(pool.run({ state: null, blocks: [], update: null }), (error: unknown) => error instanceof EngineError && error.code === "ENGINE_TIMEOUT");
      await observed.exits.get(worker);
      await setImmediate();
    }
  } finally { await pool.close(); }
  assert.equal(observed.maximum(), 1);
  assert.ok(observed.workers.length >= 4);
  assert.ok(observed.workers.every(worker => worker.threadId === -1));
});

it("joins a failed worker and every replacement before closing", { timeout: 5_000 }, async () => {
  const observed = observedWorkers();
  const pool = new EnginePool(2_000, 1, new URL("../tests/fixtures/crashing-worker.mjs", import.meta.url), observed.factory);
  await assert.rejects(pool.run({ state: null, blocks: [], update: null }), (error: unknown) => error instanceof EngineError && error.code === "ENGINE_FAILURE");
  await pool.close();
  assert.equal(observed.maximum(), 1);
  assert.ok(observed.workers.every(worker => worker.threadId === -1));
});

it("rejects an in-flight transform and joins owned threads when close is called twice", { timeout: 5_000 }, async () => {
  const observed = observedWorkers();
  const pool = new EnginePool(2_000, 2, new URL("../dist/worker.mjs", import.meta.url), observed.factory);
  const operation = pool.run({ state: null, blocks: [], update: null });
  const rejected = assert.rejects(operation, (error: unknown) => error instanceof EngineError && error.code === "ENGINE_FAILURE");
  await Promise.all([pool.close(), pool.close(), rejected]);
  assert.equal(observed.workers.length, 2);
  assert.ok(observed.maximum() <= 2);
  assert.ok(observed.workers.every(worker => worker.threadId === -1));
  await assert.rejects(pool.run({ state: null, blocks: [], update: null }), (error: unknown) => error instanceof EngineError && error.code === "ENGINE_BUSY");
});
