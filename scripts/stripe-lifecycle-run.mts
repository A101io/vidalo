/**
 * Feature 002 A-06 (D2): one recorded run of cancel → undo → cancel → pause → resume against the
 * Stripe SANDBOX, through the same core/billing/lifecycle.ts functions the abonnement page uses,
 * printing after each step what the app recorded and what Stripe says (subscription state and the
 * newest event id), for 05-verification.md. Then the retention trigger's view of each step.
 *
 *   STRIPE_SECRET_KEY=sk_test_... pnpm exec tsx scripts/stripe-lifecycle-run.mts --subscription sub_... [--customer cus_...]
 *
 * Refuses a live key and the Sitty and Sonable accounts. Uses an in-memory database: nothing is
 * written to Supabase. Run from Julian's Mac (this container cannot reach api.stripe.com).
 */
import { MemDb } from "../packages/core/src/db/index.js";
import { cancelSubscription, pauseSubscription, resumeSubscription, undoCancel, type SubscriptionApi } from "../packages/core/src/billing/index.js";
import { deletionPlan } from "../packages/core/src/shared/deletion.js";

const OTHER_ACCOUNTS: Record<string, string> = { acct_1UA8rHEGTq7D30VV: "Sitty", acct_1TyIM8EQK4LIWEDd: "Sonable" };
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const key = process.env.STRIPE_SECRET_KEY ?? "";
const subscription = arg("subscription");
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) throw new Error("A Stripe sandbox key (sk_test_…) is required; live keys are refused.");
if (!subscription) throw new Error("--subscription sub_… is required (a sandbox Vidalo Monthly subscription).");

async function stripe(path: string, form?: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: form ? "POST" : "GET",
    headers: { authorization: `Bearer ${key}`, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`stripe ${path}: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

const account = await stripe("account");
if (OTHER_ACCOUNTS[String(account.id)]) throw new Error(`This key belongs to ${OTHER_ACCOUNTS[String(account.id)]}, not Vidalo.`);

const periodEnd = (s: Record<string, unknown>): Date | null => {
  const items = (s.items as { data?: { current_period_end?: number }[] } | undefined)?.data;
  const t = (s.cancel_at as number | null) ?? (s.current_period_end as number | undefined) ?? items?.[0]?.current_period_end;
  return t ? new Date(t * 1000) : null;
};
const api: SubscriptionApi = {
  async setCancelAtPeriodEnd(id, cancel, feedback, comment) {
    const form: Record<string, string> = { cancel_at_period_end: String(cancel) };
    if (cancel && feedback) form["cancellation_details[feedback]"] = feedback;
    if (cancel && comment) form["cancellation_details[comment]"] = comment;
    return { periodEnd: periodEnd(await stripe(`subscriptions/${id}`, form)) };
  },
  async pause(id, until) {
    await stripe(`subscriptions/${id}`, { "pause_collection[behavior]": "void", "pause_collection[resumes_at]": String(Math.floor(until.getTime() / 1000)) });
  },
  async resume(id) {
    await stripe(`subscriptions/${id}`, { pause_collection: "" });
  },
};

const sub = await stripe(`subscriptions/${subscription}`);
const db = new MemDb();
let b = await db.upsertBusiness({ name: "Sandbox run", place: "Haarlem", plan: "monitor", status: "active", stripeCustomerId: String(sub.customer), stripeSubscriptionId: subscription });

async function report(step: string, result: unknown) {
  const s = await stripe(`subscriptions/${subscription}`);
  const ev = (await stripe(`events?limit=1&type=customer.subscription.updated`)) as { data?: { id: string; created: number }[] };
  b = (await db.getBusiness(b.id))!;
  console.log(
    JSON.stringify({
      step,
      result,
      app: { cancelAt: b.cancelAt, pauseUntil: b.pauseUntil, deleteAt: b.deleteAt, deleteReason: b.deleteReason, plan: deletionPlan(b) },
      stripe: { status: s.status, cancel_at_period_end: s.cancel_at_period_end, cancel_at: s.cancel_at, pause_collection: s.pause_collection, latestEvent: ev.data?.[0]?.id ?? null },
    }),
  );
}

console.log(JSON.stringify({ account: account.id, subscription, startedAt: new Date().toISOString() }));
await report("cancel", await cancelSubscription(db, api, b, { reason: "other", comment: "feature 002 sandbox run" }));
await report("undo", await undoCancel(db, api, (await db.getBusiness(b.id))!));
await report("cancel again", await cancelSubscription(db, api, (await db.getBusiness(b.id))!, { reason: "other" }));
await report("undo before pause", await undoCancel(db, api, (await db.getBusiness(b.id))!));
await report("pause 1 month", await pauseSubscription(db, api, (await db.getBusiness(b.id))!, 1));
await report("resume", await resumeSubscription(db, api, (await db.getBusiness(b.id))!));
console.log(JSON.stringify({ done: true, endedAt: new Date().toISOString() }));
