// Tester report → GitHub issue (specs/47-tester-reports.md). Testers are
// identified by the secret in their invite link (header `x-tester-token`).
import { createClient } from "jsr:@supabase/supabase-js@2";

const REPO = Deno.env.get("GITHUB_REPO") ?? "pikilon/red-line";
const MAX_FILES = 10; // 8 attachments + screenshot + save
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 20_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-tester-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

async function testerFor(token: string): Promise<{ name: string } | null> {
  if (token.length < 16) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const { data } = await admin
    .from("testers")
    .select("name")
    .eq("token_hash", hash)
    .maybeSingle();
  return data;
}

function safeName(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, "_").slice(-80);
  return cleaned === "" ? "file" : cleaned;
}

async function github(path: string, init: RequestInit): Promise<Response> {
  return await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${Deno.env.get("GITHUB_TOKEN") ?? ""}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "red-line-tester-reports",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const tester = await testerFor(req.headers.get("x-tester-token") ?? "");
  if (tester === null) return json(403, { error: "not-tester" });
  // GET tells the game who the invite belongs to.
  if (req.method === "GET") return json(200, { name: tester.name });
  if (req.method !== "POST") return json(405, { error: "method" });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: "bad-form" });
  }
  const kind = form.get("kind") === "feature" ? "feature" : "bug";
  const title = String(form.get("title") ?? "")
    .trim()
    .slice(0, MAX_TITLE);
  const description = String(form.get("description") ?? "")
    .trim()
    .slice(0, MAX_DESCRIPTION);
  if (title === "" || description === "") return json(400, { error: "empty" });
  let context: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(form.get("context") ?? "{}"));
    if (parsed !== null && typeof parsed === "object") context = parsed;
  } catch {
    // Context is best effort.
  }

  const files: Array<{ role: string; file: File }> = [];
  for (const [field, value] of form.entries()) {
    if (!(value instanceof File)) continue;
    if (!["screenshot", "save", "attachment"].includes(field)) continue;
    if (value.size > MAX_BYTES) return json(413, { error: "too-large" });
    files.push({ role: field, file: value });
  }
  if (files.length > MAX_FILES) return json(413, { error: "too-many" });

  const folder = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}`;
  const uploaded: Array<{ role: string; name: string; url: string; image: boolean }> = [];
  for (const { role, file } of files) {
    const name = role === "save" ? "save.json" : safeName(file.name);
    const path = `${folder}/${uploaded.length}-${name}`;
    const { error } = await admin.storage.from("reports").upload(path, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (error !== null) return json(500, { error: "upload", detail: error.message });
    const url = admin.storage.from("reports").getPublicUrl(path).data.publicUrl;
    uploaded.push({ role, name, url, image: file.type.startsWith("image/") });
  }

  const lines: string[] = [`**Reporter:** ${tester.name}`, "", description, ""];
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

  const created = await github(`/repos/${REPO}/issues`, {
    method: "POST",
    body: JSON.stringify({
      title,
      body: lines.join("\n"),
      labels: [kind === "bug" ? "bug" : "enhancement", "tester-report"],
    }),
  });
  if (!created.ok) {
    return json(502, { error: "github", detail: await created.text() });
  }
  const issue = (await created.json()) as {
    number: number;
    html_url: string;
    node_id: string;
  };

  const projectId = Deno.env.get("GITHUB_PROJECT_ID");
  if (projectId !== undefined && projectId !== "") {
    // Best effort: the issue exists even if the board call fails.
    await github("/graphql", {
      method: "POST",
      body: JSON.stringify({
        query:
          "mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}",
        variables: { p: projectId, c: issue.node_id },
      }),
    }).catch(() => undefined);
  }

  return json(200, { number: issue.number, url: issue.html_url });
});
