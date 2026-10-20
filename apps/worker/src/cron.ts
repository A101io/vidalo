/**
 * Cron tick (every 10 minutes). Everything here is idempotent: each step looks
 * at db state / events before enqueuing, so a tick can run twice without harm.
 *
 *   1. monthly scans on the anniversary day, spread 02:00–06:00 Europe/Amsterdam
 *   2. due rechecks → recheck jobs
 *   3. DNS / Cloudflare polls for unverified custom facts hosts
 *   4. lifecycle: paused → churned after 60 days; churned → free re-scan after 90 days
 *   5. follow-ups for scanned-but-not-purchased businesses at day 7 / day 21
 *   6. own-website check every 30 days for paying businesses
 *   7. Google index check of the facts page: daily until Google has it, then weekly
 */
import { pollFactsHost } from "@vidalo/core/publisher";
import { getDb as sharedDb, listBusinessesByStatus, setBusinessStatus, UNSUBSCRIBED_EVENT } from "@vidalo/core/shared";
import type { BusinessRecord, EventRow } from "@vidalo/core/db";
import { getDb } from "./compat.js";
import { errorMessage, log } from "./log.js";

export const TZ = "Europe/Amsterdam";

/** { y, m, d, hh, mm } of `date` in Europe/Amsterdam. */
export function amsterdamParts(date = new Date()): { y: number; m: number; d: number; hh: number; mm: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour") % 24, mm: get("minute") };
}

/** UTC Date for a wall-clock time in Europe/Amsterdam (handles DST via offset probe). */
export function amsterdamToUtc(y: number, m: number, d: number, hh: number, mm: number): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const p = amsterdamParts(new Date(guess));
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  const offset = asIfUtc - guess; // what the zone adds to UTC
  return new Date(guess - offset);
}

/** Deterministic spread of a business over 02:00–06:00: same slot every month. */
export function monthlySlot(business: Pick<BusinessRecord, "id">, now = new Date()): Date {
  const p = amsterdamParts(now);
  let h = 0;
  for (const ch of business.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const minutes = h % 240; // 0..239 → 02:00..05:59
  const slot = amsterdamToUtc(p.y, p.m, p.d, 2 + Math.floor(minutes / 60), minutes % 60);
  return slot.getTime() < now.getTime() ? now : slot;
}

function sameAmsterdamMonth(iso: string, now: Date): boolean {
  const a = amsterdamParts(new Date(iso));
  const b = amsterdamParts(now);
  return a.y === b.y && a.m === b.m;
}

function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
}

async function events(businessId: string): Promise<EventRow[]> {
  return getDb().listEvents(businessId, 500);
}

function lastEvent(evs: EventRow[], pred: (e: EventRow) => boolean): EventRow | null {
  return evs.find(pred) ?? null; // listEvents returns newest first
}

// ---------------------------------------------------------------------------

export async function enqueueMonthlyScans(now = new Date()): Promise<number> {
  const db = getDb();
  const { d } = amsterdamParts(now);
  const due = await db.businessesDueForMonthlyScan(d);
  let n = 0;
  for (const b of due) {
    const evs = await events(b.id);
    // one full scan per month: a baseline in the setup month counts
    const already = lastEvent(evs, (e) => e.type === "scan.enqueued" && (e.payload.kind === "monthly" || e.payload.kind === "baseline") && sameAmsterdamMonth(e.at, now));
    if (already) continue;
    const runAt = monthlySlot(b, now);
    const job = await db.enqueueJob("scan", { businessId: b.id, kind: "monthly" }, runAt);
    await db.logEvent(b.id, "scan.enqueued", { kind: "monthly", jobId: job.id, runAt: runAt.toISOString() });
    log.info("cron.monthly.enqueued", { businessId: b.id, runAt: runAt.toISOString() });
    n++;
  }
  return n;
}

export async function enqueueDueRechecks(now = new Date()): Promise<number> {
  const db = getDb();
  const due = await db.listDueRechecks(now);
  let n = 0;
  for (const fix of due) {
    const job = await db.enqueueJob("recheck", { fixId: fix.id, findingId: fix.findingId });
    // Push recheck_at a day ahead so the next tick does not enqueue it again; runRecheck sets the real next date.
    await db.updateFix(fix.id, { recheckAt: new Date(now.getTime() + 86_400_000).toISOString(), evidence: { ...fix.evidence, recheckQueuedAt: now.toISOString(), recheckJobId: job.id } });
    n++;
  }
  if (n) log.info("cron.rechecks.enqueued", { count: n });
  return n;
}

export async function pollUnverifiedHosts(): Promise<number> {
  const candidates = (await listBusinessesByStatus(["trial", "active"])).filter((b) => b.factsHost && !b.factsHostVerifiedAt);
  let verified = 0;
  for (const b of candidates) {
    try {
      const r = await pollFactsHost(b.id);
      if (r.verified) verified++;
    } catch (err) {
      log.warn("cron.host_poll.failed", { businessId: b.id, error: errorMessage(err) });
    }
  }
  if (candidates.length) log.info("cron.host_poll", { candidates: candidates.length, verified });
  return verified;
}

