/**
 * Real delivery of the mail lab's mails, to one inbox you choose.
 *
 *   pnpm mail:send --to you@example.com             dry run: lists what would be sent
 *   pnpm mail:send --to you@example.com --send      sends one of each kind through Resend
 *   pnpm mail:send --to you@example.com --lang en   the owner mails as an owner who chose English gets them
 *
 * It first runs the mail lab itself into out/mail-send with links to
 * https://vidalo.io (MAIL_LAB_BASE_URL), so the links in the inbox open the
 * real site, and refuses any mail that still links to localhost. The lab's
 * test businesses do not exist on vidalo.io, so their report and
 * unsubscribe links land on the not-found or invalid-link page.
 *
 * Every mail goes to --to and nowhere else: the owner and third-party
 * addresses in the lab are replaced, so a directory or a website never gets
 * a test. The subject says it is a test and of which kind; the original
 * recipient is in the X-Vidalo-Original-To header. Goes through sendMail, the
 * same code path as production, so From, Reply-To and List-Unsubscribe are
 * what a customer would get.
 *
 * Needs RESEND_API_KEY and a verified sending domain for EMAIL_FROM (default
 * controle@vidalo.io), from the environment or the root .env. Not covered:
 * the sign-in link, which Supabase sends itself (docs/mail-lab.md).
 */
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const to = value("--to");
const send = flag("--send");
const only = value("--kinds")?.split(",").map((s) => s.trim());
// The lab writes every owner mail in Dutch and in English; letters to third parties are Dutch either way.
const lang = value("--lang") ?? "nl";
if (lang !== "nl" && lang !== "en") {
  console.error("--lang takes nl or en.");
  process.exit(2);
}

if (!to || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) {
  console.error("Usage: pnpm mail:send --to you@example.com [--send] [--lang nl|en] [--kinds welcome,baseline]\n--to takes exactly one address.");
  process.exit(2);
}
try {
  process.loadEnvFile(path.resolve(".env"));
} catch {
  // no root .env: the environment has to carry RESEND_API_KEY
}
// sendMail only uses Resend outside mock mode.
delete process.env.VIDALO_MOCK;

const site = process.env.MAIL_LAB_BASE_URL ?? "https://vidalo.io";
const labDir = path.resolve("out/mail-send");
console.log(`Building the mails (mail lab, links to ${site}) …`);
try {
  execFileSync("pnpm", ["-s", "mail:lab"], { env: { ...process.env, VIDALO_MOCK: "1", RESEND_API_KEY: "", MAIL_LAB_DIR: labDir, MAIL_LAB_BASE_URL: site }, stdio: ["ignore", "ignore", "inherit"] });
} catch {
  console.error("The mail lab failed; fix that first (pnpm mail:lab). Nothing sent.");
  process.exit(1);
}
const dir = path.join(labDir, "mail");
const files = await readdir(dir).catch(() => null);
if (!files?.length) {
  console.error(`No lab mails in ${dir}. Nothing sent.`);
  process.exit(2);
}

type LabMail = { kind: string; lang: string | null; originalTo: string; subject: string; text: string; html?: string; headers: Record<string, string> };
function parse(raw: string): LabMail {
  const [head, ...rest] = raw.split("\r\n\r\n");
  const h: Record<string, string> = {};
  for (const line of head!.split("\r\n")) {
    const i = line.indexOf(":");
    if (i > 0) h[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  const body = rest.join("\r\n\r\n");
  const boundary = /boundary="([^"]+)"/.exec(h["Content-Type"] ?? "")?.[1];
  let text = body;
  let html: string | undefined;
  if (boundary) {
    for (const part of body.split(`--${boundary}`)) {
      const [ph, ...pb] = part.replace(/^\r\n/, "").split("\r\n\r\n");
      const content = pb.join("\r\n\r\n").replace(/\r\n$/, "");
      if (/text\/plain/.test(ph ?? "")) text = content;
      if (/text\/html/.test(ph ?? "")) html = content;
    }
  }
  const headers: Record<string, string> = {};
  for (const k of ["List-Unsubscribe", "List-Unsubscribe-Post"]) if (h[k]) headers[k] = h[k]!;
  return { kind: h["X-Vidalo-type"] ?? h["X-Vidalo-kind"] ?? "unknown", lang: h["X-Vidalo-lang"] ?? null, originalTo: h.To ?? "", subject: h.Subject ?? "", text, html, headers };
}

// One mail per kind: the first the lab produced, in --lang (owner mails carry their language as a tag).
const byKind = new Map<string, LabMail>();
for (const f of files.sort()) {
  const m = parse(await readFile(path.join(dir, f), "utf8"));
  if (m.lang && m.lang !== lang) continue;
  if (!byKind.has(m.kind) && (!only || only.includes(m.kind))) byKind.set(m.kind, m);
}
// A test mail with links to this machine is useless in an inbox (23 Oct 2026).
const local = [...byKind].filter(([, m]) => /https?:\/\/(localhost|127\.0\.0\.1)\b/.test(`${m.text}\n${m.html ?? ""}\n${m.headers["List-Unsubscribe"] ?? ""}`));
if (local.length) {
  console.error(`Links to localhost in: ${local.map(([k]) => k).join(", ")}. Nothing sent.`);
  process.exit(1);
}

const { sendMail, defaultFrom } = await import("@vidalo/core/reporter");
console.log(`${send ? "Sending" : "Dry run:"} ${byKind.size} mails from ${defaultFrom()} to ${to}${send ? "" : " (add --send to send)"}`);
if (send && !process.env.RESEND_API_KEY) {
  console.error("RESEND_API_KEY is not set (environment or root .env). Nothing sent.");
  process.exit(2);
}

let failed = 0;
for (const [kind, m] of byKind) {
  const subject = `[Test ${kind}${m.lang ? ` ${m.lang}` : ""}] ${m.subject}`;
  if (!send) {
    console.log(`  - ${kind.padEnd(22)} ${subject}   (lab recipient: ${m.originalTo})`);
    continue;
  }
  try {
    const r = await sendMail({ to, subject, text: m.text, html: m.html, headers: { ...m.headers, "X-Vidalo-Original-To": m.originalTo }, tags: { kind, test: "mail-send" } });
    console.log(`  ✓ ${kind.padEnd(22)} ${r.mode} ${r.id}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${kind.padEnd(22)} ${(err as Error).message}`);
  }
  // Resend allows a few requests per second.
  await new Promise((r) => setTimeout(r, 600));
}
console.log("Not covered here: the sign-in link. Supabase sends it; see docs/mail-lab.md.");
process.exit(failed ? 1 : 0);
