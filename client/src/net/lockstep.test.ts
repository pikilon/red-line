import { describe, expect, it, vi } from "vitest";
import type { SimCommand, TurnMessage, WorkerToMain } from "../sim/protocol";
import {
  createWorkerHandler,
  type SkirmishSimLike,
} from "../sim/workerHandler";
import { createLockstep, LOCKSTEP, type PeerMessage } from "./lockstep";
import { openSignalChannel, type SocketLike, signalUrl } from "./signal";

const TICK = 1000 / 15;

/** A skirmish sim that only counts ticks and records move orders. */
function fakeSkirmish() {
  let tick = 0;
  const moves: [number, number][] = [];
  const base = {
    tick: () => tick,
    step: () => {
      tick += 1;
    },
    state_hash_hex: () => `h${tick}`,
    map_width: () => 4,
    map_height: () => 4,
    map_tiles: () => new Uint8Array(16),
    snapshot_for: () => new Int32Array(4),
    fog_for: () => new Uint8Array(16),
    command_move_as: (player: number, _units: Uint32Array, x: number) => {
      moves.push([player, x]);
    },
  };
  const sim = new Proxy(base, {
    get: (target, key) =>
      key in target ? target[key as keyof typeof target] : () => {},
  }) as unknown as SkirmishSimLike;
  return { sim, moves, ticks: () => tick };
}

function lockstepWorker() {
  const fake = fakeSkirmish();
  const posted: WorkerToMain[] = [];
  const handler = createWorkerHandler(
    () => {
      throw new Error("unused");
    },
    4,
    (message) => posted.push(message),
    () => fake.sim,
  );
  handler.handle({
    type: "initSkirmish",
    seed: 1,
    mapId: "m",
    viewer: 0,
    speed: 1,
    debug: false,
    ai: null,
    lockstep: LOCKSTEP,
  });
  let now = 0;
  handler.advance(now);
  const run = (ticks: number): void => {
    for (let i = 0; i < ticks; i++) {
      now += TICK + 0.01;
      handler.advance(now);
    }
  };
  return { handler, fake, posted, run };
}

const move = (player: number, x: number): SimCommand => ({
  kind: "move",
  player,
  units: [1],
  xRaw: x,
  yRaw: 0,
});

const turn = (t: number, player: number, commands: SimCommand[] = []) =>
  ({ type: "turn", turn: t, player, commands }) as TurnMessage;

describe("lockstep worker", () => {
  it("AC-51-01: stops at a turn boundary until both players' orders arrived", () => {
    const { handler, fake, posted, run } = lockstepWorker();
    // Turns 0 and 1 need no orders: 6 ticks run, then turn 2 waits.
    run(10);
    expect(fake.ticks()).toBe(6);
    expect(posted).toContainEqual({ type: "waiting", waiting: true });
    handler.handle(turn(2, 0));
    run(3);
    expect(fake.ticks()).toBe(6);
    handler.handle(turn(2, 1));
    run(3);
    expect(fake.ticks()).toBe(9);
    expect(posted).toContainEqual({ type: "waiting", waiting: false });
    const started = posted.filter((m) => m.type === "turnStarted");
    expect(started.map((m) => m.turn)).toEqual([0, 1, 2]);
    expect(started[0]).toEqual({ type: "turnStarted", turn: 0, hash: "h0" });
  });

  it("AC-51-02: runs orders in player order and ignores direct commands", () => {
    const { handler, fake, run } = lockstepWorker();
    handler.handle({ type: "command", command: move(0, 99) });
    handler.handle(turn(2, 1, [move(1, 20)]));
    handler.handle(turn(2, 0, [move(0, 10), move(0, 11)]));
    run(7);
    expect(fake.moves).toEqual([
      [0, 10],
      [0, 11],
      [1, 20],
    ]);
  });
});

describe("lockstep coordinator", () => {
  function coordinator(localPlayer = 0) {
    const sent: PeerMessage[] = [];
    const toWorker: TurnMessage[] = [];
    const onDesync = vi.fn();
    const lockstep = createLockstep({
      localPlayer,
      send: (m) => sent.push(m),
      toWorker: (m) => toWorker.push(m),
      onDesync,
    });
    return { lockstep, sent, toWorker, onDesync };
  }

  it("AC-51-03: schedules local orders two turns ahead for both simulations", () => {
    const { lockstep, sent, toWorker } = coordinator(0);
    lockstep.queue(move(0, 5));
    lockstep.turnStarted(4, undefined);
    lockstep.turnStarted(5, undefined);
    expect(toWorker[0]).toEqual(turn(6, 0, [move(0, 5)]));
    expect(toWorker[1]).toEqual(turn(7, 0, []));
    expect(sent[0]).toEqual({ t: "turn", turn: 6, commands: [move(0, 5)] });
  });

  it("AC-51-04: the peer only orders its own side and never debug commands", () => {
    const { lockstep, toWorker } = coordinator(0);
    lockstep.receive({
      t: "turn",
      turn: 3,
      commands: [
        move(0, 7),
        { kind: "debugSetHp", entity: 1, hp: 0 },
        { kind: "debugSpawn", player: 1, typeIndex: 0, xRaw: 0, yRaw: 0 },
      ],
    });
    expect(toWorker).toEqual([turn(3, 1, [move(1, 7)])]);
  });

  it("AC-51-05: reports a desync once when the state hashes differ", () => {
    const { lockstep, sent, onDesync } = coordinator(1);
    lockstep.turnStarted(0, "aa");
    lockstep.receive({ t: "hash", turn: 0, hash: "aa" });
    expect(onDesync).not.toHaveBeenCalled();
    expect(sent).toContainEqual({ t: "hash", turn: 0, hash: "aa" });
    lockstep.receive({ t: "hash", turn: 15, hash: "bb" });
    lockstep.turnStarted(15, "cc");
    lockstep.turnStarted(30, "dd");
    lockstep.receive({ t: "hash", turn: 30, hash: "ee" });
    expect(onDesync).toHaveBeenCalledTimes(1);
    expect(onDesync).toHaveBeenCalledWith(15);
  });
});

describe("signal channel", () => {
  it("AC-51-06: joins the room socket and relays messages", async () => {
    const frames: unknown[] = [];
    const socket: SocketLike = {
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: (data) => frames.push(JSON.parse(data)),
      close: () => {},
    };
    const received = vi.fn();
    const channel = openSignalChannel("abc", received, () => socket);
    expect(signalUrl("abc")).toBe(
      "wss://red-line-server.pikilon.com/signal?room=redline-abc",
    );
    socket.onopen?.();
    await channel.joined;
    channel.send({ kind: "hello", from: "g" });
    expect(frames).toEqual([{ kind: "hello", from: "g" }]);
    const reply = (frame: unknown) =>
      socket.onmessage?.({ data: JSON.stringify(frame) });
    reply({ kind: "hello", from: "x" });
    reply({ kind: "junk" });
    socket.onmessage?.({ data: "not json" });
    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith({ kind: "hello", from: "x" });
    channel.close();
  });
});
