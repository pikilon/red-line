/** Tester accounts and report submission against Supabase (spec 47). Plain
 *  `fetch` against the Auth REST API and the `report` Edge Function, so the
 *  client needs no SDK. */

/** Public project settings; the anon key is meant to ship in the client. */
export const SUPABASE_URL: string = "https://uuoqsligbiiwkktovznu.supabase.co";
export const SUPABASE_ANON_KEY: string =
  "sb_publishable_4_gDq07hwapHIwnw3y1DFA_pH3Yg4_k";

/** Whether the report backend is configured (spec 47 §4). */
export function reportsEnabled(): boolean {
  return SUPABASE_URL !== "" && SUPABASE_ANON_KEY !== "";
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Epoch seconds. */
  expiresAt: number;
  email: string;
}

/** Failure codes the report page turns into messages. */
export type ReportError =
  | "not-tester"
  | "bad-login"
  | "signed-out"
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

const SESSION_KEY = "redline.report.session";

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.refreshToken !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.email !== "string"
    ) {
      return null;
    }
    return parsed as Session;
  } catch {
    return null;
  }
}

function storeSession(session: Session | null): void {
  try {
    if (session === null) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage blocked: the session lives until the tab closes.
  }
}

export function signOut(): void {
  storeSession(null);
}

interface AuthResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { email?: string };
  msg?: string;
  error_description?: string;
  message?: string;
}

async function auth(path: string, body: unknown): Promise<AuthResponse> {
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ReportApiError("network");
  }
  const data = (await response.json().catch(() => ({}))) as AuthResponse;
  if (!response.ok) {
    const text = `${data.msg ?? ""} ${data.error_description ?? ""} ${data.message ?? ""}`;
    if (/tester list|database error saving new user/i.test(text)) {
      throw new ReportApiError("not-tester");
    }
    throw new ReportApiError(path.startsWith("token") ? "bad-login" : "failed");
  }
  return data;
}

function toSession(data: AuthResponse, email: string): Session {
  if (data.access_token === undefined || data.refresh_token === undefined) {
    throw new ReportApiError("failed");
  }
  const session: Session = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
    email: data.user?.email ?? email,
  };
  storeSession(session);
  return session;
}

/** Signs in, registering the account first when it does not exist yet. */
export async function signIn(
  email: string,
  password: string,
  register: boolean,
): Promise<Session> {
  const normalized = email.trim().toLowerCase();
  const data = register
    ? await auth("signup", { email: normalized, password })
    : await auth("token?grant_type=password", { email: normalized, password });
  return toSession(data, normalized);
}

/** A session whose access token is valid for at least one more minute. */
async function freshSession(): Promise<Session> {
  const session = loadSession();
  if (session === null) throw new ReportApiError("signed-out");
  if (session.expiresAt - 60 > Date.now() / 1000) return session;
  try {
    const data = await auth("token?grant_type=refresh_token", {
      refresh_token: session.refreshToken,
    });
    return toSession(data, session.email);
  } catch (error) {
    if (error instanceof ReportApiError && error.code === "network")
      throw error;
    signOut();
    throw new ReportApiError("signed-out");
  }
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
  const session = await freshSession();
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
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/report`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: form,
    });
  } catch {
    throw new ReportApiError("network");
  }
  const data = (await response.json().catch(() => ({}))) as {
    number?: number;
    url?: string;
    error?: string;
  };
  if (response.ok && data.number !== undefined && data.url !== undefined) {
    return { number: data.number, url: data.url };
  }
  if (response.status === 401) {
    signOut();
    throw new ReportApiError("signed-out");
  }
  if (data.error === "not-tester") throw new ReportApiError("not-tester");
  if (response.status === 413) throw new ReportApiError("too-large");
  throw new ReportApiError("failed");
}
