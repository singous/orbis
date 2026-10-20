import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { EnginePool } from "./pool";
import { EngineError, MAX_REQUEST_BYTES, MAX_WORKERS, TRANSFORM_TIMEOUT_MS } from "./protocol";
import type { TransformRequest } from "./engine";

const key = process.env.ORBIS_COLLABORATION_KEY ?? "";
if (key.length < 32 || key.startsWith("REPLACE_") || /[\r\n]/.test(key)) throw new Error("ORBIS_COLLABORATION_KEY must contain at least 32 random characters");
const expected = createHash("sha256").update(key).digest();
const port = Number(process.env.ORBIS_COLLABORATION_PORT ?? "9203");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("ORBIS_COLLABORATION_PORT is invalid");
const pool = new EnginePool();
function reply(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}
function authenticated(request: IncomingMessage) {
  const auth = request.headers.authorization;
  if (!auth?.startsWith("Bearer ") || auth.length > 8192) return false;
  return timingSafeEqual(expected, createHash("sha256").update(auth.slice(7)).digest());
}
async function read(request: IncomingMessage): Promise<TransformRequest> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_REQUEST_BYTES) throw new EngineError("CONTENT_TOO_LARGE");
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new EngineError("INVALID_REQUEST"); }
}
let active = 0;
const server = createServer(async (request, response) => {
  if (request.url === "/healthz" && request.method === "GET") { reply(response, 200, { status: "ok" }); return; }
  if (!authenticated(request)) { reply(response, 401, { code: "UNAUTHORIZED" }); return; }
  if (request.url !== "/transform" || request.method !== "POST") { reply(response, 404, { code: "NOT_FOUND" }); return; }
  if (request.headers["content-type"]?.split(";")[0] !== "application/json") { reply(response, 415, { code: "INVALID_REQUEST" }); return; }
  if (Number(request.headers["content-length"] ?? 0) > MAX_REQUEST_BYTES) { reply(response, 413, { code: "CONTENT_TOO_LARGE" }); return; }
  if (active >= MAX_WORKERS) { reply(response, 503, { code: "ENGINE_BUSY" }); return; }
  active++;
  try { reply(response, 200, await pool.run(await read(request))); }
  catch (error) {
    const code = error instanceof EngineError ? error.code : "ENGINE_FAILURE";
    const status = code === "EDIT_TARGET_REMOVED" ? 409 : code === "CONTENT_TOO_LARGE" ? 413 : code === "ENGINE_BUSY" || code === "ENGINE_TIMEOUT" ? 503 : code === "ENGINE_FAILURE" ? 500 : 422;
    if (!response.destroyed) reply(response, status, { code });
  }
  finally { active--; }
});
server.requestTimeout = TRANSFORM_TIMEOUT_MS;
server.headersTimeout = TRANSFORM_TIMEOUT_MS;
server.keepAliveTimeout = 5_000;
server.maxConnections = 32;
server.listen(port, process.env.ORBIS_COLLABORATION_HOST ?? "0.0.0.0");
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  server.close();
  server.closeIdleConnections();
  void pool.close().then(() => server.closeAllConnections());
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
