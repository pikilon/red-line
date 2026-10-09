import init, { api_version, Sim } from "@sim/sim.js";
import type { MainToWorker, WorkerToMain } from "./protocol";
import { createWorkerHandler } from "./workerHandler";

interface WorkerScope {
  postMessage(m: WorkerToMain, t?: Transferable[]): void;
  onmessage: ((e: MessageEvent<MainToWorker>) => void) | null;
}

const scope = self as unknown as WorkerScope;

await init();

const handler = createWorkerHandler(
  (seed, n) => new Sim(seed, n),
  api_version(),
  (message, transfer) => scope.postMessage(message, transfer ?? []),
);

scope.onmessage = (event) => handler.handle(event.data);

setInterval(() => handler.advance(performance.now()), 1000 / 60);
