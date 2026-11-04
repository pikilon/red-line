// Tester invite links for the in-game report (specs/47-tester-reports.md §3).
//
//   node --run testers:invite -- "Name"   adds a tester and prints the link
//   node --run testers:list               lists invited testers
//   node --run testers:revoke -- "Name"   removes a tester; the link stops working
//
// Uses the Supabase CLI session on this machine (`supabase login`) and the
// project linked in `supabase/` (`supabase link`).
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const GAME_URL = "https://red-line.pikilon.com/";

/** A tester name as an SQL string literal. */
export function sqlString(text) {
  return `'${text.replaceAll("'", "''")}'`;
}

/** A fresh invite secret and the hash the database keeps. */
export function newInvite() {
  const token = randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

export function inviteUrl(token) {
  return `${GAME_URL}?invite=${token}`;
}

function query(root, sql) {
  const result = spawnSync(
    "supabase",
    ["db", "query", "--remote", "--yes", "-o", "json", sql],
    { cwd: root, encoding: "utf8" },
  );
  if (result.error !== undefined) {
    throw new Error(`supabase CLI not found: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout).trim());
  }
  const start = result.stdout.indexOf("{");
  const parsed = JSON.parse(result.stdout.slice(start));
  return parsed.rows ?? [];
}

function cleanName(raw) {
  const name = (raw ?? "").trim();
  if (name === "" || name.length > 60) {
    throw new Error('give a name of 1-60 characters, e.g. -- "Juan"');
  }
  return name;
}

function main(root, [command, ...args]) {
  if (command === "invite") {
    const name = cleanName(args[0]);
    const { token, hash } = newInvite();
    // Inviting an existing tester again issues a new link and voids the old one.
    query(
      root,
      `insert into public.testers (name, token_hash) values (${sqlString(name)}, ${sqlString(hash)})
       on conflict (name) do update set token_hash = excluded.token_hash, added_at = now();`,
    );
    console.log(`Invite link for ${name} (send it privately):\n${inviteUrl(token)}`);
    return;
  }
  if (command === "list") {
    const rows = query(
      root,
      "select name, added_at from public.testers order by added_at;",
    );
    if (rows.length === 0) console.log("No testers yet.");
    for (const row of rows) {
      console.log(`${row.name}  (invited ${String(row.added_at).slice(0, 10)})`);
    }
    return;
  }
  if (command === "revoke") {
    const name = cleanName(args[0]);
    const rows = query(
      root,
      `delete from public.testers where name = ${sqlString(name)} returning name;`,
    );
    console.log(
      rows.length === 0 ? `No tester named ${name}.` : `Revoked ${name}.`,
    );
    return;
  }
  throw new Error("usage: testers.mjs invite <name> | list | revoke <name>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    main(root, process.argv.slice(2));
  } catch (error) {
    console.error(`testers: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
