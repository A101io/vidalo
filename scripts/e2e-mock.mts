/**
 * End-to-end in one process, fully offline (VIDALO_MOCK=1):
 *   prepareBusiness → free scan → "checkout" (status trial + setup job) →
 *   drain the job queue with the worker's dispatcher → assert facts page,
 *   fixes, welcome + baseline mails.
 *
 *   pnpm e2e:mock
 */
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

process.env.VIDALO_MOCK = "1";
process.env.VIDALO_OUT_DIR ??= await mkdtemp(path.join(tmpdir(), "vidalo-e2e-"));
process.env.PUBLIC_BASE_URL ??= "http://localhost:3000";

const { db } = await import("@vidalo/core/db");
const { prepareBusiness, runScan } = await import("@vidalo/core/scanner");
const { setBusinessStatus } = await import("@vidalo/core/shared");
const { handlerFor, validatePayload, JOB_KINDS } = await import("@vidalo/worker/src/jobs/index.ts");
const { copy } = await import("@vidalo/core/copy");
const { REPORT_EMAIL_EVENT } = await import("@vidalo/core/reporter");
const { pollFactsHost, handleFactsRequest } = await import("@vidalo/core/publisher");

const out = process.env.VIDALO_OUT_DIR!;
const step = (s: string) => console.log(`\n== ${s}`);

// 1. Acquisition: business + provisional facts + prompts, then the free scan (what /api/scan does).
step("prepareBusiness + free scan");
const { business, created } = await prepareBusiness({ name: "Bakkerij De Vries", place: "Haarlem", db });
assert.ok(created, "business created");
assert.equal(business.sector, "winkels", "sector inferred from the mock Google category");
const free = await runScan({ businessId: business.id, kind: "free", db });
console.log(`free scan ${free.scanRunId}: ${free.wrongAnswers}/${free.totalAnswers} wrong, stip ${free.stip} (${free.engineStips.map((e) => `${e.engine}=${e.stip}`).join(", ")})`);
assert.ok(free.totalAnswers > 0 && free.wrongAnswers > 0, "free scan produced findings");
assert.equal((await db.listSamples(free.scanRunId)).length, 6 * (3 + 1), "free scan stays at 6 prompts, 3 samples on ChatGPT and 1 on Google AI");
// Only answers to fact questions count; the recommendation answers are reported under "Wie AI wel noemt".
assert.equal(free.totalAnswers, 3 * (3 + 1), "free scan counts its 3 fact questions: 3 samples on ChatGPT, 1 on Google AI");
assert.ok(free.findings.every((f) => f.evidenceKind !== "recommendation"), "not being recommended is never a finding");
assert.ok(["rood", "oranje", "groen", "grijs"].includes(free.stip), "free scan carries a stip colour");
assert.equal(free.findingsBySeverity.afhaker.length + free.findingsBySeverity.misleider.length + free.findingsBySeverity.verwarring.length, free.findings.length, "findings grouped by severity");
const freePrompts = await db.listPrompts(business.id, { activeOnly: true });
assert.ok(freePrompts.some((p) => p.kind === "recommendation"), "stored prompts include recommendation questions");

// 2. Result page e-mail capture + checkout (what /api/report-email, /api/checkout and the Stripe webhook do).
step("email capture + checkout");
// The report page's mail form logs the asker and queues the baseline mail to that address;
// the address never becomes the owner (review R-03). The mail goes out before the checkout.
const asker = "vraagt@example.nl";
await db.logEvent(business.id, REPORT_EMAIL_EVENT, { scanRunId: free.scanRunId, email: asker, lang: "nl" });
const askerJob = await db.enqueueJob("email", { template: "baseline", scanRunId: free.scanRunId, businessId: business.id, to: asker, lang: "nl" });
await handlerFor("email")!(askerJob.payload, askerJob);
await db.completeJob(askerJob.id);
assert.equal((await db.getBusiness(business.id))?.ownerEmail ?? null, null, "the asker's address is not the owner");
const askerEml = (await readdir(path.join(out, "mail"))).map((m) => path.join(out, "mail", m));
const askerBodies = await Promise.all(askerEml.map((f) => readFile(f, "utf8")));
assert.ok(askerBodies.some((x) => /^To: vraagt@example\.nl/m.test(x)), "the baseline mail goes to the asker");
// What the Stripe webhook does: the payer's address becomes the owner's.
await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, ownerEmail: "eigenaar@bakkerijdevries.nl", plan: "monitor" });
// What /api/google/callback does once the owner's Business Profile matches the place id.
await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, ownerVerifiedAt: new Date().toISOString(), ownerVerifiedVia: "google_business_profile" });
await db.enqueueJob("email", { template: "baseline", scanRunId: free.scanRunId, businessId: business.id });
await setBusinessStatus(business.id, "trial", { via: "e2e" });
await db.enqueueJob("setup", { businessId: business.id });
const statusEvent = (await db.listEvents(business.id, 50)).find((e) => e.type === "business.status");
assert.equal(statusEvent?.payload.status, "trial", "business.status event logged");

