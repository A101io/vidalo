/**
 * Mail lab: every e-mail Vidalo sends, produced by the real code paths in
 * mock mode (no keys, nothing leaves the machine), checked, and laid out in
 * one page to read.
 *
 *   pnpm mail:lab              → out/mail-lab/index.html (+ the .eml files)
 *
 * Two journeys: a business that only did the free check (report mail, the
 * day-7 and day-21 follow-ups), and one that pays (welcome, own-website
 * check, directory corrections, fixes, rechecks weeks later, monthly report,
 * resolved and unfixable notices, the yearly re-confirmation). A mail kind that no journey reaches in
 * mock mode is rendered from its template with the journey's real records
 * and marked "template only".
 *
 * Checks per mail: the right recipient (owner vs third party), no leftover
 * placeholders, every link to our own site resolves to a page or route that
 * exists, an unsubscribe header on commercial mail. Exits non-zero when a
 * kind is missing or a check fails, so CI can run it.
 *
 * Not covered: the sign-in link, which Supabase sends itself
 * (docs/mail-lab.md). Real delivery: scripts/mail-send.mts.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.env.MAIL_LAB_DIR ?? "out/mail-lab");
await rm(OUT, { recursive: true, force: true });
process.env.VIDALO_MOCK = "1";
process.env.VIDALO_OUT_DIR = OUT;
// The site the links point to. mail:send builds with https://vidalo.io so a test mail's links open the real site.
process.env.PUBLIC_BASE_URL = process.env.MAIL_LAB_BASE_URL ?? "http://localhost:3000";
// Commercial mail is never sent without a working opt-out; a lab value makes the links signable.
process.env.UNSUBSCRIBE_SECRET ??= "mail-lab-only-not-a-secret";
delete process.env.RESEND_API_KEY;

const { db } = await import("@vidalo/core/db");
const { prepareBusiness, runScan } = await import("@vidalo/core/scanner");
const { setBusinessStatus } = await import("@vidalo/core/shared");
const { handlerFor } = await import("@vidalo/worker/src/jobs/index.ts");
const { runSiteCheck, syncAllChannels } = await import("@vidalo/core/publisher");
const { runRecheck, correctionRequestEmail, correctionFollowUpEmail, ownerWebsiteReminderEmail } = await import("@vidalo/core/fixer");
const reporter = await import("@vidalo/core/reporter");
const { sendMail, sendFollowUp, sendMonthlyReport, sendResolutionNotice, sendUnfixableNotice, dashboardUrl, factsPageUrl } = reporter;

const OWNER_PAID = "eigenaar@bakkerijdevries.nl";
const OWNER_FREE = "info@kapsalonjansen.nl";
const DAY = 24 * 60 * 60 * 1000;

/** Every kind, as the code tags it (reporter `type`, job `kind`), and who should receive it. */
const KINDS: Record<string, { label: string; to: "owner" | "third_party" }> = {
  baseline: { label: "Report after the free check", to: "owner" },
  followup_7: { label: "Follow-up, day 7 (commercial)", to: "owner" },
  followup_21: { label: "Follow-up, day 21 (commercial)", to: "owner" },
  welcome: { label: "Welcome after checkout", to: "owner" },
  site_instruction: { label: "Own-website check", to: "owner" },
  owner_instruction: { label: "Fix on the owner's website", to: "owner" },
  owner_reminder: { label: "Reminder about that fix", to: "owner" },
  report: { label: "Monthly report", to: "owner" },
  resolution: { label: "A wrong answer is fixed", to: "owner" },
  unfixable: { label: "A wrong answer cannot be fixed", to: "owner" },
  reconfirm: { label: "Yearly \"Klopt dit nog?\" about the facts", to: "owner" },
  directory_correction: { label: "Correction to a directory", to: "third_party" },
  correction_request: { label: "Correction request to a source", to: "third_party" },
  correction_followup: { label: "Follow-up to that source", to: "third_party" },
};

