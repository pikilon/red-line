/** Spec 51 §2: the introduction between the two browsers goes over a
 *  WebSocket room on the game's server (`/signal?room=redline-<room>`),
 *  which relays every message to the other sockets in the room. Nothing is
 *  stored; once the direct connection exists the socket closes. */
import { SERVER_URL } from "./server";

export type SignalMessage =
  | { kind: "hello"; from: string }
  | { kind: "offer"; from: string; to: string; sdp: string }
  | { kind: "answer"; from: string; to: string; sdp: string };

export interface SignalChannel {
  /** Resolves once the socket is open. */
  readonly joined: Promise<void>;
  send(message: SignalMessage): void;
  close(): void;
}

export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export function signalUrl(room: string): string {
  const base = SERVER_URL.replace(/^http/, "ws");
  return `${base}/signal?room=${encodeURIComponent(`redline-${room}`)}`;
}

function isSignal(value: unknown): value is SignalMessage {
  if (value === null || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "hello" || kind === "offer" || kind === "answer";
}

/** Joins the room and relays the other browsers' messages to `onMessage`. */
export function openSignalChannel(
  room: string,
  onMessage: (message: SignalMessage) => void,
  connect: () => SocketLike = () =>
    new WebSocket(signalUrl(room)) as unknown as SocketLike,
): SignalChannel {
  const socket = connect();
  let open = false;
  let resolveJoined: () => void = () => {};
  let rejectJoined: (error: Error) => void = () => {};
  const joined = new Promise<void>((resolve, reject) => {
    resolveJoined = resolve;
    rejectJoined = reject;
  });
  socket.onopen = () => {
    open = true;
    resolveJoined();
  };
  socket.onmessage = (event) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }
    if (isSignal(parsed)) onMessage(parsed);
  };
  socket.onerror = () => rejectJoined(new Error("signal socket error"));
  socket.onclose = () => {
    open = false;
    rejectJoined(new Error("signal socket closed"));
  };
  return {
    joined,
    send(message) {
      if (open) socket.send(JSON.stringify(message));
    },
    close() {
      open = false;
      socket.close();
    },
  };
}
