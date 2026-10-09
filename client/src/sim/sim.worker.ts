import init, { api_version, Sim } from "@sim/sim.js";
import type { MainToWorker, WorkerToMain } from "./protocol";
import { createWorkerHandler } from "./workerHandler";

interface WorkerScope {
  postMessage(m: WorkerToMain, t?: Transferable[]): void;
  onmessage: ((e: MessageEvent<MainToWorker>) => void) | null;
}

const scope = self as unknown as WorkerScope;

// Messages that arrive while the WASM module loads would be dropped if no
// listener were attached yet, so they are queued until the handler exists.
const early: MainToWorker[] = [];
scope.onmessage = (event) => early.push(event.data);

await init();

const handler = createWorkerHandler(
  (seed, n) => new Sim(seed, n),
  api_version(),
  (message, transfer) => scope.postMessage(message, transfer ?? []),
);

scope.onmessage = (event) => handler.handle(event.data);
for (const message of early.splice(0)) handler.handle(message);

setInterval(() => handler.advance(performance.now()), 1000 / 60);
