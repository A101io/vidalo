/**
 * The launch mail to the coming-soon list (go-live P8), once, on launch day.
 *
 *   pnpm launch:mail            dry run: reads the list, writes the plan and both mails to out/launch-mail/
 *   pnpm launch:mail --send     sends, one mail per address, from hello@vidalo.io
 *
 * --send needs RESEND_API_KEY and out/launch-mail/APPROVED holding the digest
 * the dry run printed (packages/core/src/reporter/launch.ts). A new sign-up
 * or a changed text after approval changes the digest, and nothing is sent.
 * Every address that went out is appended to out/launch-mail/sent.txt; a
 * second --send skips those, so an interrupted run never mails anyone twice.
 *
 * The tool never deletes the list. When every address is in sent.txt it
 * prints the statement to run by hand, as the privacy text promises.
 *
 * Reads DATABASE_URL (the hosted project) from the environment or the root .env.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const send = process.argv.includes("--send");
try {
  process.loadEnvFile(path.resolve(".env"));
} catch {
  // no root .env: the environment has to carry DATABASE_URL
}
// sendMail only uses Resend outside mock mode.
delete process.env.VIDALO_MOCK;
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (environment or root .env). Nothing read, nothing sent.");
  process.exit(2);
}

const { createDb } = await import("@vidalo/core/db");
const { sendMail, planLaunchMail, launchSendGate, LAUNCH_DELETE_SQL } = await import("@vidalo/core/reporter");

const site = process.env.PUBLIC_BASE_URL ?? "https://vidalo.io";
const from = "Vidalo <hello@vidalo.io>";
const dir = path.resolve("out/launch-mail");
await mkdir(dir, { recursive: true });

const db = createDb(process.env.DATABASE_URL, { max: 1 });
const rows = await db.listWaitlist().finally(() => db.close());
const plan = planLaunchMail(rows, site);
const count = (lang: string) => plan.recipients.filter((r) => r.language === lang).length;

for (const lang of ["nl", "en"] as const) {
  await writeFile(path.join(dir, `${lang}.txt`), `Subject: ${plan.mails[lang].subject}\n\n${plan.mails[lang].text}`);
  await writeFile(path.join(dir, `${lang}.html`), plan.mails[lang].html);
}
await writeFile(path.join(dir, "plan.txt"), `${plan.digest}\n${plan.recipients.length} addresses: ${count("nl")} nl, ${count("en")} en\nfrom ${from}, links to ${site}\n`);
console.log(`${plan.recipients.length} addresses on the list (${count("nl")} nl, ${count("en")} en). Mails from ${from}, links to ${site}.`);
console.log(`Read them: ${path.join(dir, "nl.html")} and ${path.join(dir, "en.html")}`);
console.log(`Digest: ${plan.digest}`);

if (!send) {
  console.log(`Dry run. To send: write the digest into ${path.join(dir, "APPROVED")}, then pnpm launch:mail --send`);
  process.exit(0);
}

const approved = await readFile(path.join(dir, "APPROVED"), "utf8").catch(() => null);
const gate = launchSendGate(plan, { resendKey: process.env.RESEND_API_KEY, approved });
if (!gate.ok) {
  console.error(`${gate.reason} Nothing sent.`);
  process.exit(2);
}

const sentFile = path.join(dir, "sent.txt");
const sent = new Set((await readFile(sentFile, "utf8").catch(() => "")).split("\n").filter(Boolean));
let failed = 0;
for (const r of plan.recipients) {
  if (sent.has(r.email)) continue;
  const m = plan.mails[r.language];
  try {
    await sendMail({ to: r.email, from, replyTo: "hello@vidalo.io", subject: m.subject, text: m.text, html: m.html, tags: { kind: "launch", lang: r.language } });
    await appendFile(sentFile, `${r.email}\n`);
    sent.add(r.email);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${(err as Error).message.replace(/\S+@\S+/g, "<email>")}`);
  }
  // Resend allows a few requests per second.
  await new Promise((res) => setTimeout(res, 600));
}
const done = plan.recipients.filter((r) => sent.has(r.email)).length;
console.log(`${done} of ${plan.recipients.length} sent${failed ? `, ${failed} failed (run --send again; sent addresses are skipped)` : ""}.`);
if (done === plan.recipients.length) console.log(`Everyone has the mail. Now delete the list by hand, on the hosted project:\n  ${LAUNCH_DELETE_SQL}`);
process.exit(failed ? 1 : 0);
