import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { MemDb, type BusinessRecord } from "../src/db";
import { setDb } from "../src/shared";
import {
  DOMAIN_PRICE_EUR_PER_YEAR,
  cancelDomain,
  domainBuyRefusal,
  domainOptions,
  domainState,
  dueDomainReminder,
  handleStripeEvent,
  inclVat,
  plusYear,
  undoDomainCancel,
  type StripeEventLike,
  type SubscriptionApi,
} from "../src/billing";
import { MockRegistrar, holderDraft, parseDomain, parseHolder, runDomainRegistration, setDomainAutoRenew, setRegistrar, splitPhone, splitStreet, suggestDomains, tldAllowed, type DomainRegistration, type Holder } from "../src/registrar";
import { domainEmail, DOMAIN_MAIL_KINDS } from "../src/reporter";

let db: MemDb;
let registrar: MockRegistrar;
let n = 0;
const evt = (type: string, object: Record<string, unknown>, id = `evt_d${++n}`): StripeEventLike => ({ id, type, data: { object } });
const jobs = async (kind: string) => {
  const out = [];
  for (let j = await db.claimJob([kind]); j; j = await db.claimJob([kind])) out.push(j);
  return out;
};
const DAY = 86_400_000;

const holder: Holder = { company: "Bakkerij De Vries", firstName: "Jan", lastName: "de Vries", street: "Kerkstraat", houseNumber: "12", postcode: "2011 AB", city: "Haarlem", country: "NL", phone: "+31231234567", email: "jan@bakkerijdevries.nl", kvk: null };

function registration(over: Partial<DomainRegistration> = {}): DomainRegistration {
  return { name: "bakkerijdevries.nl", status: "checkout", holder, registrar: "mock", acceptedAt: new Date().toISOString(), checkoutSessionId: null, stripeSubscriptionId: null, holderHandle: null, registrarId: null, paidAt: null, registeredAt: null, expiresAt: null, autoRenew: true, cancelAt: null, lastError: null, ...over };
}

async function business(over: Partial<BusinessRecord> = {}): Promise<BusinessRecord> {
  return db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", status: "active", plan: "monitor", ownerVerifiedAt: new Date().toISOString(), ownerEmail: "jan@bakkerijdevries.nl", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_main", ...over });
}

beforeEach(() => {
  db = new MemDb();
  setDb(db);
  registrar = new MockRegistrar();
  setRegistrar(registrar);
});

describe("names", () => {
  it("suggests the business name on .nl first, then variants and other extensions", () => {
    const s = suggestDomains("Bakkerij Café de Vries", "Haarlem");
    expect(s[0]).toBe("bakkerijcafedevries.nl");
    expect(s).toContain("bakkerij-cafe-de-vries.nl");
    expect(s).toContain("bakkerijcafedevrieshaarlem.nl");
    expect(s).toContain("bakkerijcafedevries.eu");
    expect(new Set(s).size).toBe(s.length);
  });

  it("offers .eu only to a business in the EU/EEA", () => {
    expect(suggestDomains("Bakkerij", "Haarlem", 6, "NL")).toContain("bakkerij.eu");
    expect(suggestDomains("Bakkerij", "London", 6, "GB")).not.toContain("bakkerij.eu");
    expect(tldAllowed("eu", "NO")).toBe(true);
    expect(tldAllowed("eu", "GB")).toBe(false);
    expect(tldAllowed("com", "GB")).toBe(true);
  });

  it("accepts what an owner types and refuses what we do not sell", () => {
    expect(parseDomain(" https://www.Bakkerij-DeVries.NL/ ")).toEqual({ name: "bakkerij-devries.nl", label: "bakkerij-devries", tld: "nl" });
    expect(parseDomain("bakkerij.de")).toBeNull();
    expect(parseDomain("-bakker.nl")).toBeNull();
    expect(parseDomain("xn--bakker.nl")).toBeNull();
    expect(parseDomain("sub.bakker.nl")).toBeNull();
    expect(parseDomain("b.nl")).toBeNull();
  });
});

