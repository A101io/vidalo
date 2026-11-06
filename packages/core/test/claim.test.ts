import { beforeEach, describe, expect, it } from "vitest";
import { MemDb, type BusinessRecord } from "../src/db";
import { setDb } from "../src/shared";
import { claimPaidBusiness, onlyOwnerMayBuy, type CheckoutProof, type LoadCheckout } from "../src/shared/claim";
import { handleStripeEvent } from "../src/billing";

/**
 * Review SEC-01: a signed-in stranger could link any business nobody had
 * claimed yet, then keep it when the real owner paid. The claim now needs the
 * paid Checkout session for that business.
 */
let db: MemDb;
let b: BusinessRecord;
const sessions = new Map<string, CheckoutProof>();
const stripe: LoadCheckout = async (id) => sessions.get(id) ?? null;
const stranger = { userId: "user-stranger", email: "vreemde@example.com" };
const owner = { userId: "user-owner", email: "Eigenaar@Bakkerij.nl" };

beforeEach(async () => {
  db = new MemDb();
  setDb(db);
  sessions.clear();
  b = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem" });
  sessions.set("cs_paid_owner", { paid: true, businessId: b.id });
});

describe("claim after checkout", () => {
  it("refuses a stranger with a valid session but no paid checkout for this business", async () => {
    const other = await db.upsertBusiness({ name: "Garage Ander", place: "Haarlem" });
    sessions.set("cs_paid_other", { paid: true, businessId: other.id });
    sessions.set("cs_open", { paid: false, businessId: b.id });
    for (const checkoutSessionId of [null, "", "cs_unknown", "cs_open", "cs_paid_other", "not-a-session"]) {
      const out = await claimPaidBusiness(db, { businessId: b.id, ...stranger, checkoutSessionId, loadCheckout: stripe });
      expect(out, String(checkoutSessionId)).toEqual({ ok: false, reason: "unpaid" });
    }
    expect(await db.getBusiness(b.id)).toMatchObject({ ownerEmail: null, ownerUserId: null });
  });

  it("refuses the slug (name and town); only the business id is accepted", async () => {
    const out = await claimPaidBusiness(db, { businessId: b.slug, ...stranger, checkoutSessionId: "cs_paid_owner", loadCheckout: stripe });
    expect(out).toEqual({ ok: false, reason: "not_found" });
  });

  it("links the paying owner, and nobody can take it over afterwards", async () => {
    const out = await claimPaidBusiness(db, { businessId: b.id, ...owner, checkoutSessionId: "cs_paid_owner", loadCheckout: stripe });
    expect(out.ok).toBe(true);
    expect(await db.getBusiness(b.id)).toMatchObject({ ownerEmail: "eigenaar@bakkerij.nl", ownerUserId: owner.userId });
    // Same session id in a stranger's hands: the business is taken.
    const late = await claimPaidBusiness(db, { businessId: b.id, ...stranger, checkoutSessionId: "cs_paid_owner", loadCheckout: stripe });
    expect(late).toEqual({ ok: false, reason: "taken" });
    // The owner again: fine, nothing changes.
    expect((await claimPaidBusiness(db, { businessId: b.id, ...owner, checkoutSessionId: null, loadCheckout: stripe })).ok).toBe(true);
  });

  it("mock mode (no Stripe): only after the mock checkout", async () => {
    expect(await claimPaidBusiness(db, { businessId: b.id, ...stranger, checkoutSessionId: null, loadCheckout: null })).toEqual({ ok: false, reason: "unpaid" });
    await db.logEvent(b.id, "checkout.mock", { plan: "monitor" });
    expect((await claimPaidBusiness(db, { businessId: b.id, ...owner, checkoutSessionId: null, loadCheckout: null })).ok).toBe(true);
  });
});

describe("a second checkout", () => {
  it("is for the signed-in owner only once the business paid, so a stranger cannot buy fresh proof", async () => {
    expect(onlyOwnerMayBuy(b)).toBe(false);
    expect(await handleStripeEvent({ id: "evt_first", type: "checkout.session.completed", data: { object: { id: "cs_paid_owner", payment_status: "paid", customer: "cus_1", metadata: { businessId: b.id, plan: "setup" }, customer_details: { email: owner.email } } } })).toBe("activated");
    expect(onlyOwnerMayBuy((await db.getBusiness(b.id))!)).toBe(true);
    // Mock checkout: no customer id, but the status moved on.
    expect(onlyOwnerMayBuy({ stripeCustomerId: null, status: "trial" })).toBe(true);
    expect(onlyOwnerMayBuy({ stripeCustomerId: null, status: "scanned" })).toBe(false);
  });
});

describe("activate after checkout", () => {
  const paid = (id: string, email: string) => ({ id: `evt_${id}`, type: "checkout.session.completed", data: { object: { id, payment_status: "paid", customer: "cus_1", subscription: "sub_1", metadata: { businessId: b.id, plan: "monitor" }, customer_details: { email } } } });

  it("the buyer's Stripe address replaces an address no payment stands behind, and unlinks that account", async () => {
    await db.upsertBusiness({ id: b.id, name: b.name, place: b.place, ownerEmail: stranger.email, ownerUserId: stranger.userId });
    expect(await handleStripeEvent(paid("cs_paid_owner", "Eigenaar@Bakkerij.nl"))).toBe("activated");
    expect(await db.getBusiness(b.id)).toMatchObject({ ownerEmail: "eigenaar@bakkerij.nl", ownerUserId: null });
    expect(await db.getBusinessByOwner({ userId: stranger.userId })).toBeNull();
  });

  it("keeps the address of a claim made with this very checkout session", async () => {
    await claimPaidBusiness(db, { businessId: b.id, userId: owner.userId, email: "kantoor@bakkerij.nl", checkoutSessionId: "cs_paid_owner", loadCheckout: stripe });
    expect(await handleStripeEvent(paid("cs_paid_owner", "boekhouding@bakkerij.nl"))).toBe("activated");
    expect(await db.getBusiness(b.id)).toMatchObject({ ownerEmail: "kantoor@bakkerij.nl", ownerUserId: owner.userId });
  });
});
