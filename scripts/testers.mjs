// Tester invite links for the in-game report (specs/47-tester-reports.md §3).
//
//   node --run testers:invite -- "Name"   adds a tester and prints the link
//   node --run testers:list               lists invited testers
//   node --run testers:revoke -- "Name"   removes a tester; the link stops working
//
// Talks to the red-line server on the owner's VPS over SSH (this machine's
// key must be authorized for root there, see scripts/deploy-server.mjs).
// Only the SHA-256 of the secret leaves this machine.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

export const GAME_URL = "https://red-line.pikilon.com/";
const VPS = "root@69.62.106.16";
const CONTAINER = "red-line-server-1";

/** A fresh invite secret and the hash the server keeps. */
export function newInvite() {
  const token = randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

export function inviteUrl(token) {
  return `${GAME_URL}?invite=${token}`;
}

/** A single-quoted shell word, for the remote command line. */
export function shellWord(text) {
  return `'${String(text).replaceAll("'", "'\\''")}'`;
}

function admin(args) {
  const remote = ["docker", "exec", CONTAINER, "node", "src/admin.mjs", ...args]
    .map(shellWord)
    .join(" ");
  const result = spawnSync("ssh", [VPS, remote], { encoding: "utf8" });
  if (result.error !== undefined) {
    throw new Error(`ssh not found: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout).trim());
  }
  return result.stdout.trim();
}

function cleanName(raw) {
  const name = (raw ?? "").trim();
  if (name === "" || name.length > 60) {
    throw new Error('give a name of 1-60 characters, e.g. -- "Juan"');
  }
  return name;
}

function main([command, ...args]) {
  if (command === "invite") {
    const name = cleanName(args[0]);
    const { token, hash } = newInvite();
    // Inviting an existing tester again issues a new link and voids the old one.
    admin(["upsert", name, hash]);
    console.log(`Invite link for ${name} (send it privately):\n${inviteUrl(token)}`);
    return;
  }
  if (command === "list") {
    const rows = JSON.parse(admin(["list"]));
    if (rows.length === 0) console.log("No testers yet.");
    for (const row of rows) {
      console.log(`${row.name}  (invited ${String(row.added_at).slice(0, 10)})`);
    }
    return;
  }
  if (command === "revoke") {
    const name = cleanName(args[0]);
    const removed = admin(["revoke", name]) === "removed";
    console.log(removed ? `Revoked ${name}.` : `No tester named ${name}.`);
    return;
  }
  throw new Error("usage: testers.mjs invite <name> | list | revoke <name>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`testers: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