describe("holder", () => {
  it("prefills from the business and its facts, leaving the contact person to the owner", () => {
    const d = holderDraft({ name: "Bakkerij De Vries", place: "Haarlem", ownerEmail: "jan@x.nl" }, { address: "Kerkstraat 12a, Haarlem", postcode: "2011AB", phone: "023 123 4567", email: null });
    expect(d).toMatchObject({ company: "Bakkerij De Vries", street: "Kerkstraat", houseNumber: "12a", postcode: "2011AB", city: "Haarlem", email: "jan@x.nl", firstName: "", lastName: "" });
    expect(splitStreet("Dorpsweg")).toEqual(["Dorpsweg", ""]);
  });

  it("requires every field and a phone number it can read, and tidies the postcode", () => {
    const base = { company: "B", firstName: "Jan", lastName: "Vries", street: "Kerkstraat", houseNumber: "12", postcode: "2011ab", city: "Haarlem", phone: "023-1234567", email: "Jan@X.nl" };
    const ok = parseHolder(base, "NL", "12345678");
    expect(ok).toMatchObject({ ok: true, holder: { postcode: "2011 AB", phone: "+31231234567", email: "jan@x.nl", country: "NL", kvk: "12345678" } });
    expect(parseHolder({ ...base, lastName: " " }, "NL", null)).toEqual({ ok: false, error: "incomplete" });
    expect(parseHolder({ ...base, phone: "12" }, "NL", null)).toEqual({ ok: false, error: "phone" });
  });

  it("splits a phone number the way Openprovider wants it", () => {
    expect(splitPhone("+31612345678")).toEqual({ country_code: "+31", area_code: "6", subscriber_number: "12345678" });
    expect(splitPhone("+31231234567")).toEqual({ country_code: "+31", area_code: "23", subscriber_number: "1234567" });
  });
});

