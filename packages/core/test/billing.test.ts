import { beforeEach, describe, expect, it } from "vitest";
import { MemDb, type BusinessRecord } from "../src/db";
import { setDb } from "../src/shared";
import { handleStripeEvent, type StripeEventLike } from "../src/billing";

let db: MemDb;
let n = 0;
const evt = (type: string, object: Record<string, unknown>, id = `evt_${++n}`): StripeEventLike => ({ id, type, data: { object } });

async function business(status: BusinessRecord["status"] = "scanned"): Promise<BusinessRecord> {
  return db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", status, stripeCustomerId: status === "scanned" ? null : "cus_1" });
}
const jobs = async (kind: string) => {
  const out = [];
  for (let j = await db.claimJob([kind]); j; j = await db.claimJob([kind])) out.push(j);
  return out;
};

beforeEach(() => {
  db = new MemDb();
  setDb(db);
});

describe("checkout", () => {
  it("a paid checkout starts the service and stores the Stripe ids", async () => {
    const b = await business();
    const out = await handleStripeEvent(evt("checkout.session.completed", { id: "cs_1", payment_status: "paid", customer: "cus_1", subscription: "sub_1", metadata: { businessId: b.id, plan: "monitor" }, customer_details: { email: "eigenaar@x.nl" } }));
    expect(out).toBe("activated");
    const after = await db.getBusiness(b.id);
    expect(after).toMatchObject({ status: "trial", plan: "monitor", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", ownerEmail: "eigenaar@x.nl" });
    expect(await jobs("setup")).toHaveLength(1);
  });

  it("a SEPA checkout waits for the money, then starts", async () => {
    const b = await business();
    const session = { id: "cs_2", payment_status: "unpaid", customer: "cus_2", metadata: { businessId: b.id, plan: "monitor" } };
    expect(await handleStripeEvent(evt("checkout.session.completed", session))).toBe("payment_processing");
    expect((await db.getBusiness(b.id))?.status).toBe("scanned");
    expect(await jobs("setup")).toHaveLength(0);
    expect(await handleStripeEvent(evt("checkout.session.async_payment_succeeded", { ...session, payment_status: "paid" }))).toBe("activated");
    expect((await db.getBusiness(b.id))?.status).toBe("trial");
  });

  it("a failed bank debit starts nothing", async () => {
    const b = await business();
    expect(await handleStripeEvent(evt("checkout.session.async_payment_failed", { id: "cs_3", metadata: { businessId: b.id } }))).toBe("payment_failed");
    expect((await db.getBusiness(b.id))?.status).toBe("scanned");
  });

  it("Stripe retrying the same event changes nothing the second time", async () => {
    const b = await business();
    const e = evt("checkout.session.completed", { id: "cs_4", payment_status: "paid", metadata: { businessId: b.id, plan: "setup" } }, "evt_same");
    expect(await handleStripeEvent(e)).toBe("activated");
    expect(await handleStripeEvent(e)).toBe("duplicate");
    expect(await jobs("setup")).toHaveLength(1);
  });

  it("adding monitoring later keeps the business as it is", async () => {
    const b = await business("trial");
    expect(await handleStripeEvent(evt("checkout.session.completed", { id: "cs_5", payment_status: "paid", customer: "cus_1", subscription: "sub_9", metadata: { businessId: b.id, plan: "monitor_addon" } }))).toBe("activated");
    expect(await db.getBusiness(b.id)).toMatchObject({ status: "trial", plan: "monitor", stripeSubscriptionId: "sub_9" });
    expect(await jobs("setup")).toHaveLength(0);
  });
});

describe("subscription life", () => {
  it("first renewal makes a trial customer active", async () => {
    const b = await business("trial");
    expect(await handleStripeEvent(evt("invoice.paid", { id: "in_1", customer: "cus_1", billing_reason: "subscription_create" }))).toBe("ignored");
    expect(await handleStripeEvent(evt("invoice.paid", { id: "in_2", customer: "cus_1", billing_reason: "subscription_cycle" }))).toBe("now_active");
    expect((await db.getBusiness(b.id))?.status).toBe("active");
  });

  it("an invoice is placed by the subscription's metadata in the newer API shape, before the customer is stored", async () => {
    const b = await business("trial");
    const invoice = { id: "in_new", customer: "cus_unknown", billing_reason: "subscription_cycle", parent: { type: "subscription_details", subscription_details: { metadata: { businessId: b.id } } } };
    expect(await handleStripeEvent(evt("invoice.paid", invoice))).toBe("now_active");
    // Control: without the metadata and with an unknown customer, nobody is guessed.
    expect(await handleStripeEvent(evt("invoice.paid", { ...invoice, id: "in_new2", parent: null }))).toBe("no_business");
  });

  it("a failed invoice is logged on the business found by its customer", async () => {
    const b = await business("active");
    expect(await handleStripeEvent(evt("invoice.payment_failed", { id: "in_3", customer: "cus_1", attempt_count: 1 }))).toBe("invoice_failed_logged");
    expect((await db.listEvents(b.id)).some((e) => e.type === "invoice.payment_failed")).toBe(true);
    expect((await db.getBusiness(b.id))?.status).toBe("active");
  });

  it("unpaid pauses, paying again resumes", async () => {
    const b = await business("active");
    expect(await handleStripeEvent(evt("customer.subscription.updated", { id: "sub_1", customer: "cus_1", status: "past_due" }))).toBe("ignored");
    expect(await handleStripeEvent(evt("customer.subscription.updated", { id: "sub_1", customer: "cus_1", status: "unpaid" }))).toBe("paused");
    expect((await db.getBusiness(b.id))?.status).toBe("paused");
    expect(await handleStripeEvent(evt("invoice.paid", { id: "in_4", customer: "cus_1", billing_reason: "subscription_cycle" }))).toBe("resumed");
    expect((await db.getBusiness(b.id))?.status).toBe("active");
  });

  it("an ended subscription churns the business", async () => {
    const b = await business("active");
    expect(await handleStripeEvent(evt("customer.subscription.deleted", { id: "sub_1", customer: "cus_1", metadata: { businessId: b.id } }))).toBe("churned");
    expect((await db.getBusiness(b.id))?.status).toBe("churned");
  });

  it("an event for nobody we know is reported, not guessed", async () => {
    expect(await handleStripeEvent(evt("invoice.paid", { id: "in_x", customer: "cus_unknown" }))).toBe("no_business");
  });
});