async function drain(now?: () => Date): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < 300; i++) {
    const job = await db.claimJob();
    if (!job) break;
    const handler = handlerFor(job.kind);
    if (!handler) throw new Error(`no handler for ${job.kind}`);
    // Rechecks run "later" so their follow-ups and reminders fall due.
    if (job.kind === "recheck" && now) await runRecheck((job.payload as { fixId: string }).fixId, { runScan, now });
    else await handler(job.payload, job);
    await db.completeJob(job.id);
    seen.push(job.kind);
  }
  return seen;
}

// Journey 1: free check only. Report mail, then the commercial follow-ups.
const free = await prepareBusiness({ name: "Kapsalon Jansen", place: "Leiden", db });
const freeRun = await runScan({ businessId: free.business.id, kind: "free", db });
await db.upsertBusiness({ id: free.business.id, slug: free.business.slug, name: free.business.name, place: free.business.place, ownerEmail: OWNER_FREE });
await db.enqueueJob("email", { template: "baseline", scanRunId: freeRun.scanRunId, businessId: free.business.id });
await drain();
await setBusinessStatus(free.business.id, "scanned", { via: "mail-lab" });
await sendFollowUp(free.business.id, 7);
await sendFollowUp(free.business.id, 21);

// Journey 2: paying, verified owner. Everything after checkout.
const paid = await prepareBusiness({ name: "Bakkerij De Vries", place: "Haarlem", db });
const b = paid.business;
const paidRun = await runScan({ businessId: b.id, kind: "free", db });
await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, ownerEmail: OWNER_PAID, plan: "monitor" });
await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, ownerVerifiedAt: new Date().toISOString(), ownerVerifiedVia: "google_business_profile" });
await db.enqueueJob("email", { template: "baseline", scanRunId: paidRun.scanRunId, businessId: b.id });
await setBusinessStatus(b.id, "trial", { via: "mail-lab" });
await db.enqueueJob("setup", { businessId: b.id });
const facts = await db.latestFacts(b.id);
if (facts) {
  const { businessId: _b, version: _v, provisional: _p, verifiedAt: _va, ...data } = facts;
  await db.insertFacts(b.id, data, { provisional: false, verifiedAt: new Date().toISOString() });
}
await db.enqueueJob("publish", { businessId: b.id, reason: "mail lab" });
await db.enqueueJob("sync", { businessId: b.id });
await drain();
// Weeks later: every open fix is rechecked, so due follow-ups and reminders go out.
const findings = await db.listFindings(b.id);
for (const weeks of [1, 2, 4]) {
  const at = () => new Date(Date.now() + weeks * 7 * DAY);
  for (const f of findings) for (const fix of await db.listFixes(f.id)) await runRecheck(fix.id, { runScan, now: at }).catch(() => null);
  await drain(at);
}
// The owner's own website blocks every robot: the real site check against a fake site.
await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, domain: "bakkerijdevries.nl" });
const fakeSite: import("@vidalo/core/publisher").FetchLike = async (url) =>
  new URL(url).pathname === "/robots.txt" ? new Response("User-agent: *\nDisallow: /\n", { status: 200 }) : new Response("<html><head><title>Bakkerij De Vries</title></head><body>Welkom</body></html>", { status: 200, headers: { "content-type": "text/html" } });
await runSiteCheck(b.id, { fetch: fakeSite });
await drain();
// 31 days after the first sync: each directory still wrong gets its one reminder.
await syncAllChannels(b.id, { now: new Date(Date.now() + 31 * DAY) });
await drain();
await sendMonthlyReport(b.id);
const [first, second] = findings;
if (first) await sendResolutionNotice(first.id);
if (second) await sendUnfixableNotice(second.id, "De site reageert niet op verzoeken en staat buiten de zoekresultaten.");