describe("price and rules", () => {
  it("shows the price with and without btw, and stripe:setup creates the same yearly price", async () => {
    expect(inclVat(DOMAIN_PRICE_EUR_PER_YEAR)).toBe(30.25);
    const setup = await readFile(path.resolve(__dirname, "../../../apps/web/scripts/stripe-setup.mjs"), "utf8");
    const line = setup.split("\n").find((l) => l.includes("vidalo_domain_eur"))!;
    expect(line).toContain(`amount: ${DOMAIN_PRICE_EUR_PER_YEAR * 100}`);
    expect(line).toContain(`interval: "year"`);
    expect(line).toContain(`vidalo_domain_eur_${DOMAIN_PRICE_EUR_PER_YEAR}_year`);
  });

  it("only a proven owner of a paying business without a live own domain may buy", async () => {
    expect(domainBuyRefusal(await business())).toBeNull();
    expect(domainBuyRefusal(await business({ slug: "a", ownerVerifiedAt: null }))).toBe("not_verified");
    expect(domainBuyRefusal(await business({ slug: "b", status: "scanned" }))).toBe("not_paying");
    expect(domainBuyRefusal(await business({ slug: "c", factsHost: "feiten.devries.nl", factsHostVerifiedAt: new Date().toISOString() }))).toBe("own_domain_live");
    expect(domainBuyRefusal(await business({ slug: "d", factsHost: "x.feiten.vidalo.io", factsHostVerifiedAt: new Date().toISOString() }))).toBeNull();
    expect(domainBuyRefusal(await business({ slug: "e", domainRegistration: registration({ status: "registered" }) }))).toBe("already");
    expect(domainBuyRefusal(await business({ slug: "f", domainRegistration: registration({ status: "checkout" }) }))).toBeNull();
  });

  it("the status line goes requested → registered → live", () => {
    const b = { factsHost: null as string | null, factsHostVerifiedAt: null as string | null, domainRegistration: registration({ status: "paid" }) };
    expect(domainState(b)).toBe("requested");
    b.domainRegistration = registration({ status: "registered" });
    expect(domainState(b)).toBe("registered");
    expect(domainState({ ...b, factsHost: "feiten.bakkerijdevries.nl", factsHostVerifiedAt: new Date().toISOString() })).toBe("live");
    expect(domainState({ ...b, domainRegistration: null })).toBe("none");
  });

  it("the transfer code stays available after not renewing, until the domain expires", () => {
    const now = new Date();
    const exp = new Date(now.getTime() + 100 * DAY).toISOString();
    expect(domainOptions(registration({ status: "registered", expiresAt: exp }), now)).toEqual({ canCancel: true, canUndoCancel: false, canGetAuthCode: true });
    expect(domainOptions(registration({ status: "registered", expiresAt: exp, cancelAt: exp }), now)).toEqual({ canCancel: false, canUndoCancel: true, canGetAuthCode: true });
    expect(domainOptions(registration({ status: "ended", expiresAt: exp }), now).canGetAuthCode).toBe(true);
    expect(domainOptions(registration({ status: "ended", expiresAt: new Date(now.getTime() - DAY).toISOString() }), now).canGetAuthCode).toBe(false);
    expect(domainOptions(registration({ status: "paid" }), now)).toEqual({ canCancel: false, canUndoCancel: false, canGetAuthCode: false });
  });

  it("one renewal reminder, 30 days before, and none when not renewing", () => {
    const now = new Date("2027-10-15T10:00:00Z");
    const reg = registration({ status: "registered", expiresAt: "2027-11-09T12:00:00.000Z" });
    expect(dueDomainReminder(reg, [], now)).toBe(true);
    expect(dueDomainReminder(reg, [{ type: "mail.domain_renewal", payload: { until: reg.expiresAt } }], now)).toBe(false);
    expect(dueDomainReminder(reg, [], new Date("2027-09-01T00:00:00Z"))).toBe(false);
    expect(dueDomainReminder({ ...reg, cancelAt: reg.expiresAt }, [], now)).toBe(false);
    expect(dueDomainReminder({ ...reg, autoRenew: false }, [], now)).toBe(false);
  });

  it("a year on keeps the day, also from 29 February", () => {
    expect(plusYear("2026-11-09T12:00:00.000Z")).toBe("2027-11-09T12:00:00.000Z");
    expect(plusYear("2028-02-29T00:00:00.000Z")).toBe("2029-02-28T00:00:00.000Z");
  });

  it("not renewing and changing your mind go through Stripe and the registrar", async () => {
    const calls: [string, boolean][] = [];
    const api: SubscriptionApi = { setCancelAtPeriodEnd: async (id, c) => (calls.push([id, c]), { periodEnd: new Date("2027-11-09T12:00:00Z") }), pause: async () => {}, resume: async () => {} };
    const b = await business({ domainRegistration: registration({ status: "registered", stripeSubscriptionId: "sub_dom", expiresAt: new Date(Date.now() + 200 * DAY).toISOString() }) });
    expect(await cancelDomain(db, api, b)).toEqual({ ok: true, at: "2027-11-09T12:00:00.000Z" });
    const after = (await db.getBusiness(b.id))!;
    expect(after.domainRegistration).toMatchObject({ cancelAt: "2027-11-09T12:00:00.000Z", autoRenew: false });
    expect((await jobs("domain_autorenew")).map((j) => j.payload.on)).toEqual([false]);
    expect(await undoDomainCancel(db, api, after)).toMatchObject({ ok: true });
    expect((await db.getBusiness(b.id))!.domainRegistration).toMatchObject({ cancelAt: null, autoRenew: true });
    expect(calls).toEqual([["sub_dom", true], ["sub_dom", false]]);
    expect((await db.getBusiness(b.id))!.stripeSubscriptionId).toBe("sub_main");
  });
});

