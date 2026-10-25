/**
 * Cancel and pause, started by the owner on /app/abonnement. Stripe holds the
 * money side; the business row holds what the app and the worker need
 * (cancelAt, pauseUntil, migration 0012). Everything an owner can do here is
 * one function, so the page, the tests and the webhook agree on the rules.
 *
 * The rules (docs/CANCEL-PAUSE.md has the reasoning and the legal checks):
 * - Cancelling is online, in the account, with no notice period: the paid
 *   month runs out (cancel_at_period_end), then the subscription ends. A
 *   reason is asked, never required. Until the end date the owner can undo it.
 * - Pausing stops checks, fixes, syncs and charges for 1, 2 or 3 months
 *   (pause_collection, invoices voided). It ends by itself on the date shown,
 *   or earlier when the owner resumes. The facts page stays online.
 * - Every change is confirmed by e-mail (the web app sends it) and logged.
 * - "paused" as a status still means a failed payment; an owner's pause is
 *   pauseUntil, so the 60-day churn rule never touches it.
 */
import type { BusinessRecord, Db } from "../db/types.js";

/** What this module asks of Stripe; the web app implements it with the SDK, tests with a fake. */
export interface SubscriptionApi {
  /** Sets or clears cancel at period end; returns when the paid period ends. */
  setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean, feedback?: CancelReason | null, comment?: string | null): Promise<{ periodEnd: Date | null }>;
  /** Stops collecting until `until` (invoices in between are voided). */
  pause(subscriptionId: string, until: Date): Promise<void>;
  /** Collects again from the next invoice on. */
  resume(subscriptionId: string): Promise<void>;
}

/** Stripe's own cancellation_details.feedback values, so the reason lands in Stripe too. */
export const CANCEL_REASONS = ["too_expensive", "unused", "missing_features", "switched_service", "low_quality", "too_complex", "customer_service", "other"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const PAUSE_MONTHS = [1, 2, 3] as const;
export type PauseMonths = (typeof PAUSE_MONTHS)[number];

const DAY = 24 * 60 * 60 * 1000;

export function isPausedByOwner(b: Pick<BusinessRecord, "pauseUntil">, now = new Date()): boolean {
  return Boolean(b.pauseUntil && new Date(b.pauseUntil) > now);
}

export function isCancelled(b: Pick<BusinessRecord, "cancelAt">): boolean {
  return Boolean(b.cancelAt);
}

export interface SubscriptionOptions {
  canCancel: boolean;
  canUndoCancel: boolean;
  canPause: boolean;
  canResume: boolean;
}

/** What the owner may do now. Only the monthly plan is a subscription; "setup" was paid once and has nothing to end. */
export function subscriptionOptions(b: BusinessRecord, now = new Date()): SubscriptionOptions {
  const subscribed = b.plan === "monitor" && (b.status === "trial" || b.status === "active" || b.status === "paused");
  const cancelled = isCancelled(b);
  const paused = isPausedByOwner(b, now);
  return {
    canCancel: subscribed && !cancelled,
    canUndoCancel: subscribed && cancelled && new Date(b.cancelAt!) > now,
    // A failed payment ("paused") is not a moment to pause: that is solved by paying or cancelling.
    canPause: subscribed && b.status !== "paused" && !cancelled && !paused,
    canResume: subscribed && paused,
  };
}

/** The pause end: the same day `months` later, at the start of that day (UTC). */
export function pauseEnd(now: Date, months: PauseMonths): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, now.getUTCDate()));
  // 31 Jan + 1 month would roll into March; stay in the target month.
  if (d.getUTCDate() !== now.getUTCDate()) d.setUTCDate(0);
  return d;
}

/** Without Stripe (mock mode, or a subscription id missing) the period ends a month from now. */
function fallbackPeriodEnd(now: Date): Date {
  return new Date(now.getTime() + 30 * DAY);
}

export type LifecycleResult = { ok: true; at: string } | { ok: false; reason: "not_allowed" };