// 3. Owner confirms facts (what /app/gegevens does) → publish + sync.
step("facts confirmed → publish + sync");
const provisional = await db.latestFacts(business.id);
assert.ok(provisional, "provisional facts exist");
const { businessId: _b, version: _v, provisional: _p, verifiedAt: _va, ...data } = provisional!;
const confirmed = await db.insertFacts(business.id, data, { provisional: false, verifiedAt: new Date().toISOString() });
await db.enqueueJob("publish", { businessId: business.id, reason: `facts v${confirmed.version} confirmed` });
await db.enqueueJob("sync", { businessId: business.id });
await db.enqueueJob("scan", { businessId: business.id, kind: "ondemand", then: ["fixes"] });

// 4. Drain the queue with the worker's dispatcher (same code path as apps/worker processJob, without the loop).
step("drain job queue");
let processed = 0;
const seen: string[] = [];
for (let i = 0; i < 200; i++) {
  const job = await db.claimJob();
  if (!job) break;
  const handler = handlerFor(job.kind);
  assert.ok(handler, `handler for ${job.kind}`);
  const invalid = JOB_KINDS.includes(job.kind as never) ? validatePayload(job.kind as never, job.payload) : null;
  assert.equal(invalid, null, `payload valid for ${job.kind}`);
  try {
    const result = await handler!(job.payload, job);
    await db.completeJob(job.id);
    seen.push(job.kind);
    console.log(`job ${job.id} ${job.kind}`, result ? JSON.stringify(result).slice(0, 160) : "");
  } catch (err) {
    await db.failJob(job.id, String((err as Error).message ?? err));
    throw err;
  }
  processed++;
}
console.log(`processed ${processed} jobs: ${seen.join(", ")}`);
for (const k of ["email", "setup", "publish", "sync", "scan", "fixes", "sitecheck"]) assert.ok(seen.includes(k), `ran ${k} job`);

// 4b. The custom facts host verifies (what the cron's DNS poll does), then the Google index check
// verifies the host with a meta tag on the facts page, adds it, submits the sitemap and inspects it.
step("facts host verified → Google index check");
await pollFactsHost(business.id);
const verifiedHost = (await db.getBusiness(business.id))!.factsHost!;
assert.ok((await db.getBusiness(business.id))?.factsHostVerifiedAt, "facts host verified");
const indexJob = await db.enqueueJob("index_check", { businessId: business.id });
const indexResult = await handlerFor("index_check")!(indexJob.payload, indexJob);
console.log(`job ${indexJob.id} index_check`, JSON.stringify(indexResult));
assert.deepEqual(indexResult, { skipped: null, failedAt: null, indexed: true, verdict: "PASS" }, "index check ran in mock mode");
const google = await db.getGoogleIndex(business.id);
assert.ok(google?.token && google.verifiedAt && google.addedAt && google.sitemapAt && google.indexedAt, "google index state walked every step");
const served = await (await handleFactsRequest(new Request(`https://${verifiedHost}/`, { headers: { host: verifiedHost } }))).text();
assert.ok(served.includes(`<meta name="google-site-verification" content="${google!.token}">`), "facts page serves the verification tag");

// 5. Assertions.
step("assertions");
const b = await db.getBusiness(business.id);
assert.ok(b?.factsHost, "facts host set");
const channels = await db.listChannels(business.id);
const factsChannel = channels.find((c) => c.type === "facts_page");
assert.ok(factsChannel, "facts_page channel exists");
const pages = await readdir(path.join(out, "pages")).catch(() => [] as string[]);
assert.ok(pages.length > 0, "facts page written to out/pages");
const pageDir = path.join(out, "pages", pages[0]!);
const html = await readFile(path.join(pageDir, "index.html"), "utf8").catch(() => "");
assert.ok(html.includes(business.name), "rendered facts page contains the business name");

