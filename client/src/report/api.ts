/** Tester invites and report submission against the Supabase `report` Edge
 *  Function (spec 47). Plain `fetch`, so the client needs no SDK. */

/** Public project settings; the publishable key is meant to ship. */
export const SUPABASE_URL: string = "https://uuoqsligbiiwkktovznu.supabase.co";
export const SUPABASE_ANON_KEY: string =
  "sb_publishable_4_gDq07hwapHIwnw3y1DFA_pH3Yg4_k";

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/report`;
const INVITE_KEY = "redline.report.invite";

/** Whether the report backend is configured (spec 47 §4). */
export function reportsEnabled(): boolean {
  return SUPABASE_URL !== "" && SUPABASE_ANON_KEY !== "";
}

/** Failure codes the report page turns into messages. */
export type ReportError =
  | "not-tester"
  | "no-invite"
  | "too-large"
  | "network"
  | "failed";

export class ReportApiError extends Error {
  readonly code: ReportError;
  constructor(code: ReportError) {
    super(code);
    this.code = code;
  }
}

export interface Invite {
  token: string;
  /** The tester's name once the backend confirmed it. */
  name: string | null;
}

export function loadInvite(): Invite | null {
  try {
    const raw = localStorage.getItem(INVITE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<Invite>;
    if (typeof parsed.token !== "string") return null;
    return {
      token: parsed.token,
      name: typeof parsed.name === "string" ? parsed.name : null,
    };
  } catch {
    return null;
  }
}

function storeInvite(invite: Invite | null): void {
  try {
    if (invite === null) localStorage.removeItem(INVITE_KEY);
    else localStorage.setItem(INVITE_KEY, JSON.stringify(invite));
  } catch {
    // Storage blocked: the invite is lost when the tab closes.
  }
}

export function forgetInvite(): void {
  storeInvite(null);
}

/** Takes `?invite=` off the URL and keeps it (spec 47 §3), so the rest of
 *  the boot never sees it and it never leaks into shared links. */
export function consumeInviteParam(): void {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("invite");
  if (token === null) return;
  url.searchParams.delete("invite");
  if (token !== "") storeInvite({ token, name: null });
  window.history.replaceState(window.history.state, "", url.toString());
}

function headers(invite: Invite): Record<string, string> {
  return { apikey: SUPABASE_ANON_KEY, "x-tester-token": invite.token };
}

async function call(init: RequestInit): Promise<Response> {
  try {
    return await fetch(FUNCTION_URL, init);
  } catch {
    throw new ReportApiError("network");
  }
}

/** The stored invite's tester name, asking the backend the first time. */
export async function whoAmI(): Promise<string> {
  const invite = loadInvite();
  if (invite === null) throw new ReportApiError("no-invite");
  if (invite.name !== null) return invite.name;
  const response = await call({ method: "GET", headers: headers(invite) });
  const data = (await response.json().catch(() => ({}))) as { name?: string };
  if (response.status === 403) {
    forgetInvite();
    throw new ReportApiError("not-tester");
  }
  if (!response.ok || data.name === undefined) {
    throw new ReportApiError("failed");
  }
  storeInvite({ token: invite.token, name: data.name });
  return data.name;
}

export interface ReportDraft {
  kind: "bug" | "feature";
  title: string;
  description: string;
  context: Record<string, unknown>;
  screenshot: Blob | null;
  save: string | null;
  attachments: readonly File[];
}

/** Sends a report; resolves with the created issue (spec 47 §5). */
export async function submitReport(
  draft: ReportDraft,
): Promise<{ number: number; url: string }> {
  const invite = loadInvite();
  if (invite === null) throw new ReportApiError("no-invite");
  const form = new FormData();
  form.append("kind", draft.kind);
  form.append("title", draft.title);
  form.append("description", draft.description);
  form.append("context", JSON.stringify(draft.context));
  if (draft.screenshot !== null) {
    form.append("screenshot", draft.screenshot, "screenshot.jpg");
  }
  if (draft.save !== null) {
    form.append(
      "save",
      new Blob([draft.save], { type: "application/json" }),
      "save.json",
    );
  }
  for (const file of draft.attachments) form.append("attachment", file);
  const response = await call({
    method: "POST",
    headers: headers(invite),
    body: form,
  });
  const data = (await response.json().catch(() => ({}))) as {
    number?: number;
    url?: string;
  };
  if (response.ok && data.number !== undefined && data.url !== undefined) {
    return { number: data.number, url: data.url };
  }
  if (response.status === 403) {
    forgetInvite();
    throw new ReportApiError("not-tester");
  }
  if (response.status === 413) throw new ReportApiError("too-large");
  throw new ReportApiError("failed");
}
