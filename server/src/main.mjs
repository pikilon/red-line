// Red Line backend on the owner's VPS (docs/decisions.md D-03): tester
// reports (spec 47), multiplayer introductions (spec 51 §2) and relay
// credentials. Traefik in front terminates HTTPS.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { WebSocketServer } from "ws";
import { readForm, Reports } from "./reports.mjs";
import { MAX_FRAME, Rooms, validRoom } from "./rooms.mjs";
import { TesterStore } from "./testers.mjs";
import { turnCredentials } from "./turn.mjs";

const DATA_DIR = process.env.DATA_DIR ?? "/data";
const PUBLIC_URL = process.env.PUBLIC_URL ?? "https://red-line-server.pikilon.com";
const TURN_HOST = process.env.TURN_HOST ?? "";
const TURN_SECRET = process.env.TURN_SECRET ?? "";
const MAX_BODY = 110 * 1024 * 1024;
const RETRY_MS = 10 * 60 * 1000;

const testers = new TesterStore(join(DATA_DIR, "testers.json"));
const reports = new Reports({
  dataDir: DATA_DIR,
  publicUrl: PUBLIC_URL,
  repo: process.env.GITHUB_REPO ?? "pikilon/red-line",
  githubToken: process.env.GITHUB_TOKEN ?? "",
  projectId: process.env.GITHUB_PROJECT_ID ?? "",
  fetch: globalThis.fetch,
});
const rooms = new Rooms();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-tester-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

function json(res, status, body) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function report(req, res) {
  const tester = testers.byToken(req.headers["x-tester-token"]);
  if (tester === null) return json(res, 403, { error: "not-tester" });
  if (req.method === "GET") return json(res, 200, { name: tester.name });
  if (req.method !== "POST") return json(res, 405, { error: "method" });
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) {
    return json(res, 413, { error: "too-large" });
  }
  let form;
  try {
    form = await new Request("http://local/report", {
      method: "POST",
      headers: { "content-type": req.headers["content-type"] ?? "" },
      body: Readable.toWeb(req),
      duplex: "half",
    }).formData();
  } catch {
    return json(res, 400, { error: "bad-form" });
  }
  const parsed = readForm(form);
  if (parsed.error !== undefined) {
    return json(res, parsed.status, { error: parsed.error });
  }
  const folder = await reports.store(tester.name, parsed);
  const filed = await reports.file(folder);
  // A report without an issue yet is safe on disk and filed later.
  if (filed === null) return json(res, 200, { queued: true });
  return json(res, 200, filed);
}

function file(req, res, path) {
  const parts = path.split("/").slice(2);
  const ok =
    parts.length === 3 &&
    parts.every((part) => /^[\w.-]+$/.test(part) && !/^\.+$/.test(part));
  const full = ok ? join(DATA_DIR, "reports", ...parts) : "";
  if (!ok || parts[2] === "report.json" || !existsSync(full)) {
    res.writeHead(404).end();
    return;
  }
  const type = TYPES[extname(full).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": statSync(full).size,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=31536000, immutable",
    ...(type.startsWith("image/")
      ? {}
      : { "Content-Disposition": `attachment; filename="${parts[2]}"` }),
  });
  createReadStream(full).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://local");
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }
  if (url.pathname === "/health") return json(res, 200, { ok: true });
  if (url.pathname === "/report") {
    report(req, res).catch((error) => {
      console.error(error);
      if (!res.headersSent) json(res, 500, { error: "failed" });
    });
    return;
  }
  if (url.pathname.startsWith("/files/") && req.method === "GET") {
    return file(req, res, url.pathname);
  }
  if (url.pathname === "/turn" && req.method === "GET") {
    if (TURN_HOST === "" || TURN_SECRET === "") return json(res, 200, []);
    return json(res, 200, [turnCredentials(TURN_SECRET, TURN_HOST)]);
  }
  res.writeHead(404).end();
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://local");
  const room = url.searchParams.get("room");
  if (url.pathname !== "/signal" || !validRoom(room)) {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(req, socket, head, (ws) => {
    const peer = { send: (text) => ws.send(text) };
    if (!rooms.join(room, peer)) {
      ws.close(1013, "room full");
      return;
    }
    let alive = true;
    ws.on("pong", () => {
      alive = true;
    });
    const ping = setInterval(() => {
      if (!alive) ws.terminate();
      alive = false;
      ws.ping();
    }, 30_000);
    ws.on("message", (data, binary) => {
      if (!binary) rooms.relay(room, peer, data.toString());
    });
    ws.on("close", () => {
      clearInterval(ping);
      rooms.leave(room, peer);
    });
  });
});

setInterval(() => void reports.retryPending().catch(console.error), RETRY_MS);
void reports.retryPending().catch(console.error);
server.listen(8080, () => console.log("red-line server on :8080"));
