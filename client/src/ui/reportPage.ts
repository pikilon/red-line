import { type MessageKey, t } from "../i18n";
import {
  loadSession,
  ReportApiError,
  type ReportDraft,
  signIn,
  signOut,
  submitReport,
} from "../report/api";

/** What the match hands the report page when it opens (spec 47 §4). */
export interface ReportCapture {
  screenshot: Blob | null;
  save: string | null;
  context: Record<string, unknown>;
}

export interface ReportPageDeps {
  /** Grabs the screenshot, match save and context. */
  capture(): Promise<ReportCapture>;
  /** Network calls; tests replace them. */
  signIn?: typeof signIn;
  submit?: (draft: ReportDraft) => Promise<{ number: number; url: string }>;
}

export interface ReportPage {
  /** `#game-menu-report`, a page of the game menu. */
  readonly page: HTMLElement;
  /** Called when the page is shown: captures the match and resets the form. */
  open(): void;
}

const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  id: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.id = id;
  if (text !== undefined) element.textContent = text;
  return element;
}

function errorText(error: unknown): string {
  const code = error instanceof ReportApiError ? error.code : "failed";
  return t(`report.error.${code}` as MessageKey);
}

/** The Report page of the Esc menu (spec 47). */
export function createReportPage(deps: ReportPageDeps): ReportPage {
  const doSignIn = deps.signIn ?? signIn;
  const doSubmit = deps.submit ?? submitReport;
  const page = el("div", "game-menu-report");
  page.className = "game-menu-page";
  // Typing in the form must not fire game hotkeys (spec 47 §4).
  for (const type of ["keydown", "keyup", "keypress"] as const) {
    page.addEventListener(type, (event) => {
      if ((event as KeyboardEvent).key !== "Escape") event.stopPropagation();
    });
  }

  const status = el("p", "report-status");
  status.setAttribute("role", "status");

  // Signed-out view.
  const loginView = el("div", "report-login");
  const email = el("input", "report-email");
  email.type = "email";
  email.autocomplete = "email";
  email.placeholder = t("report.email");
  const password = el("input", "report-password");
  password.type = "password";
  password.autocomplete = "current-password";
  password.placeholder = t("report.password");
  const signInButton = el("button", "report-sign-in", t("report.signIn"));
  const registerButton = el("button", "report-register", t("report.register"));
  loginView.append(
    el("p", "report-login-hint", t("report.loginHint")),
    email,
    password,
    signInButton,
    registerButton,
  );

  // Form view.
  const formView = el("div", "report-form");
  const who = el("p", "report-who");
  const signOutButton = el("button", "report-sign-out", t("report.signOut"));
  const kind = el("select", "report-kind");
  for (const value of ["bug", "feature"] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = t(
      value === "bug" ? "report.kindBug" : "report.kindFeature",
    );
    kind.appendChild(option);
  }
  const title = el("input", "report-title");
  title.placeholder = t("report.title");
  title.maxLength = 200;
  const description = el("textarea", "report-description");
  description.placeholder = t("report.description");
  description.rows = 5;
  const files = el("input", "report-files");
  files.type = "file";
  files.multiple = true;
  const filesLabel = el("label", "report-files-label", t("report.files"));
  filesLabel.htmlFor = files.id;
  const checkbox = (id: string, label: string): HTMLInputElement => {
    const input = el("input", id);
    input.type = "checkbox";
    input.checked = true;
    const wrap = el("label", `${id}-label`);
    wrap.append(input, ` ${label}`);
    formView.appendChild(wrap);
    return input;
  };
  const sendButton = el("button", "report-send", t("report.send"));
  formView.append(
    who,
    signOutButton,
    kind,
    title,
    description,
    filesLabel,
    files,
  );
  const withScreenshot = checkbox(
    "report-with-screenshot",
    t("report.withScreenshot"),
  );
  const withSave = checkbox("report-with-save", t("report.withSave"));
  formView.appendChild(sendButton);

  // Sent view.
  const doneView = el("div", "report-done");
  const doneLink = el("a", "report-done-link");
  doneLink.target = "_blank";
  doneLink.rel = "noopener";
  const anotherButton = el("button", "report-another", t("report.another"));
  doneView.append(doneLink, anotherButton);

  const heading = el("h3", "report-heading", t("report.heading"));
  page.append(heading, loginView, formView, doneView, status);

  let capture: Promise<ReportCapture> | null = null;
  let busy = false;

  function show(view: "login" | "form" | "done"): void {
    loginView.hidden = view !== "login";
    formView.hidden = view !== "form";
    doneView.hidden = view !== "done";
    const session = loadSession();
    who.textContent =
      session === null ? "" : t("report.signedInAs", { email: session.email });
  }

  function setBusy(value: boolean): void {
    busy = value;
    for (const button of [signInButton, registerButton, sendButton]) {
      button.disabled = value;
    }
  }

  async function login(register: boolean): Promise<void> {
    if (busy) return;
    if (email.value.trim() === "" || password.value.length < 6) {
      status.textContent = t("report.error.credentials");
      return;
    }
    setBusy(true);
    status.textContent = t("report.signingIn");
    try {
      await doSignIn(email.value, password.value, register);
      password.value = "";
      status.textContent = "";
      show("form");
    } catch (error) {
      status.textContent = errorText(error);
    } finally {
      setBusy(false);
    }
  }

  async function send(): Promise<void> {
    if (busy) return;
    if (title.value.trim() === "" || description.value.trim() === "") {
      status.textContent = t("report.error.empty");
      return;
    }
    const attachments = [...(files.files ?? [])];
    if (
      attachments.length > MAX_ATTACHMENTS ||
      attachments.some((file) => file.size > MAX_ATTACHMENT_BYTES)
    ) {
      status.textContent = t("report.error.too-large");
      return;
    }
    setBusy(true);
    status.textContent = t("report.sending");
    try {
      const captured = await (capture ?? deps.capture());
      const issue = await doSubmit({
        kind: kind.value === "feature" ? "feature" : "bug",
        title: title.value.trim(),
        description: description.value.trim(),
        context: captured.context,
        screenshot: withScreenshot.checked ? captured.screenshot : null,
        save: withSave.checked ? captured.save : null,
        attachments,
      });
      title.value = "";
      description.value = "";
      files.value = "";
      doneLink.href = issue.url;
      doneLink.textContent = t("report.sent", { number: issue.number });
      status.textContent = "";
      show("done");
    } catch (error) {
      status.textContent = errorText(error);
      if (error instanceof ReportApiError && error.code === "signed-out") {
        show("login");
      }
    } finally {
      setBusy(false);
    }
  }

  signInButton.addEventListener("click", () => void login(false));
  registerButton.addEventListener("click", () => void login(true));
  sendButton.addEventListener("click", () => void send());
  signOutButton.addEventListener("click", () => {
    signOut();
    show("login");
  });
  anotherButton.addEventListener("click", () => show("form"));
  // Pasted images become attachments, like files picked by hand (spec 47 §4).
  formView.addEventListener("paste", (event) => {
    const pasted = [...(event.clipboardData?.files ?? [])].filter((file) =>
      file.type.startsWith("image/"),
    );
    if (pasted.length === 0) return;
    event.preventDefault();
    const merged = new DataTransfer();
    for (const file of files.files ?? []) merged.items.add(file);
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    pasted.forEach((file, index) => {
      const extension = file.type.split("/")[1] ?? "png";
      merged.items.add(
        new File([file], `pasted-${stamp}-${index + 1}.${extension}`, {
          type: file.type,
        }),
      );
    });
    files.files = merged.files;
    status.textContent = t("report.pasted", { count: merged.files.length });
  });

  return {
    page,
    open() {
      capture = deps.capture();
      // A failed capture still lets the tester send the text.
      capture = capture.catch(() => ({
        screenshot: null,
        save: null,
        context: {},
      }));
      status.textContent = "";
      show(loadSession() === null ? "login" : "form");
    },
  };
}