describe("webhook", () => {
  const paidSession = (b: BusinessRecord, over: Record<string, unknown> = {}) => ({ id: "cs_dom", object: "checkout.session", payment_status: "paid", customer: "cus_1", subscription: "sub_dom", consent: { terms_of_service: "accepted" }, metadata: { businessId: b.id, plan: "domain", domain: "bakkerijdevries.nl" }, ...over });

  it("a paid domain checkout queues the registration and leaves the plan and status alone", async () => {
    const b = await business({ domainRegistration: registration() });
    expect(await handleStripeEvent(evt("checkout.session.completed", paidSession(b)))).toBe("domain_paid");
    const after = (await db.getBusiness(b.id))!;
    expect(after).toMatchObject({ status: "active", plan: "monitor", stripeSubscriptionId: "sub_main" });
    expect(after.domainRegistration).toMatchObject({ status: "paid", stripeSubscriptionId: "sub_dom", checkoutSessionId: "cs_dom" });
    expect(await jobs("domain_register")).toHaveLength(1);
    expect(await jobs("setup")).toHaveLength(0);
    const ev = (await db.listEvents(b.id, 50)).find((e) => e.type === "domain.paid");
    expect(ev?.payload.termsConsent).toBe("accepted");
  });

  it("a bank debit waits; a session for another name goes to support", async () => {
    const b = await business({ domainRegistration: registration() });
    expect(await handleStripeEvent(evt("checkout.session.completed", paidSession(b, { payment_status: "unpaid" })))).toBe("payment_processing");
    expect(await jobs("domain_register")).toHaveLength(0);
    expect(await handleStripeEvent(evt("checkout.session.async_payment_succeeded", paidSession(b, { metadata: { businessId: b.id, plan: "domain", domain: "andere.nl" } })))).toBe("ignored");
    expect((await jobs("operator_task")).map((j) => j.payload.reason)).toEqual(["domain_paid_unmatched"]);
  });

  it("a failed renewal turns auto-renew off and mails the owner once", async () => {
    const b = await business({ domainRegistration: registration({ status: "registered", stripeSubscriptionId: "sub_dom", registrarId: "1" }) });
    const invoice = { id: "in_1", object: "invoice", customer: "cus_1", attempt_count: 1, parent: { subscription_details: { subscription: "sub_dom", metadata: { businessId: b.id, plan: "domain" } } } };
    expect(await handleStripeEvent(evt("invoice.payment_failed", invoice))).toBe("domain_payment_failed");
    expect(await handleStripeEvent(evt("invoice.payment_failed", { ...invoice, attempt_count: 2 }))).toBe("domain_payment_failed");
    expect((await jobs("domain_autorenew")).map((j) => j.payload.on)).toEqual([false]);
    expect((await jobs("email")).map((j) => j.payload.kind)).toEqual(["domain_payment_failed"]);
    expect((await db.getBusiness(b.id))!.status).toBe("active");
  });

  it("paying the renewal moves the date a year on and turns auto-renew back on", async () => {
    const b = await business({ domainRegistration: registration({ status: "registered", stripeSubscriptionId: "sub_dom", expiresAt: "2027-11-09T12:00:00.000Z", autoRenew: false }) });
    // Found by the subscription id alone, without metadata.
    expect(await handleStripeEvent(evt("invoice.paid", { id: "in_2", object: "invoice", customer: "cus_1", subscription: "sub_dom", billing_reason: "subscription_cycle" }))).toBe("domain_renewed");
    expect((await db.getBusiness(b.id))!.domainRegistration).toMatchObject({ expiresAt: "2028-11-09T12:00:00.000Z", autoRenew: true });
    expect((await jobs("domain_autorenew")).map((j) => j.payload.on)).toEqual([true]);
  });

  it("the add-on ending never churns the business, and Monthly ending leaves the domain", async () => {
    const b = await business({ domainRegistration: registration({ status: "registered", stripeSubscriptionId: "sub_dom", registrarId: "1", expiresAt: "2027-11-09T12:00:00.000Z" }) });
    expect(await handleStripeEvent(evt("customer.subscription.deleted", { id: "sub_dom", object: "subscription", customer: "cus_1", metadata: { businessId: b.id, plan: "domain" } }))).toBe("domain_ended");
    let after = (await db.getBusiness(b.id))!;
    expect(after.status).toBe("active");
    expect(after.domainRegistration).toMatchObject({ status: "ended", autoRenew: false });
    expect((await jobs("email")).map((j) => j.payload.kind)).toEqual(["domain_ended"]);
    expect(await handleStripeEvent(evt("customer.subscription.deleted", { id: "sub_main", object: "subscription", customer: "cus_1", metadata: { businessId: b.id } }))).toBe("churned");
    after = (await db.getBusiness(b.id))!;
    expect(after.status).toBe("churned");
    expect(after.domainRegistration?.status).toBe("ended");
  });

  it("the same payment reported twice (completed, then async succeeded) queues one registration", async () => {
    const b = await business({ domainRegistration: registration() });
    expect(await handleStripeEvent(evt("checkout.session.completed", paidSession(b)))).toBe("domain_paid");
    expect(await handleStripeEvent(evt("checkout.session.async_payment_succeeded", paidSession(b)))).toBe("domain_paid");
    expect(await handleStripeEvent(evt("checkout.session.completed", paidSession(b), "evt_same"))).toBe("domain_paid");
    expect(await handleStripeEvent(evt("checkout.session.completed", paidSession(b), "evt_same"))).toBe("duplicate");
    expect(await jobs("domain_register")).toHaveLength(1);
  });

  it("a second paid session for the same name goes to support, not silently onto the first", async () => {
    const b = await business({ domainRegistration: registration() });
    expect(await handleStripeEvent(evt("checkout.session.completed", paidSession(b)))).toBe("domain_paid");
    expect(await handleStripeEvent(evt("checkout.session.completed", paidSession(b, { id: "cs_dom2", subscription: "sub_dom2" })))).toBe("ignored");
    expect((await jobs("operator_task")).map((j) => j.payload.reason)).toEqual(["domain_paid_unmatched"]);
    expect((await db.getBusiness(b.id))!.domainRegistration?.stripeSubscriptionId).toBe("sub_dom");
  });

  it("another domain subscription ending or failing leaves the live registration alone", async () => {
    const b = await business({ domainRegistration: registration({ status: "registered", stripeSubscriptionId: "sub_dom", registrarId: "1" }) });
    expect(await handleStripeEvent(evt("customer.subscription.deleted", { id: "sub_old", object: "subscription", metadata: { businessId: b.id, plan: "domain", domain: "bakkerijdevries.nl" } }))).toBe("ignored");
    expect(await handleStripeEvent(evt("invoice.payment_failed", { id: "in_x", object: "invoice", attempt_count: 1, parent: { subscription_details: { subscription: "sub_old", metadata: { businessId: b.id, plan: "domain" } } } }))).toBe("ignored");
    expect((await db.getBusiness(b.id))!.domainRegistration).toMatchObject({ status: "registered", autoRenew: true });
    expect(await jobs("domain_autorenew")).toHaveLength(0);
    expect(await jobs("email")).toHaveLength(0);
  });

  it("not renewing, set in Stripe, lands on the registration", async () => {
    const b = await business({ domainRegistration: registration({ status: "registered", stripeSubscriptionId: "sub_dom" }) });
    expect(await handleStripeEvent(evt("customer.subscription.updated", { id: "sub_dom", object: "subscription", status: "active", cancel_at_period_end: true, cancel_at: 1825833600, metadata: { businessId: b.id, plan: "domain" } }))).toBe("domain_synced");
    expect((await db.getBusiness(b.id))!.domainRegistration?.cancelAt).toBe(new Date(1825833600 * 1000).toISOString());
    expect((await db.getBusiness(b.id))!.cancelAt).toBeNull();
  });
});

