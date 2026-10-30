import { beforeEach, describe, expect, it } from "vitest";
import { MemDb, type BusinessRecord } from "../src/db";
import { setDb } from "../src/shared";
import {
  cancelSubscription,
  duePauseMail,
  handleStripeEvent,
  pauseEnd,
  pauseSubscription,
  resumeSubscription,
  subscriptionOptions,
  undoCancel,
  type SubscriptionApi,
} from "../src/billing";
import { subscriptionEmail } from "../src/reporter/subscription-mails";

let db: MemDb;
const NOW = new Date("2026-10-25T10:00:00Z");
const END = new Date("2026-11-12T10:00:00Z");

/** A Stripe stand-in that records what it was asked. */
function fakeApi() {
  const calls: string[] = [];
  const api: SubscriptionApi = {
    async setCancelAtPeriodEnd(id, cancel, feedback) {
      calls.push(`cancel:${id}:${cancel}:${feedback ?? "-"}`);
      return { periodEnd: END };
    },
    async pause(id, until) {
      calls.push(`pause:${id}:${until.toISOString().slice(0, 10)}`);
    },
    async resume(id) {
      calls.push(`resume:${id}`);
    },
  };
  return { api, calls };
}

async function subscriber(patch: Partial<BusinessRecord> = {}): Promise<BusinessRecord> {
  return db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", plan: "monitor", status: "active", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", ownerEmail: "eigenaar@x.nl", ...patch });
}

beforeEach(() => {
  db = new MemDb();
  setDb(db);
});