// A year later: the cron asks the owner once whether the facts are still right.
{
  const last = await db.latestFacts(b.id);
  if (last) {
    const { businessId: _b, version: _v, provisional: _p, verifiedAt: _va, createdAt: _c, ...data } = last;
    await db.insertFacts(b.id, data, { provisional: false, verifiedAt: new Date(Date.now() - 366 * DAY).toISOString() });
  }
  const { enqueueReconfirmations } = await import("@vidalo/worker/src/cron.ts");
  await enqueueReconfirmations();
  await enqueueReconfirmations(); // a second tick queues nothing
  await drain();
}

// Kinds the journeys did not reach in mock mode: render their template from the real records.
const mailDir = path.join(OUT, "mail");
const reached = new Set<string>();
for (const f of await readdir(mailDir)) {
  const raw = await readFile(path.join(mailDir, f), "utf8");
  const k = /^X-Vidalo-(?:type|kind): (.+)$/m.exec(raw)?.[1]?.trim();
  if (k) reached.add(k);
}
const templateOnly = new Set<string>();
const business = (await db.getBusiness(b.id))!;
const ctx = { business: { name: business.name, place: business.place, ownerEmail: business.ownerEmail, kvk: business.kvk }, factsPageUrl: factsPageUrl(business) };
const sourceFinding = findings.find((f) => f.sourceType === "third_party") ?? first;
const ownFinding = findings.find((f) => f.sourceType === "owned_website") ?? first;
const direct: Record<string, () => { to: string; subject: string; text: string; html?: string }> = {
  correction_request: () => ({ to: "redactie@voorbeeldbron.nl", ...correctionRequestEmail(sourceFinding!, ctx) }),
  correction_followup: () => ({ to: "redactie@voorbeeldbron.nl", ...correctionFollowUpEmail(sourceFinding!, ctx, new Date(Date.now() - 14 * DAY).toISOString()) }),
  owner_reminder: () => ({ to: OWNER_PAID, ...ownerWebsiteReminderEmail(ownFinding!, business, dashboardUrl(business), 7) }),
};
for (const [kind, make] of Object.entries(direct)) {
  if (reached.has(kind) || !first) continue;
  const m = make();
  await sendMail({ to: m.to, subject: m.subject, text: m.text, html: m.html, tags: { kind, lab: "template-only" } });
  templateOnly.add(kind);
}

// Read every mail back and check it.
type Mail = { file: string; kind: string; to: string; from: string; subject: string; headers: Record<string, string>; text: string; html: string | null; links: string[]; problems: string[]; warnings: string[] };
function parse(file: string, raw: string): Mail {
  const [head, ...rest] = raw.split("\r\n\r\n");
  const headers: Record<string, string> = {};
  for (const line of head!.split("\r\n")) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  const body = rest.join("\r\n\r\n");
  const boundary = /boundary="([^"]+)"/.exec(headers["Content-Type"] ?? "")?.[1];
  let text = body;
  let html: string | null = null;
  if (boundary) {
    for (const part of body.split(`--${boundary}`)) {
      const [ph, ...pb] = part.replace(/^\r\n/, "").split("\r\n\r\n");
      const content = pb.join("\r\n\r\n").replace(/\r\n$/, "");
      if (/text\/plain/.test(ph ?? "")) text = content;
      if (/text\/html/.test(ph ?? "")) html = content;
    }
  }
  const links = [...new Set([...`${text}\n${html ?? ""}`.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0].replace(/[.,;:]+$/, "")))];
  return { file, kind: headers["X-Vidalo-type"] ?? headers["X-Vidalo-kind"] ?? "unknown", to: headers.To ?? "", from: headers.From ?? "", subject: headers.Subject ?? "", headers, text, html, links, problems: [], warnings: [] };
}