const findings = await db.listFindings(business.id);
assert.ok(findings.length > 0, "findings persisted");
// Recommendation questions: the mock leaves the business out of part of its lists. Not being named
// is reported under "Wie AI wel noemt", never stored as a finding (25 Oct 2026).
assert.ok(findings.every((f) => f.evidenceKind !== "recommendation"), "no finding for not being recommended");
assert.ok(findings.every((f) => f.criterium != null), "every finding carries its criterium");
const scans = await db.listScanRuns(business.id);
const { buildReport } = await import("@vidalo/core/scanner");
const full = await buildReport(scans[0]!.id, db);
console.log(`latest scan ${full.kind}: stip ${full.stip}, ${full.findings.length} findings, ${full.instable.length} instable, ${full.criteriaNotFound.length} criteria not found`);
assert.ok(["rood", "oranje", "groen", "grijs"].includes(full.stip), "full scan carries a stip colour");
assert.ok((full.recommendations ?? []).some((r) => r.named < r.answers), "the report still shows the questions where the business was not named");
assert.ok((full.recommendations ?? []).some((r) => r.named > 0), "the report counts the answers where the business was named");
assert.ok(full.engineStips.filter((e) => e.counts).length === 3, "chatgpt, google_ai and gemini count for the stip; perplexity and claude do not; copilot is not asked");
assert.ok(full.engines.some((e) => e.engine === "claude" && !e.skipped && e.correct + e.wrong + e.notFound > 0), "claude is asked in a full scan");
let fixes = 0;
for (const f of findings) fixes += (await db.listFixes(f.id)).length;
assert.ok(fixes > 0, "fixes opened for findings");

const mails = await readdir(path.join(out, "mail"));
const bodies = await Promise.all(mails.map((m) => readFile(path.join(out, "mail", m), "utf8")));
const has = (needle: string) => bodies.some((x) => x.includes(needle));
assert.ok(has(copy.email.subjects.welcome) || has("Welkom"), "welcome mail written");
assert.ok(has("antwoorden") || has("antwoord"), "baseline summary mail written");
assert.ok(has("Stip: "), "baseline mail shows the colour of the dot");
assert.ok(!bodies.some((x) => /\b\d{1,3}\s*\/\s*100\b|score/i.test(x)), "mails never show a score");
console.log(`mails: ${mails.length} in ${path.join(out, "mail")}`);
console.log(`facts page: ${pageDir}`);
console.log(`findings: ${findings.length}, fixes: ${fixes}, channels: ${channels.length}`);

// 6. Not found: a business the mock AI has never heard of reads as "niet gevonden", not as "nothing wrong".
step("not found: Polyvale Nieuw, Haarlem");
const unknown = await prepareBusiness({ name: "Polyvale Nieuw", place: "Haarlem", db });
const unknownScan = await runScan({ businessId: unknown.business.id, kind: "free", db });
console.log(`free scan ${unknownScan.scanRunId}: ${unknownScan.wrongAnswers} wrong, ${unknownScan.notFoundAnswers} not found of ${unknownScan.totalAnswers}, visibility ${unknownScan.visibility}`);
assert.equal(unknownScan.visibility, "unknown", "unknown business has visibility unknown");
assert.ok(unknownScan.findings.some((f) => f.verdict === "not_found"), "at least one not_found finding");
assert.ok(unknownScan.wrongAnswers + unknownScan.notFoundAnswers <= unknownScan.totalAnswers, "not found is never counted as wrong");
assert.ok(unknownScan.findings.filter((f) => f.verdict === "not_found").every((f) => f.sourceType === "none" && f.sourceUrl === null), "not_found findings carry no source");

// 7. An online business (feature 001): understood as online, asked six questions without a town, hours, address
// or phone, a competition block that adds up, a ledger row per template, and a mail to the asker without a town.
// The name and the competitors are made up: mock output reaches public preview URLs (compliance C-30).
step("online business: Vloedlijn Music, Utrecht");
const { competitionCountsOf, uncheckedAnswersOf } = await import("@vidalo/core/types");
const ONLINE_NAME = "Vloedlijn Music";
const ONLINE_PLACE = "Utrecht";
const online = await prepareBusiness({ name: ONLINE_NAME, place: ONLINE_PLACE, db });
const onlineScan = await runScan({ businessId: online.business.id, kind: "free", db });
const onlineReport = await buildReport(onlineScan.scanRunId, db);
console.log(`online scan ${onlineScan.scanRunId}: mode ${onlineReport.profile?.mode}, ${onlineReport.totalAnswers} answers, stip ${onlineReport.stip}`);
assert.equal(onlineReport.profile?.mode, "online", "the report carries the online profile");
assert.equal(onlineReport.profile?.source, "auto", "the mock reading is automatic");
const onlineRow = (await db.getBusiness(online.business.id))!;
assert.equal(onlineRow.profileAuto?.mode, "online", "the automatic profile is stored on the business");
assert.ok(onlineRow.profileAuto!.competitors.length > 0 && onlineRow.profileAuto!.competitors.every((c) => c.startsWith("Voorbeeld ")), "the mock competitors are made up");

