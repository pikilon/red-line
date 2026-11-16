/** Spec 51 §2: the introduction between the two browsers goes over a
 *  Supabase Realtime broadcast channel named after the room. Nothing is
 *  stored; once the direct connection exists the socket closes. Plain
 *  WebSocket (Phoenix protocol, JSON v1), so the client needs no SDK. */
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../report/api";

export type SignalMessage =
  | { kind: "hello"; from: string }
  | { kind: "offer"; from: string; to: string; sdp: string }
  | { kind: "answer"; from: string; to: string; sdp: string };

export interface SignalChannel {
  /** Resolves once the channel is joined. */
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

const HEARTBEAT_MS = 25_000;
const EVENT = "signal";

export function realtimeUrl(): string {
  const base = SUPABASE_URL.replace(/^http/, "ws");
  return `${base}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;
}

/** Joins `realtime:redline-<room>` and relays broadcasts to `onMessage`. */
export function openSignalChannel(
  room: string,
  onMessage: (message: SignalMessage) => void,
  connect: () => SocketLike = () =>
    new WebSocket(realtimeUrl()) as unknown as SocketLike,
): SignalChannel {
  const topic = `realtime:redline-${room}`;
  const socket = connect();
  let ref = 0;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let resolveJoined: () => void = () => {};
  let rejectJoined: (error: Error) => void = () => {};
  const joined = new Promise<void>((resolve, reject) => {
    resolveJoined = resolve;
    rejectJoined = reject;
  });
  const push = (event: string, payload: unknown, to = topic): void => {
    ref += 1;
    socket.send(
      JSON.stringify({
        topic: to,
        event,
        payload,
        ref: String(ref),
        join_ref: "1",
      }),
    );
  };
  socket.onopen = () => {
    push("phx_join", {
      config: { broadcast: { self: false, ack: false }, private: false },
      access_token: SUPABASE_ANON_KEY,
    });
    heartbeat = setInterval(
      () => push("heartbeat", {}, "phoenix"),
      HEARTBEAT_MS,
    );
  };
  socket.onmessage = (event) => {
    const frame = JSON.parse(event.data) as {
      topic: string;
      event: string;
      ref?: string | null;
      payload: {
        status?: string;
        event?: string;
        payload?: SignalMessage;
      };
    };
    if (frame.topic !== topic) return;
    if (frame.event === "phx_reply" && frame.ref === "1") {
      if (frame.payload.status === "ok") resolveJoined();
      else rejectJoined(new Error("signal join refused"));
      return;
    }
    if (frame.event === "broadcast" && frame.payload.event === EVENT) {
      const message = frame.payload.payload;
      if (message !== undefined) onMessage(message);
    }
  };
  socket.onerror = () => rejectJoined(new Error("signal socket error"));
  socket.onclose = () => {
    if (heartbeat !== null) clearInterval(heartbeat);
    rejectJoined(new Error("signal socket closed"));
  };
  return {
    joined,
    send(message) {
      push("broadcast", { type: "broadcast", event: EVENT, payload: message });
    },
    close() {
      if (heartbeat !== null) clearInterval(heartbeat);
      socket.close();
    },
  };
}