/** The web app's pages and routes, as patterns ([id] → one segment). */
const appDir = path.resolve("apps/web/app");
const routes: RegExp[] = [];
(function walk(dir: string, prefix: string) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, `${prefix}/${name.startsWith("[") ? "[^/]+" : name.replace(/\./g, "\\.")}`);
    else if (/^(page|route)\.tsx?$/.test(name)) routes.push(new RegExp(`^${prefix || "/"}$`));
  }
})(appDir, "");

const base = new URL(process.env.PUBLIC_BASE_URL!);
const ownerOf: Record<string, string> = { [OWNER_FREE]: "free", [OWNER_PAID]: "paid" };
const mails: Mail[] = [];
for (const f of (await readdir(mailDir)).sort()) {
  const m = parse(f, await readFile(path.join(mailDir, f), "utf8"));
  const want = KINDS[m.kind];
  if (!want) m.problems.push(`unknown kind "${m.kind}"`);
  else if (want.to === "owner" && !ownerOf[m.to]) m.problems.push(`owner mail went to ${m.to}`);
  else if (want.to === "third_party" && ownerOf[m.to]) m.problems.push("third-party mail went to the owner");
  if (!m.subject) m.problems.push("empty subject");
  for (const bad of ["undefined", "NaN", "[object Object]", "{{", "}}", "null null"]) if (`${m.subject}\n${m.text}\n${m.html ?? ""}`.includes(bad)) m.problems.push(`contains "${bad}"`);
  for (const link of m.links) {
    const u = new URL(link);
    if (u.host !== base.host) continue;
    const p = u.pathname.replace(/\/$/, "") || "/";
    if (!routes.some((r) => r.test(p))) m.problems.push(`link to a page that does not exist: ${u.pathname}`);
  }
  if (m.kind.startsWith("followup") && !m.headers["List-Unsubscribe"]) m.problems.push("commercial mail without List-Unsubscribe");
  // Vidalo speaks: the branded HTML (logo + company line). A letter to a third party is signed by the owner: plain text.
  if (want?.to === "owner" && !m.html?.includes('data-brand="vidalo"')) m.problems.push("owner mail without the Vidalo-branded HTML");
  if (want?.to === "owner" && m.html && !m.html.includes("A101 B.V.")) m.problems.push("owner mail without the company line");
  if (want?.to === "third_party" && m.html) m.problems.push("third-party mail carries Vidalo HTML; it is a letter from the owner");
  mails.push(m);
}

// The same mail to the same third party more than once fails the run: one correction per change, one reminder (publisher CORRECTION_REMINDER_DAYS).
const seenBody = new Map<string, Mail[]>();
for (const m of mails) if (KINDS[m.kind]?.to === "third_party") seenBody.set(`${m.to}\n${m.subject}\n${m.text}`, [...(seenBody.get(`${m.to}\n${m.subject}\n${m.text}`) ?? []), m]);
for (const group of seenBody.values()) if (group.length > 1) for (const m of group) m.problems.push(`identical mail sent ${group.length}x to ${m.to}`);
const warned = mails.filter((m) => m.warnings.length);

const missing = Object.keys(KINDS).filter((k) => !mails.some((m) => m.kind === k));
const failing = mails.filter((m) => m.problems.length);

