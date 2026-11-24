/** Spec 51 §2: the direct browser-to-browser connection. The host opens a
 *  room, the guest says hello, the host offers, the guest answers; from then
 *  on every message goes peer to peer over one reliable, ordered channel. */
import type { PeerMessage } from "./lockstep";
import { iceServers } from "./server";
import { openSignalChannel, type SignalMessage } from "./signal";

const HELLO_EVERY_MS = 2000;
const ICE_GATHER_MS = 4000;
export const CONNECT_TIMEOUT_MS = 30_000;

export interface PeerLink {
  send(message: PeerMessage): void;
  onMessage(listener: (message: PeerMessage) => void): void;
  /** Called once when the other browser goes away. */
  onClose(listener: () => void): void;
  close(): void;
}

/** A short, unguessable room code (spec 51 §2.1). */
export function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

/** Waits until the browser gathered its addresses, so the offer or answer
 *  travels in one signal message (no trickle). */
async function gathered(connection: RTCPeerConnection): Promise<string> {
  if (connection.iceGatheringState !== "complete") {
    await new Promise<void>((resolve) => {
      const done = (): void => {
        if (connection.iceGatheringState === "complete") resolve();
      };
      connection.addEventListener("icegatheringstatechange", done);
      setTimeout(resolve, ICE_GATHER_MS);
    });
  }
  return connection.localDescription?.sdp ?? "";
}

function linkOf(
  connection: RTCPeerConnection,
  channel: RTCDataChannel,
): PeerLink {
  const listeners = new Set<(message: PeerMessage) => void>();
  const closers = new Set<() => void>();
  let closed = false;
  const fireClose = (): void => {
    if (closed) return;
    closed = true;
    for (const listener of closers) listener();
  };
  channel.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as PeerMessage;
    if (message.t === "bye") {
      fireClose();
      return;
    }
    for (const listener of listeners) listener(message);
  };
  channel.onclose = fireClose;
  connection.onconnectionstatechange = () => {
    if (
      connection.connectionState === "failed" ||
      connection.connectionState === "closed"
    ) {
      fireClose();
    }
  };
  return {
    send(message) {
      if (channel.readyState === "open") channel.send(JSON.stringify(message));
    },
    onMessage(listener) {
      listeners.add(listener);
    },
    onClose(listener) {
      closers.add(listener);
    },
    close() {
      if (channel.readyState === "open") {
        channel.send(JSON.stringify({ t: "bye" }));
      }
      closed = true;
      channel.close();
      connection.close();
    },
  };
}

function opened(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState === "open") return Promise.resolve();
  return new Promise((resolve) => {
    channel.addEventListener("open", () => resolve(), { once: true });
  });
}

function withTimeout<T>(promise: Promise<T>, cleanup: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("connect timeout"));
    }, CONNECT_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Host side: waits (without time limit) for the first guest of `room`. */
export function hostRoom(room: string): {
  link: Promise<PeerLink>;
  cancel(): void;
} {
  const id = `host-${newRoomCode()}`;
  void iceServers();
  let connection: RTCPeerConnection | null = null;
  let resolveLink: (link: PeerLink) => void = () => {};
  const link = new Promise<PeerLink>((resolve) => {
    resolveLink = resolve;
  });
  const signal = openSignalChannel(room, (message: SignalMessage) => {
    if (message.kind === "hello" && connection === null) {
      const guest = message.from;
      const created = new RTCPeerConnection();
      connection = created;
      const channel = created.createDataChannel("game", { ordered: true });
      void (async () => {
        created.setConfiguration({ iceServers: await iceServers() });
        await created.setLocalDescription(await created.createOffer());
        const sdp = await gathered(created);
        signal.send({ kind: "offer", from: id, to: guest, sdp });
      })();
      void opened(channel).then(() => {
        signal.close();
        resolveLink(linkOf(created, channel));
      });
      return;
    }
    if (message.kind === "answer" && message.to === id && connection) {
      void connection.setRemoteDescription({
        type: "answer",
        sdp: message.sdp,
      });
    }
  });
  return {
    link,
    cancel() {
      signal.close();
      connection?.close();
    },
  };
}

/** Guest side: joins `room` and connects to its host. */
export function joinRoom(room: string): Promise<PeerLink> {
  const id = `guest-${newRoomCode()}`;
  const connection = new RTCPeerConnection();
  const servers = iceServers();
  let answered = false;
  let hello: ReturnType<typeof setInterval> | null = null;
  const channelReady = new Promise<RTCDataChannel>((resolve) => {
    connection.ondatachannel = (event) => resolve(event.channel);
  });
  const signal = openSignalChannel(room, (message) => {
    if (message.kind !== "offer" || message.to !== id || answered) return;
    answered = true;
    if (hello !== null) clearInterval(hello);
    void (async () => {
      connection.setConfiguration({ iceServers: await servers });
      await connection.setRemoteDescription({
        type: "offer",
        sdp: message.sdp,
      });
      await connection.setLocalDescription(await connection.createAnswer());
      const sdp = await gathered(connection);
      signal.send({ kind: "answer", from: id, to: message.from, sdp });
    })();
  });
  const cleanup = (): void => {
    if (hello !== null) clearInterval(hello);
    signal.close();
    connection.close();
  };
  const link = (async () => {
    await signal.joined;
    // The host may join after us: repeat the hello until it offers.
    signal.send({ kind: "hello", from: id });
    hello = setInterval(() => {
      if (!answered) signal.send({ kind: "hello", from: id });
    }, HELLO_EVERY_MS);
    const channel = await channelReady;
    await opened(channel);
    signal.close();
    return linkOf(connection, channel);
  })();
  return withTimeout(link, cleanup);
}
