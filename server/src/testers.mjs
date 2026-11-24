// Invited testers (specs/47-tester-reports.md §3). A JSON file on the data
// volume: one entry per tester with the SHA-256 of their invite secret.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function newInvite() {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function cleanName(raw) {
  const name = String(raw ?? "").trim();
  if (name === "" || name.length > 60) {
    throw new Error('give a name of 1-60 characters, e.g. "Juan"');
  }
  return name;
}

export class TesterStore {
  constructor(path) {
    this.path = path;
  }

  all() {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  #write(rows) {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(rows, null, 2)}\n`);
    renameSync(tmp, this.path);
  }

  /** The tester whose invite secret is `token`, or null. */
  byToken(token) {
    if (typeof token !== "string" || token.length < 16) return null;
    const hash = hashToken(token);
    return this.all().find((row) => row.token_hash === hash) ?? null;
  }

  /** Adds or re-invites `name` with `hash`; an old link stops working. */
  upsert(name, hash, addedAt = new Date().toISOString()) {
    const rows = this.all().filter((row) => row.name !== name);
    rows.push({ name, token_hash: hash, added_at: addedAt });
    this.#write(rows);
  }

  remove(name) {
    const rows = this.all();
    const kept = rows.filter((row) => row.name !== name);
    if (kept.length === rows.length) return false;
    this.#write(kept);
    return true;
  }
}
