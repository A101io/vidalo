/**
 * sendMail: Resend when RESEND_API_KEY is set and VIDALO_MOCK != 1;
 * otherwise an .eml file in out/mail/ plus a log line.
 *
 * Every mail goes out branded: a caller without HTML gets the text in the
 * brand's shell (textToHtml), and the logo that shell shows is attached inline.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { log } from "../shared/log.js";
import { LOGO } from "./logo.js";
import { textToHtml } from "./templates.js";

export interface MailInput {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  from?: string;
  /** free-form headers for threading (In-Reply-To etc.) */
  headers?: Record<string, string>;
  tags?: Record<string, string>;
}

export interface MailResult {
  id: string;
  mode: "resend" | "mock";
  file?: string;
}

export function defaultFrom(): string {
  return process.env.EMAIL_FROM || "Vidalo <controle@vidalo.io>";
}

function useResend(): boolean {
  return Boolean(process.env.RESEND_API_KEY) && process.env.VIDALO_MOCK !== "1";
}

function safeName(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60).toLowerCase();
}

/** The logo as an inline attachment, for HTML that shows it via cid:. */
function logoAttachments(html: string | undefined): { filename: string; content: string; content_id: string }[] {
  return html?.includes(`cid:${LOGO.contentId}`) ? [{ filename: LOGO.filename, content: LOGO.base64, content_id: LOGO.contentId }] : [];
}

export function toEml(input: MailInput, id: string): string {
  const to = Array.isArray(input.to) ? input.to.join(", ") : input.to;
  const date = new Date().toUTCString();
  const headers = [
    `From: ${input.from ?? defaultFrom()}`,
    `To: ${to}`,
    input.replyTo ? `Reply-To: ${input.replyTo}` : null,
    `Subject: ${input.subject}`,
    `Date: ${date}`,
    `Message-ID: <${id}@vidalo.io>`,
    "MIME-Version: 1.0",
    ...Object.entries(input.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
  ].filter(Boolean);
  if (input.html) {
    const boundary = `----vidalo-${id}`;
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      input.text,
      `--${boundary}`,
      ...htmlPart(input.html, id),
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }
  return [...headers, "Content-Type: text/plain; charset=utf-8", "", input.text, ""].join("\r\n");
}

/** The HTML part of an .eml; with the logo it becomes multipart/related so a mail client shows it. */
function htmlPart(html: string, id: string): string[] {
  const [logo] = logoAttachments(html);
  if (!logo) return ["Content-Type: text/html; charset=utf-8", "", html];
  const related = `----vidalo-related-${id}`;
  return [
    `Content-Type: multipart/related; boundary="${related}"`,
    "",
    `--${related}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    html,
    `--${related}`,
    `Content-Type: image/png; name="${logo.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-ID: <${logo.content_id}>`,
    `Content-Disposition: inline; filename="${logo.filename}"`,
    "",
    logo.content.replace(/.{76}/g, "$&\r\n"),
    `--${related}--`,
  ];
}

export async function sendMail(input: MailInput): Promise<MailResult> {
  const to = Array.isArray(input.to) ? input.to : [input.to];
  if (!to.length || to.some((t) => !t || !t.includes("@"))) throw new Error(`sendMail: invalid recipient ${JSON.stringify(input.to)}`);
  input = { ...input, html: input.html ?? textToHtml(input.text) };
  const attachments = logoAttachments(input.html);

  if (useResend()) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: input.from ?? defaultFrom(),
        to,
        subject: input.subject,
        text: input.text,
        html: input.html,
        reply_to: input.replyTo,
        headers: input.headers,
        tags: input.tags ? Object.entries(input.tags).map(([name, value]) => ({ name, value })) : undefined,
        attachments: attachments.length ? attachments : undefined,
      }),
    });
    if (!res.ok) throw new Error(`resend failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { id: string };
    log.info("mail.sent", { mode: "resend", id: body.id, to, subject: input.subject });
    return { id: body.id, mode: "resend" };
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.resolve(process.env.VIDALO_OUT_DIR ?? "out", "mail");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeName(input.subject)}.eml`);
  await writeFile(file, toEml(input, id), "utf8");
  log.info("mail.mock", { mode: "mock", file, to, subject: input.subject, replyTo: input.replyTo ?? null });
  return { id, mode: "mock", file };
}