const askedIds = new Set((await db.listSamples(onlineScan.scanRunId)).map((x) => x.promptId));
const asked = (await db.listPrompts(online.business.id)).filter((p) => askedIds.has(p.id));
assert.equal(asked.length, 6, "six free questions");
const LOCAL_QUESTION = /utrecht|openingstijd|\bopen\b|zondag|pinnen|pin\b|adres|telefoon|vestiging|in de buurt/i;
for (const p of asked) assert.ok(!LOCAL_QUESTION.test(p.textNl), `no local wording in "${p.textNl}"`);
assert.ok(asked.some((p) => p.templateKey === "online.rec.quality") && asked.some((p) => p.templateKey === "online.alt.self"), "category and alternative questions are asked");

// The competition counts add up: per question and over all of them, and against the stored samples.
const comp = competitionCountsOf(onlineReport);
assert.ok(comp && comp.answers > 0 && comp.questions >= 2, "the report has competition counts");
const compRows = (onlineReport.recommendations ?? []).filter((r) => r.family === "rec_category" || r.family === "alternative");
assert.equal(compRows.reduce((n, r) => n + r.answers, 0), comp.answers, "answers add up over the questions");
assert.equal(compRows.reduce((n, r) => n + r.named, 0), comp.named, "named adds up over the questions");
for (const r of compRows) {
  assert.ok(r.named <= r.answers, "never named more often than answered");
  assert.ok(r.others.every((o) => o.answers <= r.answers), "no other business is named in more answers than were given");
  assert.equal(r.answers, (await db.listSamples(onlineScan.scanRunId)).filter((x) => x.promptId === r.promptId).length, "the count is the number of stored samples");
}
assert.ok(compRows.some((r) => r.family === "alternative") && compRows.some((r) => r.family === "rec_category"), "both families are counted");

// The question library has its rows for this category, and no business in them (compliance C-14).
const ledger = await db.questionLibrary({ mode: "online" });
assert.ok(ledger.length >= 6, "the library ledger has rows for the online templates");
assert.ok(ledger.every((l) => l.category === onlineRow.profileAuto!.category), "rows are filed under the category");
assert.ok(!JSON.stringify(ledger).includes(ONLINE_NAME) && !JSON.stringify(ledger).toLowerCase().includes(ONLINE_PLACE.toLowerCase()), "the ledger holds no business name and no town");

// The free-check mail goes to the asker, in the report's counts, without a town or a listing.
const onlineAsker = "vraagt-online@example.nl";
await db.logEvent(online.business.id, REPORT_EMAIL_EVENT, { scanRunId: onlineScan.scanRunId, email: onlineAsker, lang: "nl" });
const onlineJob = await db.enqueueJob("email", { template: "baseline", scanRunId: onlineScan.scanRunId, businessId: online.business.id, to: onlineAsker, lang: "nl" });
await handlerFor("email")!(onlineJob.payload, onlineJob);
await db.completeJob(onlineJob.id);
assert.equal((await db.getBusiness(online.business.id))?.ownerEmail ?? null, null, "the asker's address is not the owner");
const onlineMails = await Promise.all((await readdir(path.join(out, "mail"))).map((f) => readFile(path.join(out, "mail", f), "utf8")));
const onlineMail = onlineMails.find((x) => /^To: vraagt-online@example\.nl/m.test(x));
assert.ok(onlineMail, "the free-check mail goes to the asker");
const onlineText = onlineMail!.split("Content-Type: text/html")[0]!;
assert.ok(onlineText.includes("Gecontroleerd als: "), "the mail words the profile as a reading");
assert.ok(onlineText.includes(`Genoemd in ${comp.named} van ${comp.answers} antwoorden`), "the mail shows the report's competition counts");
assert.ok(onlineText.includes(`${onlineReport.totalAnswers - uncheckedAnswersOf(onlineReport)} antwoorden gecontroleerd`), "the mail checks as many answers as the report");
assert.ok(!onlineText.includes(ONLINE_PLACE), "the mail names no town");
assert.ok(!/openingstijd|vestiging|\bBing\b|\bApple\b|Google(?! AI)|\bgids/i.test(onlineText), "the mail names no hours, listing or directory work");
assert.ok(!/Voorbeeld /.test(onlineText), "the mail names no other business");
assert.ok(!/Sonable|Mood Media|Soundtrack Your Brand|Spotify/i.test(`${onlineText}${JSON.stringify(onlineReport)}`), "no real brand in the mock output");
assert.ok(!/%|score|ranking|\bplek\b|positie/i.test(onlineText), "no score, percentage or position");

await db.close();
console.log("\nOK e2e-mock");
