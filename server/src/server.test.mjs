import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { issueBody, Reports, readForm, safeName } from "./reports.mjs";
import { Rooms, validRoom } from "./rooms.mjs";
import { hashToken, newInvite, TesterStore } from "./testers.mjs";
import { turnCredentials } from "./turn.mjs";

const temp = () => mkdtempSync(join(tmpdir(), "red-line-server-"));

test("testers: invite, find by secret, re-invite voids the old link, revoke", () => {
  const store = new TesterStore(join(temp(), "testers.json"));
  const first = newInvite();
  store.upsert("Ana", first.hash);
  assert.equal(store.byToken(first.token)?.name, "Ana");
  assert.equal(store.byToken("short"), null);
  const second = newInvite();
  store.upsert("Ana", second.hash);
  assert.equal(store.byToken(first.token), null);
  assert.equal(store.all().length, 1);
  assert.equal(store.remove("Ana"), true);
  assert.equal(store.byToken(second.token), null);
  assert.equal(store.remove("Ana"), false);
  assert.equal(hashToken("x").length, 64);
});

test("rooms: relays to the others in the room only", () => {
  const rooms = new Rooms();
  const got = { a: [], b: [], c: [] };
  const peer = (key) => ({ send: (text) => got[key].push(text) });
  const [a, b, c] = [peer("a"), peer("b"), peer("c")];
  rooms.join("r1", a);
  rooms.join("r1", b);
  rooms.join("r2", c);
  rooms.relay("r1", a, "hi");
  assert.deepEqual(got, { a: [], b: ["hi"], c: [] });
  rooms.leave("r1", a);
  rooms.leave("r1", b);
  rooms.leave("r2", c);
  assert.equal(rooms.size, 0);
  assert.equal(validRoom("redline-AB12"), true);
  assert.equal(validRoom("../x"), false);
});

test("turn: credentials expire in the future and are signed", () => {
  const creds = turnCredentials("secret", "example.com", 1_000_000);
  assert.match(creds.username, /^22600:redline$/);
  assert.equal(creds.credential.length, 28);
  assert.equal(creds.urls[0], "turn:example.com:3479?transport=udp");
});

test("reports: validates, stores, queues without token, files later", async () => {
  const form = new FormData();
  form.append("title", "Tank stuck");
  form.append("description", "It does not move");
  form.append("screenshot", new Blob(["img"], { type: "image/jpeg" }), "a b.jpg");
  const parsed = readForm(form);
  assert.equal(parsed.kind, "bug");
  assert.equal(readForm(new FormData()).error, "empty");
  assert.equal(safeName(".."), "file");
  assert.equal(safeName("../x"), ".._x");

  const dataDir = temp();
  const calls = [];
  const env = {
    dataDir,
    publicUrl: "https://srv",
    repo: "o/r",
    githubToken: "",
    projectId: "",
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ number: 7, html_url: "https://gh/7" }));
    },
  };
  const reports = new Reports(env);
  const folder = await reports.store("Ana", parsed);
  assert.equal(await reports.file(folder), null);
  assert.deepEqual(await reports.pending(), [folder]);

  env.githubToken = "t";
  await reports.retryPending();
  assert.deepEqual(await reports.pending(), []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/repos/o/r/issues");
  assert.match(calls[0].body.body, /!\[screenshot\]\(https:\/\/srv\/files\/.*\/0-a_b\.jpg\)/);
  assert.deepEqual(calls[0].body.labels, ["bug", "tester-report"]);
  const stored = JSON.parse(
    readFileSync(join(dataDir, "reports", folder, "report.json"), "utf8"),
  );
  assert.deepEqual(stored.filed, { number: 7, url: "https://gh/7" });
  assert.match(issueBody("Ana", "d", {}, []), /\*\*Reporter:\*\* Ana/);
});