// The page: one card per kind (the first of each; the rest counted), then the full list.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cards = Object.entries(KINDS)
  .map(([kind, k]) => {
    const all = mails.filter((m) => m.kind === kind);
    const m = all[0];
    if (!m) return `<section class="card bad"><h2>${esc(k.label)} <code>${kind}</code></h2><p>Not produced.</p></section>`;
    const problems = all.flatMap((x) => x.problems);
    const warnings = [...new Set(all.flatMap((x) => x.warnings))];
    return `<section class="card${problems.length ? " bad" : ""}" id="${kind}">
  <h2>${esc(k.label)} <code>${kind}</code>${templateOnly.has(kind) ? ' <span class="tag">template only</span>' : ""}${all.length > 1 ? ` <span class="tag">${all.length} sent</span>` : ""}</h2>
  <dl><dt>To</dt><dd>${esc(m.to)}${k.to === "third_party" ? " (third party: never sent for real by mail:send)" : ""}</dd><dt>From</dt><dd>${esc(m.from)}</dd><dt>Subject</dt><dd><b>${esc(m.subject)}</b></dd>${m.headers["List-Unsubscribe"] ? `<dt>Unsubscribe</dt><dd>${esc(m.headers["List-Unsubscribe"])}</dd>` : ""}</dl>
  ${problems.length ? `<ul class="problems">${[...new Set(problems)].map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : '<p class="ok">All checks passed.</p>'}
  ${warnings.length ? `<ul class="warn">${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
  <div class="views">${m.html ? `<iframe sandbox title="${esc(m.subject)}" srcdoc="${esc(m.html)}"></iframe>` : ""}<pre>${esc(m.text)}</pre></div>
  <details><summary>Links (${m.links.length})</summary><ul>${m.links.map((l) => `<li><code>${esc(l)}</code></li>`).join("")}</ul></details>
</section>`;
  })
  .join("\n");
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vidalo mail lab</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f6f7f9;color:#111827}main{max-width:1200px;margin:0 auto;padding:24px 16px}h1{font-size:24px;margin:0 0 4px}.sum{color:#4b5563;margin:0 0 20px}
.card{background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;padding:16px;margin:0 0 16px}.card.bad{border-color:#dc2626}h2{font-size:17px;margin:0 0 8px}code{font:12px ui-monospace,monospace;color:#4b5563}
.tag{font-size:12px;background:#eef2ff;color:#3730a3;border-radius:99px;padding:2px 8px}dl{display:grid;grid-template-columns:100px 1fr;gap:2px 12px;margin:0 0 8px}dt{color:#6b7280}dd{margin:0;overflow-wrap:anywhere}
.ok{color:#15803d;margin:4px 0}.warn{color:#b45309;margin:4px 0}.problems{color:#b91c1c;margin:4px 0}.views{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:800px){.views{grid-template-columns:1fr}}
iframe{width:100%;height:520px;border:1px solid #e5e7eb;border-radius:6px;background:#fff}pre{white-space:pre-wrap;margin:0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;font:13px/1.5 ui-monospace,monospace;max-height:520px;overflow:auto}</style></head>
<body><main><h1>Vidalo mail lab</h1><p class="sum">${mails.length} mails, ${Object.keys(KINDS).length - missing.length} of ${Object.keys(KINDS).length} kinds, ${failing.length} with problems, ${warned.length} with warnings. Mock mode; nothing was sent. Generated ${new Date().toISOString()}. Not here: the sign-in link (sent by Supabase).</p>
${cards}</main></body></html>`;
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "index.html"), page, "utf8");
await writeFile(path.join(OUT, "mails.json"), JSON.stringify(mails.map(({ text: _t, html: _h, ...m }) => m), null, 2), "utf8");

console.log(`mail lab: ${mails.length} mails, ${Object.keys(KINDS).length - missing.length}/${Object.keys(KINDS).length} kinds → ${path.join(OUT, "index.html")}`);
for (const [kind, k] of Object.entries(KINDS)) {
  const n = mails.filter((m) => m.kind === kind).length;
  console.log(`  ${n ? "✓" : "✗"} ${kind.padEnd(22)} ${String(n).padStart(3)}  ${k.label}${templateOnly.has(kind) ? "  (template only)" : ""}`);
}
for (const w of new Set(warned.flatMap((m) => m.warnings.map((x) => `${m.kind}: ${x}`)))) console.log(`  ! ${w}`);
for (const m of failing) for (const p of m.problems) console.log(`  ✗ ${m.kind}: ${p}  (${m.file})`);
if (missing.length || failing.length) {
  console.log(`FAIL: ${missing.length} kinds missing, ${failing.length} mails with problems`);
  process.exit(1);
}
console.log("OK mail-lab");
process.exit(0);
