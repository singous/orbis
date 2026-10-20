import { parentPort } from "node:worker_threads";
import { transform } from "./engine";
import { EngineError } from "./protocol";

if (!parentPort) throw new Error("Worker must be owned by the collaboration engine");
parentPort.on("message", request => {
  try { parentPort!.postMessage({ result: transform(request) }); }
  catch (error) { parentPort!.postMessage({ code: error instanceof EngineError ? error.code : "ENGINE_FAILURE" }); }
});