export async function lifecycleTransitions(now = new Date()): Promise<{ churned: number; rescans: number }> {
  const db = getDb();
  let churned = 0;
  let rescans = 0;

  // paused → churned after 60 days (facts page redirects from then on, see serve.ts)
  for (const b of await listBusinessesByStatus(["paused"])) {
    const evs = await events(b.id);
    const pausedAt = lastEvent(evs, (e) => e.type === "business.status" && e.payload.status === "paused")?.at ?? null;
    if (!pausedAt) continue; // the web app logs business.status on every transition
    if (daysSince(pausedAt, now) >= 60) {
      await setBusinessStatus(b.id, "churned");
      await db.logEvent(b.id, "business.status", { status: "churned", from: "paused", reason: "paused_60_days" });
      churned++;
      log.info("cron.lifecycle.churned", { businessId: b.id });
    }
  }

  // churned → one free re-scan after 90 days (re-engagement)
  for (const b of await listBusinessesByStatus(["churned"])) {
    const evs = await events(b.id);
    const churnedAt = lastEvent(evs, (e) => e.type === "business.status" && e.payload.status === "churned")?.at ?? null;
    if (!churnedAt || daysSince(churnedAt, now) < 90) continue;
    if (lastEvent(evs, (e) => e.type === "scan.enqueued" && e.payload.reason === "reengagement")) continue;
    const job = await db.enqueueJob("scan", { businessId: b.id, kind: "free", then: [] });
    await db.logEvent(b.id, "scan.enqueued", { kind: "free", reason: "reengagement", jobId: job.id });
    rescans++;
  }
  return { churned, rescans };
}

export async function enqueueFollowUps(now = new Date()): Promise<number> {
  const db = getDb();
  let n = 0;
  for (const b of await listBusinessesByStatus(["scanned"])) {
    if (!b.ownerEmail) continue;
    const age = daysSince(b.createdAt, now);
    if (age < 7 || age > 90) continue;
    const evs = await events(b.id);
    if (evs.some((e) => e.type === UNSUBSCRIBED_EVENT)) continue; // opted out of these mails
    const sent = (day: number) => lastEvent(evs, (e) => e.type === `email.followup_${day}` || (e.type === "followup.enqueued" && e.payload.day === day));
    const day: 7 | 21 | null = age >= 21 && !sent(21) ? 21 : age >= 7 && age < 21 && !sent(7) ? 7 : null;
    if (!day) continue;
    const job = await db.enqueueJob("followup", { businessId: b.id, day });
    await db.logEvent(b.id, "followup.enqueued", { day, jobId: job.id });
    n++;
  }
  if (n) log.info("cron.followups.enqueued", { count: n });
  return n;
}

/** Days between checks of the owner's own website. */
export const SITECHECK_EVERY_DAYS = 30;

// These two read and write through the shared handle, the one the publisher
// and the paid-only guard use, so a test (or a script) that injects a Db sees
// one consistent store. In the worker both handles are the same object.
export async function enqueueSiteChecks(now = new Date()): Promise<number> {
  const db = sharedDb();
  let n = 0;
  for (const b of await listBusinessesByStatus(["trial", "active"])) {
    if (!b.ownerVerifiedAt) continue; // paid-only job; it would only be skipped
    const last = lastEvent(await db.listEvents(b.id, 500), (e) => e.type === "sitecheck.enqueued");
    if (last && daysSince(last.at, now) < SITECHECK_EVERY_DAYS) continue;
    await db.enqueueJob("sitecheck", { businessId: b.id });
    await db.logEvent(b.id, "sitecheck.enqueued", { reason: "cron" });
    n++;
  }
  if (n) log.info("cron.sitechecks.enqueued", { count: n });
  return n;
}

export async function enqueueIndexChecks(now = new Date()): Promise<number> {
  const db = sharedDb();
  let n = 0;
  for (const b of await listBusinessesByStatus(["trial", "active"])) {
    if (!b.ownerVerifiedAt || !b.factsHost || !b.factsHostVerifiedAt) continue;
    const state = await db.getGoogleIndex(b.id);
    const indexed = state?.host === b.factsHost && state.inspection?.verdict === "PASS";
    const every = indexed ? 7 : 1;
    const last = lastEvent(await db.listEvents(b.id, 500), (e) => e.type === "google_index.enqueued");
    if (last && daysSince(last.at, now) < every) continue;
    await db.enqueueJob("index_check", { businessId: b.id });
    await db.logEvent(b.id, "google_index.enqueued", { reason: "cron" });
    n++;
  }
  if (n) log.info("cron.index_checks.enqueued", { count: n });
  return n;
}

export async function cronTick(now = new Date()): Promise<void> {
  const started = Date.now();
  const out: Record<string, unknown> = {};
  const steps: [string, () => Promise<unknown>][] = [
    ["monthly", () => enqueueMonthlyScans(now)],
    ["rechecks", () => enqueueDueRechecks(now)],
    ["hosts", () => pollUnverifiedHosts()],
    ["lifecycle", () => lifecycleTransitions(now)],
    ["followups", () => enqueueFollowUps(now)],
    ["sitechecks", () => enqueueSiteChecks(now)],
    ["indexChecks", () => enqueueIndexChecks(now)],
  ];
  for (const [name, fn] of steps) {
    try {
      out[name] = await fn();
    } catch (err) {
      out[name] = { error: errorMessage(err) };
      log.error("cron.step.failed", { step: name, error: errorMessage(err) });
    }
  }
  log.info("cron.tick", { ms: Date.now() - started, ...out });
}
