// Tester report → files on disk + GitHub issue (specs/47-tester-reports.md).
// Every report is kept in its own folder with a `report.json`; a report whose
// issue could not be created yet (no token, GitHub down) stays pending and
// is retried until it goes through.
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const MAX_FILES = 10; // 8 attachments + screenshot + save
export const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 20_000;

export function safeName(name) {
  const cleaned = String(name).replace(/[^\w.-]+/g, "_").slice(-80);
  return cleaned === "" || /^\.+$/.test(cleaned) ? "file" : cleaned;
}

/** Validates a parsed form; returns { error } or the report fields. */
export function readForm(form) {
  const kind = form.get("kind") === "feature" ? "feature" : "bug";
  const title = String(form.get("title") ?? "")
    .trim()
    .slice(0, MAX_TITLE);
  const description = String(form.get("description") ?? "")
    .trim()
    .slice(0, MAX_DESCRIPTION);
  if (title === "" || description === "") return { error: "empty", status: 400 };
  let context = {};
  try {
    const parsed = JSON.parse(String(form.get("context") ?? "{}"));
    if (parsed !== null && typeof parsed === "object") context = parsed;
  } catch {
    // Context is best effort.
  }
  const files = [];
  for (const [field, value] of form.entries()) {
    if (typeof value === "string") continue;
    if (!["screenshot", "save", "attachment"].includes(field)) continue;
    if (value.size > MAX_BYTES) return { error: "too-large", status: 413 };
    files.push({ role: field, file: value });
  }
  if (files.length > MAX_FILES) return { error: "too-many", status: 413 };
  return { kind, title, description, context, files };
}

export function issueBody(reporter, description, context, uploaded) {
  const lines = [`**Reporter:** ${reporter}`, "", description, ""];
  const screenshot = uploaded.find((u) => u.role === "screenshot");
  if (screenshot !== undefined) {
    lines.push("## Screenshot", "", `![screenshot](${screenshot.url})`, "");
  }
  const attachments = uploaded.filter((u) => u.role === "attachment");
  if (attachments.length > 0) {
    lines.push("## Attachments", "");
    for (const a of attachments) {
      lines.push(a.image ? `![${a.name}](${a.url})` : `- [${a.name}](${a.url})`);
    }
    lines.push("");
  }
  const save = uploaded.find((u) => u.role === "save");
  if (save !== undefined) {
    lines.push(
      "## Match save",
      "",
      `[save.json](${save.url}) — download it, run \`node --run saves:import -- save.json <id>\` and open \`?load=<id>\`.`,
      "",
    );
  }
  lines.push(
    "## Context",
    "",
    "```json",
    JSON.stringify(context, null, 2),
    "```",
    "",
    "_Sent from the in-game report (spec 47)._",
  );
  return lines.join("\n");
}

async function writeJson(path, value) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, path);
}

export class Reports {
  /** `env`: { dataDir, publicUrl, repo, githubToken, projectId, fetch } */
  constructor(env) {
    this.env = env;
    this.root = join(env.dataDir, "reports");
  }

  /** Stores the files and the issue draft; returns the folder. */
  async store(reporter, report) {
    const folder = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;
    const dir = join(this.root, folder);
    await mkdir(dir, { recursive: true });
    const uploaded = [];
    for (const { role, file } of report.files) {
      const name = role === "save" ? "save.json" : safeName(file.name);
      const stored = `${uploaded.length}-${name}`;
      await writeFile(join(dir, stored), Buffer.from(await file.arrayBuffer()));
      uploaded.push({
        role,
        name,
        url: `${this.env.publicUrl}/files/${folder}/${stored}`,
        image: String(file.type).startsWith("image/"),
      });
    }
    await writeJson(join(dir, "report.json"), {
      created_at: new Date().toISOString(),
      reporter,
      issue: {
        title: report.title,
        body: issueBody(reporter, report.description, report.context, uploaded),
        labels: [report.kind === "bug" ? "bug" : "enhancement", "tester-report"],
      },
      filed: null,
    });
    return folder;
  }

  /** Creates the GitHub issue for a stored report; null when it can't yet. */
  async file(folder) {
    const path = join(this.root, folder, "report.json");
    const record = JSON.parse(await readFile(path, "utf8"));
    if (record.filed !== null) return record.filed;
    const token = this.env.githubToken;
    if (!token) return null;
    const call = (url, body) =>
      this.env.fetch(`https://api.github.com${url}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "red-line-tester-reports",
        },
        body: JSON.stringify(body),
      });
    let created;
    try {
      created = await call(`/repos/${this.env.repo}/issues`, record.issue);
    } catch {
      return null;
    }
    if (!created.ok) {
      console.error(`github ${created.status}: ${await created.text()}`);
      return null;
    }
    const issue = await created.json();
    record.filed = { number: issue.number, url: issue.html_url };
    await writeJson(path, record);
    if (this.env.projectId) {
      // Best effort: the issue exists even if the board call fails.
      await call("/graphql", {
        query:
          "mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}",
        variables: { p: this.env.projectId, c: issue.node_id },
      }).catch(() => undefined);
    }
    return record.filed;
  }

  /** Folders whose issue is still missing, oldest first. */
  async pending() {
    const out = [];
    let days = [];
    try {
      days = (await readdir(this.root)).sort();
    } catch {
      return out;
    }
    for (const day of days) {
      for (const id of await readdir(join(this.root, day)).catch(() => [])) {
        try {
          const record = JSON.parse(
            await readFile(join(this.root, day, id, "report.json"), "utf8"),
          );
          if (record.filed === null) out.push(`${day}/${id}`);
        } catch {
          // Half-written folder: ignore.
        }
      }
    }
    return out;
  }

  async retryPending() {
    for (const folder of await this.pending()) {
      if ((await this.file(folder)) === null) return;
    }
  }
}
