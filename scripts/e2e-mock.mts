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
assert.equal(free.totalAnswers, 6 * 3 * 3, "free scan stays at 6 prompts x 3 engines x 3 samples");
assert.ok(["rood", "oranje", "groen", "grijs"].includes(free.stip), "free scan carries a stip colour");
assert.equal(free.findingsBySeverity.afhaker.length + free.findingsBySeverity.misleider.length + free.findingsBySeverity.verwarring.length, free.findings.length, "findings grouped by severity");
const freePrompts = await db.listPrompts(business.id, { activeOnly: true });
assert.ok(freePrompts.some((p) => p.kind === "recommendation"), "stored prompts include recommendation questions");

// 2. Result page e-mail capture + checkout (what /api/report-email, /api/checkout and the Stripe webhook do).
step("email capture + checkout");
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
// Recommendation questions: the mock leaves the business out of part of its lists, so at least one
// "niet genoemd" finding exists, linked to a criterium, with the fact as the correct value.
const recFindings = findings.filter((f) => f.evidenceKind === "recommendation");
assert.ok(recFindings.length > 0, "a recommendation finding (business absent) exists");
assert.ok(recFindings.every((f) => f.wrongValue === "niet genoemd" && f.criterium != null && f.correctValue !== ""), "recommendation findings carry 'niet genoemd' + criterium");
assert.ok(findings.every((f) => f.criterium != null), "every finding carries its criterium");
const scans = await db.listScanRuns(business.id);
const { buildReport } = await import("@vidalo/core/scanner");
const full = await buildReport(scans[0]!.id, db);
console.log(`latest scan ${full.kind}: stip ${full.stip}, ${full.findings.length} findings, ${full.instable.length} instable, ${full.criteriaNotFound.length} criteria not found`);
assert.ok(["rood", "oranje", "groen", "grijs"].includes(full.stip), "full scan carries a stip colour");
assert.ok(full.engineStips.filter((e) => e.counts).length === 4, "chatgpt, google_ai, copilot and gemini count for the stip; perplexity does not");
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

await db.close();
console.log("\nOK e2e-mock");