describe("registration job", () => {
  it("registers once, points feiten. at Vidalo, mails the owner and moves the facts page", async () => {
    const b = await business({ factsHost: "bakkerij-de-vries-haarlem.feiten.vidalo.io", factsHostVerifiedAt: new Date().toISOString(), domainRegistration: registration({ status: "paid" }) });
    // checkFactsHost answers without DNS in mock mode.
    const prev = process.env.VIDALO_MOCK;
    process.env.VIDALO_MOCK = "1";
    try {
      expect(await runDomainRegistration(b.id)).toEqual({ result: "live" });
    } finally {
      process.env.VIDALO_MOCK = prev;
    }
    const after = (await db.getBusiness(b.id))!;
    expect(after.domainRegistration).toMatchObject({ status: "registered", registrarId: "mock-bakkerijdevries.nl", holderHandle: expect.stringMatching(/^MOCK-/) });
    expect(after.factsHost).toBe("feiten.bakkerijdevries.nl");
    expect(registrar.domains.get("bakkerijdevries.nl")?.cnames.get("feiten.bakkerijdevries.nl")).toBe("feiten.vidalo.io");
    expect(await jobs("publish")).toHaveLength(1);
    const types = (await db.listEvents(b.id, 50)).map((e) => e.type);
    expect(types).toContain("mail.domain_registered");
    expect(types).toContain("domain.live");
    // Run again: nothing registers twice.
    expect(await runDomainRegistration(b.id)).toEqual({ result: "live" });
    expect(registrar.domains.size).toBe(1);
  });

  it("a hiccup is retried; the registration is not repeated", async () => {
    const b = await business({ domainRegistration: registration({ status: "paid" }) });
    registrar.failNext = 1;
    await expect(runDomainRegistration(b.id)).rejects.toThrow(/temporarily/);
    expect((await db.getBusiness(b.id))!.domainRegistration).toMatchObject({ status: "paid", lastError: expect.stringMatching(/temporarily/) });
    expect(await jobs("operator_task")).toHaveLength(0);
    const out = await runDomainRegistration(b.id);
    expect(out.result === "registered" || out.result === "live").toBe(true);
    expect((await db.getBusiness(b.id))!.domainRegistration?.status).toBe("registered");
  });

  it("a failure after registering (DNS step) is retried without registering again", async () => {
    const b = await business({ domainRegistration: registration({ status: "paid" }) });
    let registers = 0;
    const realRegister = registrar.register.bind(registrar);
    registrar.register = async (name, handle) => (registers++, realRegister(name, handle));
    const realCname = registrar.pointCname.bind(registrar);
    let cnameFails = 1;
    registrar.pointCname = async (name, host, target) => {
      if (cnameFails-- > 0) throw new Error("dns temporarily unavailable");
      return realCname(name, host, target);
    };
    await expect(runDomainRegistration(b.id)).rejects.toThrow(/dns temporarily/);
    expect((await db.getBusiness(b.id))!.domainRegistration).toMatchObject({ status: "paid", registrarId: "mock-bakkerijdevries.nl" });
    const out = await runDomainRegistration(b.id);
    expect(out.result === "registered" || out.result === "live").toBe(true);
    expect(registers).toBe(1);
    expect((await db.getBusiness(b.id))!.domainRegistration?.status).toBe("registered");
    expect(await jobs("operator_task")).toHaveLength(0);
  });

  it("a registration whose answer got lost is adopted on the retry, never reported as refused", async () => {
    const b = await business({ domainRegistration: registration({ status: "paid" }) });
    registrar.loseNextAnswer = true;
    await expect(runDomainRegistration(b.id)).rejects.toThrow(/answer lost/);
    const out = await runDomainRegistration(b.id);
    expect(out.result === "registered" || out.result === "live").toBe(true);
    expect((await db.getBusiness(b.id))!.domainRegistration).toMatchObject({ status: "registered", registrarId: "mock-bakkerijdevries.nl" });
    expect(await jobs("operator_task")).toHaveLength(0);
  });

  it("after the last attempt support is told and the status stays paid", async () => {
    const b = await business({ domainRegistration: registration({ status: "paid" }) });
    registrar.failNext = 1;
    await expect(runDomainRegistration(b.id, { lastAttempt: true })).rejects.toThrow();
    expect((await jobs("operator_task")).map((j) => j.payload.reason)).toEqual(["domain_register_stuck"]);
    expect((await jobs("email")).map((j) => j.payload.to)).toEqual(["support@vidalo.io"]);
  });

  it("a refusal fails the registration, tells the owner the money comes back, and gives support a task", async () => {
    const b = await business({ domainRegistration: registration({ status: "paid", name: "weigerbakker.nl" }) });
    expect(await runDomainRegistration(b.id)).toEqual({ result: "refused", code: "refused" });
    expect((await db.getBusiness(b.id))!.domainRegistration?.status).toBe("failed");
    expect((await jobs("operator_task")).map((j) => j.payload.reason)).toEqual(["domain_register_refused"]);
    expect((await jobs("email")).map((j) => j.payload.to)).toEqual(["support@vidalo.io"]);
    expect((await db.listEvents(b.id, 50)).map((e) => e.type)).toContain("mail.domain_failed");
  });

  it("without a registrar nothing is registered, the owner is not told it failed, and support hears after the last try", async () => {
    setRegistrar(null);
    const prev = process.env.VIDALO_MOCK;
    delete process.env.VIDALO_MOCK;
    try {
      const b = await business({ domainRegistration: registration({ status: "paid" }) });
      await expect(runDomainRegistration(b.id)).rejects.toThrow(/no registrar/);
      await expect(runDomainRegistration(b.id, { lastAttempt: true })).rejects.toThrow(/no registrar/);
      expect((await db.getBusiness(b.id))!.domainRegistration?.status).toBe("paid");
      expect((await jobs("operator_task")).map((j) => j.payload.reason)).toEqual(["domain_register_stuck"]);
    } finally {
      process.env.VIDALO_MOCK = prev;
    }
  });

  it("only a paid registration is registered", async () => {
    const b = await business({ domainRegistration: registration({ status: "checkout" }) });
    expect(await runDomainRegistration(b.id)).toEqual({ result: "skipped", reason: "status_checkout" });
    expect(registrar.domains.size).toBe(0);
  });

  it("auto-renew is switched at the registrar", async () => {
    const b = await business({ domainRegistration: registration({ status: "registered", registrarId: "1" }) });
    expect(await setDomainAutoRenew(b.id, false)).toEqual({ done: true });
    expect(registrar.domains.get("bakkerijdevries.nl")?.autoRenew).toBe(false);
    expect((await db.getBusiness(b.id))!.domainRegistration?.autoRenew).toBe(false);
  });
});

describe("mails", () => {
  it("every domain mail exists in both languages and names the domain", () => {
    for (const kind of DOMAIN_MAIL_KINDS) {
      for (const lang of ["nl", "en"] as const) {
        const m = domainEmail(kind, { domain: "bakkerijdevries.nl", lang, at: "2027-11-09T12:00:00.000Z", code: "ABC-123" });
        expect(m.subject).toContain("bakkerijdevries.nl");
        expect(m.text).not.toMatch(/!/);
        if (kind === "domain_authcode") expect(m.text).toContain("ABC-123");
      }
    }
    expect(domainEmail("domain_renewal", { domain: "x.nl", lang: "nl", at: "2027-11-09T12:00:00.000Z" }).text).toContain("€25");
  });
});