describe("what an owner may do", () => {
  it("only the monthly plan can be paused or cancelled", async () => {
    expect(subscriptionOptions(await subscriber({ plan: "setup" }), NOW)).toEqual({ canCancel: false, canUndoCancel: false, canPause: false, canResume: false });
    expect(subscriptionOptions(await subscriber({ name: "B", status: "scanned" }), NOW).canCancel).toBe(false);
    expect(subscriptionOptions(await subscriber({ name: "C" }), NOW)).toEqual({ canCancel: true, canUndoCancel: false, canPause: true, canResume: false });
  });

  it("a failed payment can be cancelled but not paused", async () => {
    expect(subscriptionOptions(await subscriber({ status: "paused" }), NOW)).toMatchObject({ canCancel: true, canPause: false });
  });

  it("a paused owner can resume or still cancel; a cancelled one can undo until the end", async () => {
    const paused = await subscriber({ pauseUntil: END.toISOString() });
    expect(subscriptionOptions(paused, NOW)).toMatchObject({ canResume: true, canPause: false, canCancel: true });
    const cancelled = await subscriber({ name: "D", cancelAt: END.toISOString() });
    expect(subscriptionOptions(cancelled, NOW)).toMatchObject({ canUndoCancel: true, canCancel: false, canPause: false });
    expect(subscriptionOptions(cancelled, new Date(END.getTime() + 1)).canUndoCancel).toBe(false);
  });

  it("a pause ends on the same day 1 to 3 months later, never rolling past the month", () => {
    expect(pauseEnd(NOW, 1).toISOString().slice(0, 10)).toBe("2026-11-25");
    expect(pauseEnd(NOW, 3).toISOString().slice(0, 10)).toBe("2027-01-25");
    expect(pauseEnd(new Date("2027-01-31T12:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2027-02-28");
  });
});

describe("cancel and undo", () => {
  it("cancels at Stripe at period end, stores the end date and logs the reason without the comment", async () => {
    const { api, calls } = fakeApi();
    const b = await subscriber();
    const r = await cancelSubscription(db, api, b, { reason: "too_expensive", comment: "secret text", now: NOW });
    expect(r).toEqual({ ok: true, at: END.toISOString() });
    expect(calls).toEqual(["cancel:sub_1:true:too_expensive"]);
    expect((await db.getBusiness(b.id))?.cancelAt).toBe(END.toISOString());
    const ev = (await db.listEvents(b.id)).find((e) => e.type === "subscription.cancel_requested");
    expect(ev?.payload).toMatchObject({ reason: "too_expensive", withComment: true });
    expect(JSON.stringify(ev)).not.toContain("secret text");
  });

  it("a reason is never required and an unknown one is dropped", async () => {
    const { api, calls } = fakeApi();
    const b = await subscriber();
    expect((await cancelSubscription(db, api, b, { reason: "nonsense" as never, now: NOW })).ok).toBe(true);
    expect(calls).toEqual(["cancel:sub_1:true:-"]);
  });

  it("cannot cancel twice; undo clears it at Stripe and here", async () => {
    const { api, calls } = fakeApi();
    const b = await subscriber();
    await cancelSubscription(db, api, b, { now: NOW });
    const cancelled = (await db.getBusiness(b.id))!;
    expect(await cancelSubscription(db, api, cancelled, { now: NOW })).toEqual({ ok: false, reason: "not_allowed" });
    expect((await undoCancel(db, api, cancelled, NOW)).ok).toBe(true);
    expect(calls.at(-1)).toBe("cancel:sub_1:false:-");
    expect((await db.getBusiness(b.id))?.cancelAt).toBeNull();
  });

  it("without Stripe (mock) the period ends a month from now", async () => {
    const b = await subscriber({ stripeSubscriptionId: null });
    const r = await cancelSubscription(db, null, b, { now: NOW });
    expect(r.ok && r.at.slice(0, 10)).toBe("2026-11-24");
  });
});

describe("pause and resume", () => {
  it("pauses collection at Stripe until the chosen date and stops nothing else in the row", async () => {
    const { api, calls } = fakeApi();
    const b = await subscriber();
    const r = await pauseSubscription(db, api, b, 2, NOW);
    expect(r.ok && r.at.slice(0, 10)).toBe("2026-12-25");
    expect(calls).toEqual(["pause:sub_1:2026-12-25"]);
    const after = (await db.getBusiness(b.id))!;
    expect(after.status).toBe("active");
    expect(after.pauseUntil?.slice(0, 10)).toBe("2026-12-25");
  });

  it("refuses other lengths; resumes early", async () => {
    const { api, calls } = fakeApi();
    const b = await subscriber();
    expect(await pauseSubscription(db, api, b, 6 as never, NOW)).toEqual({ ok: false, reason: "not_allowed" });
    await pauseSubscription(db, api, b, 1, NOW);
    expect((await resumeSubscription(db, api, (await db.getBusiness(b.id))!, NOW)).ok).toBe(true);
    expect(calls.at(-1)).toBe("resume:sub_1");
    expect((await db.getBusiness(b.id))?.pauseUntil).toBeNull();
  });

  it("a paused business is left out of the monthly check", async () => {
    const day = new Date().getDate();
    await subscriber({ anniversaryDay: day });
    await subscriber({ name: "Stil", anniversaryDay: day, pauseUntil: new Date(Date.now() + 86_400_000).toISOString() });
    expect((await db.businessesDueForMonthlyScan(day)).map((b) => b.name)).toEqual(["Bakkerij De Vries"]);
  });

  it("one reminder a week before the end, one mail at the end, never twice", async () => {
    const until = "2026-11-25T00:00:00.000Z";
    const b = await subscriber({ pauseUntil: until });
    expect(duePauseMail(b, [], new Date("2026-11-10T00:00:00Z"))).toBeNull();
    expect(duePauseMail(b, [], new Date("2026-11-19T00:00:00Z"))).toBe("pause_ending");
    expect(duePauseMail(b, [{ type: "mail.pause_ending", payload: { until } }], new Date("2026-11-20T00:00:00Z"))).toBeNull();
    expect(duePauseMail(b, [], new Date("2026-11-25T01:00:00Z"))).toBe("pause_ended");
    expect(duePauseMail(b, [{ type: "mail.pause_ended", payload: { until } }], new Date("2026-11-26T00:00:00Z"))).toBeNull();
  });
});

describe("Stripe echoes the choices back (webhook)", () => {
  it("stores cancel_at_period_end and pause_collection, and clears them again", async () => {
    const b = await subscriber();
    const sub = { id: "sub_1", customer: "cus_1", status: "active", metadata: { businessId: b.id }, items: { data: [{ current_period_end: END.getTime() / 1000 }] } };
    expect(await handleStripeEvent({ id: "evt_a", type: "customer.subscription.updated", data: { object: { ...sub, cancel_at_period_end: true } } })).toBe("synced");
    expect((await db.getBusiness(b.id))?.cancelAt).toBe(END.toISOString());
    expect(await handleStripeEvent({ id: "evt_b", type: "customer.subscription.updated", data: { object: { ...sub, cancel_at_period_end: false, pause_collection: { behavior: "void", resumes_at: END.getTime() / 1000 } } } })).toBe("synced");
    expect(await db.getBusiness(b.id)).toMatchObject({ cancelAt: null, pauseUntil: END.toISOString(), status: "active" });
    expect(await handleStripeEvent({ id: "evt_c", type: "customer.subscription.updated", data: { object: { ...sub, pause_collection: { behavior: "void", resumes_at: END.getTime() / 1000 } } } })).toBe("ignored");
    expect(await handleStripeEvent({ id: "evt_d", type: "customer.subscription.updated", data: { object: { ...sub, pause_collection: null } } })).toBe("synced");
    expect((await db.getBusiness(b.id))?.pauseUntil).toBeNull();
  });
});

describe("confirmation mails", () => {
  const kinds = ["cancel_confirmed", "cancel_undone", "pause_confirmed", "pause_ending", "pause_ended"] as const;
  it("say the date, link back to the subscription, and stay calm, in both languages", () => {
    for (const lang of ["nl", "en"] as const) {
      for (const kind of kinds) {
        const m = subscriptionEmail(kind, { name: "Bakkerij De Vries", lang, at: END.toISOString() });
        expect(m.text).not.toContain("!");
        expect(m.text).toContain(lang === "en" ? "/en/app/abonnement" : "/app/abonnement");
        expect(m.html).toContain(`<html lang="${lang}">`);
        if (kind !== "cancel_undone" && kind !== "pause_ended") expect(m.text).toContain(lang === "en" ? "12 November 2026" : "12 november 2026");
      }
    }
  });

  it("the cancel confirmation says what stops, what stays and how to undo", () => {
    const m = subscriptionEmail("cancel_confirmed", { name: "Bakkerij De Vries", lang: "nl", at: END.toISOString() });
    for (const part of ["stopt op 12 november 2026", "feitenpagina verwijst", "facturen", "90 dagen", "Toch doorgaan"]) expect(m.text).toContain(part);
  });
});