function upsert(db: Db, b: BusinessRecord, patch: Partial<BusinessRecord>) {
  return db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, ...patch });
}

export async function cancelSubscription(
  db: Db,
  api: SubscriptionApi | null,
  b: BusinessRecord,
  opts: { reason?: CancelReason | null; comment?: string | null; now?: Date } = {},
): Promise<LifecycleResult> {
  const now = opts.now ?? new Date();
  if (!subscriptionOptions(b, now).canCancel) return { ok: false, reason: "not_allowed" };
  const reason = opts.reason && CANCEL_REASONS.includes(opts.reason) ? opts.reason : null;
  const comment = opts.comment?.trim().slice(0, 1000) || null;
  let end = fallbackPeriodEnd(now);
  if (api && b.stripeSubscriptionId) end = (await api.setCancelAtPeriodEnd(b.stripeSubscriptionId, true, reason, comment)).periodEnd ?? end;
  await upsert(db, b, { cancelAt: end.toISOString() });
  // The reason is for us to learn from; the comment may hold anything, so it stays out of the event.
  await db.logEvent(b.id, "subscription.cancel_requested", { endsAt: end.toISOString(), reason, withComment: Boolean(comment), pausedUntil: b.pauseUntil });
  return { ok: true, at: end.toISOString() };
}

export async function undoCancel(db: Db, api: SubscriptionApi | null, b: BusinessRecord, now = new Date()): Promise<LifecycleResult> {
  if (!subscriptionOptions(b, now).canUndoCancel) return { ok: false, reason: "not_allowed" };
  if (api && b.stripeSubscriptionId) await api.setCancelAtPeriodEnd(b.stripeSubscriptionId, false);
  await upsert(db, b, { cancelAt: null });
  await db.logEvent(b.id, "subscription.cancel_undone", { wasEndingAt: b.cancelAt });
  return { ok: true, at: now.toISOString() };
}

export async function pauseSubscription(db: Db, api: SubscriptionApi | null, b: BusinessRecord, months: PauseMonths, now = new Date()): Promise<LifecycleResult> {
  if (!subscriptionOptions(b, now).canPause || !PAUSE_MONTHS.includes(months)) return { ok: false, reason: "not_allowed" };
  const until = pauseEnd(now, months);
  if (api && b.stripeSubscriptionId) await api.pause(b.stripeSubscriptionId, until);
  await upsert(db, b, { pauseUntil: until.toISOString() });
  await db.logEvent(b.id, "subscription.paused", { until: until.toISOString(), months });
  return { ok: true, at: until.toISOString() };
}

export async function resumeSubscription(db: Db, api: SubscriptionApi | null, b: BusinessRecord, now = new Date()): Promise<LifecycleResult> {
  if (!subscriptionOptions(b, now).canResume) return { ok: false, reason: "not_allowed" };
  if (api && b.stripeSubscriptionId) await api.resume(b.stripeSubscriptionId);
  await upsert(db, b, { pauseUntil: null });
  await db.logEvent(b.id, "subscription.resumed", { early: true, wasUntil: b.pauseUntil });
  return { ok: true, at: now.toISOString() };
}

/** A pause that ends within this many days gets one reminder mail. */
export const PAUSE_REMINDER_DAYS = 7;

/** Pure: which pause mail is due for this business now, given the events already logged. */
export function duePauseMail(b: BusinessRecord, events: { type: string; payload: Record<string, unknown> }[], now = new Date()): "pause_ending" | "pause_ended" | null {
  if (!b.pauseUntil) return null;
  const until = new Date(b.pauseUntil);
  const sent = (type: string) => events.some((e) => e.type === type && e.payload.until === b.pauseUntil);
  if (until <= now) return sent("mail.pause_ended") ? null : "pause_ended";
  if (until.getTime() - now.getTime() <= PAUSE_REMINDER_DAYS * DAY) return sent("mail.pause_ending") ? null : "pause_ending";
  return null;
}
