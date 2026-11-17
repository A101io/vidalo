/**
 * The order confirmation (feature 003, BE-02, ADR-0008, AC-14, AC-15): one mail per Checkout
 * session, from the payment webhook, for every plan, in the buyer's language.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "../src/db";
import { setDb } from "../src/shared";
import { COMPANY, CONTACT } from "../src/shared/contact";
import { REQUIRED_MAIL_KINDS, OPTIONAL_MAIL_KINDS } from "../src/shared/mail-prefs";
import { copyFor } from "../src/copy/index";
import { mockCheckoutSession, queueOrderConfirmation, type OrderConfirmationJob, type OrderPlan } from "../src/billing/order-mail";
import { orderConfirmationEmail, sendOrderConfirmation, type OrderData } from "../src/reporter";

const PLANS: OrderPlan[] = ["setup", "monitor", "monitor_addon"];
const LANGS = ["nl", "en"] as const;
const SUBTOTAL: Record<OrderPlan, number> = { setup: 14900, monitor: 19800, monitor_addon: 4900 };

function data(plan: OrderPlan, lang: "nl" | "en", over: Partial<OrderData> = {}): OrderData {
  const subtotal = SUBTOTAL[plan];
  const tax = Math.round(subtotal * 0.21);
  const en = lang === "en";
  return {
    lang,
    business: { name: "Bakkerij De Vries" },
    plan,
    amounts: { subtotal, tax, total: subtotal + tax, currency: "eur" },
    lines: plan === "setup" ? { setup: 14900 } : plan === "monitor" ? { setup: 14900, monthly: 4900 } : { monthly: 4900 },
    paid: true,
    orderedAt: "2026-11-17T10:00:00.000Z",
    ownerVerified: false,
    links: {
      termsUrl: `https://vidalo.ai${en ? "/en/terms" : "/voorwaarden"}`,
      privacyUrl: `https://vidalo.ai${en ? "/en/privacy" : "/privacy"}`,
      accountUrl: `https://vidalo.ai${en ? "/en/app/abonnement" : "/app/abonnement"}`,
    },
    ...over,
  };
}

describe("orderConfirmationEmail", () => {
  for (const plan of PLANS)
    for (const lang of LANGS) {
      it(`${plan} in ${lang}: product, amounts excl. btw, btw, total, renewal, start, terms, company`, () => {
        const O = copyFor(lang).mails.order;
        const P = copyFor(lang).landing.prijs;
        const m = orderConfirmationEmail(data(plan, lang));
        const en = lang === "en";
        // Subject names the product.
        if (plan !== "monitor_addon") expect(m.subject).toContain(P.setup.name);
        if (plan !== "setup") expect(m.subject).toContain(P.monitor.name);
        // Lines, amounts excl. btw, btw with the rate, total.
        const eur = (c: number) => new Intl.NumberFormat(en ? "en-IE" : "nl-NL", { style: "currency", currency: "EUR" }).format(c / 100);
        if (plan !== "monitor_addon") expect(m.text).toContain(O.lineSetup(eur(14900)));
        if (plan !== "setup") expect(m.text).toContain(O.lineMonthly(eur(4900)));
        expect(m.text).toContain(O.subtotal(eur(SUBTOTAL[plan])));
        expect(m.text).toContain(O.vat(eur(Math.round(SUBTOTAL[plan] * 0.21)), "21%"));
        expect(m.text).toContain(O.totalPaid(eur(Math.round(SUBTOTAL[plan] * 1.21))));
        expect(m.text).toContain(O.orderedOn(en ? "17 November 2026" : "17 november 2026"));
        // Renewal or no renewal, then how it starts.
        if (plan === "setup") {
          expect(m.text).toContain(O.termsSetup);
          expect(m.text).not.toContain(O.termsMonthly);
        } else {
          expect(m.text).toContain(O.termsMonthly);
          expect(m.text).toContain(data(plan, lang).links.accountUrl);
          expect(m.text).not.toContain(O.termsSetup);
        }
        expect(m.text).toContain(plan === "monitor_addon" ? O.startNow : O.startAfterProof);
        // Terms with their version, privacy, invoice, in the buyer's language.
        expect(m.text).toContain(O.terms(copyFor(lang).legal.updated));
        expect(m.text).toContain(en ? "https://vidalo.ai/en/terms" : "https://vidalo.ai/voorwaarden");
        expect(m.text).toContain(en ? "https://vidalo.ai/en/privacy" : "https://vidalo.ai/privacy");
        expect(m.html).toContain(`href="${en ? "https://vidalo.ai/en/terms" : "https://vidalo.ai/voorwaarden"}"`);
        expect(m.text).toContain(O.invoice);
        expect(m.text).toContain(O.questions);
        expect(m.text).toContain(CONTACT.phone);
        // The company line, with KvK and btw, in both parts.
        for (const part of [m.text, m.html]) for (const v of [COMPANY.legalName, COMPANY.kvk, COMPANY.vat]) expect(part).toContain(v);
        // Nothing to click through to: no primary button.
        expect(m.html).not.toContain("padding:14px 22px");
        // No Stripe identifiers.
        expect(`${m.text}\n${m.html}`).not.toMatch(/cs_(test|live)_|session_id|invoice\.stripe\.com|\bsess/);
      });
    }

  it("a verified owner hears it starts now; a debit still on its way says so", () => {
    const O = copyFor("nl").mails.order;
    const m = orderConfirmationEmail(data("setup", "nl", { ownerVerified: true, paid: false }));
    expect(m.text).toContain(O.startNow);
    expect(m.text).not.toContain(O.startAfterProof);
    expect(m.text).toContain(O.processing);
    expect(m.text).toContain(O.totalProcessing(new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(180.29)));
  });

  it("without the per-line split it shows Stripe's totals only; another btw rate is not named", () => {
    const O = copyFor("nl").mails.order;
    const m = orderConfirmationEmail(data("monitor", "nl", { lines: null, amounts: { subtotal: 19800, tax: 0, total: 19800, currency: "eur" } }));
    expect(m.text).not.toContain(O.lineSetup("").split(":")[0]!);
    expect(m.text).toContain(O.vat(new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(0), null));
    expect(m.text).not.toContain("21%");
  });

  it("a business name with markup is escaped in the HTML", () => {
    const m = orderConfirmationEmail(data("setup", "nl", { business: { name: `Tonic & "Co" <b>Music</b>` } }));
    expect(m.html).not.toContain("<b>Music");
    expect(m.html).toContain("&lt;b&gt;Music&lt;/b&gt;");
  });

  it("is a required mail: no preference or unsubscribe stops it", () => {
    expect(REQUIRED_MAIL_KINDS).toContain("order_confirmation");
    expect(OPTIONAL_MAIL_KINDS.order_confirmation).toBeUndefined();
  });
});

describe("queueOrderConfirmation and sendOrderConfirmation", () => {
  let db: MemDb;
  beforeEach(() => {
    db = new MemDb();
    setDb(db);
    process.env.VIDALO_OUT_DIR = "out/test-order-mail";
  });

  async function claimEmail(): Promise<OrderConfirmationJob[]> {
    const out: OrderConfirmationJob[] = [];
    for (let j = await db.claimJob(["email"]); j; j = await db.claimJob(["email"])) out.push(j.payload as unknown as OrderConfirmationJob);
    return out;
  }

  it("the mock session is shaped as Stripe's, with 21% btw, paid", () => {
    const s = mockCheckoutSession("monitor", "en", "a@b.nl");
    expect(s).toMatchObject({ payment_status: "paid", amount_subtotal: 19800, amount_total: 23958, total_details: { amount_tax: 4158 }, currency: "eur", locale: "en", metadata: { plan: "monitor" }, customer_details: { email: "a@b.nl" } });
    expect(String(s.id)).toMatch(/^mock_/);
  });

  it("queues one job with the payer's address, the buyer's language and Stripe's amounts; a second call is a duplicate", async () => {
    const b = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", language: "nl" });
    const s = mockCheckoutSession("setup", "en", "Koper@Voorbeeld.nl");
    expect(await queueOrderConfirmation(b, s)).toBe("queued");
    expect(await queueOrderConfirmation(b, s)).toBe("duplicate");
    const jobs = await claimEmail();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ template: "order_confirmation", businessId: b.id, sessionId: s.id, to: "koper@voorbeeld.nl", lang: "en", plan: "setup", paid: true, amounts: { subtotal: 14900, tax: 3129, total: 18029, currency: "eur" } });
    const ev = (await db.listEvents(b.id, 100)).filter((e) => e.type === "order_confirmation.queued");
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev[0]!.payload)).not.toContain("@");
  });

  it("no address, or not an address: nothing queued, no throw", async () => {
    const b = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem" });
    const s = mockCheckoutSession("setup", "nl", "x");
    expect(await queueOrderConfirmation(b, s)).toBe("no_address");
    expect(await queueOrderConfirmation(b, { ...s, customer_details: null })).toBe("no_address");
    expect(await claimEmail()).toHaveLength(0);
  });

  it("sends once per session, to the payer, and logs no address", async () => {
    const b = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", ownerEmail: "eigenaar@bakkerijdevries.nl" });
    const s = mockCheckoutSession("monitor", "nl", "koper@voorbeeld.nl");
    await queueOrderConfirmation(b, s);
    const [job] = await claimEmail();
    const first = await sendOrderConfirmation(job!);
    expect(first).not.toBeNull();
    expect(await sendOrderConfirmation(job!)).toBeNull();
    const sent = (await db.listEvents(b.id, 100)).filter((e) => e.type === "email.order_confirmation");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({ to: "payer", sessionId: s.id });
    expect(JSON.stringify(sent[0]!.payload)).not.toContain("@");
  });

  it("amounts that do not add up to PRICES: no per-line split, and an event says so", async () => {
    const b = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem" });
    const s = { ...mockCheckoutSession("setup", "nl", "koper@voorbeeld.nl"), amount_subtotal: 9900, amount_total: 11979, total_details: { amount_tax: 2079 } };
    await queueOrderConfirmation(b, s);
    const [job] = await claimEmail();
    expect(await sendOrderConfirmation(job!)).not.toBeNull();
    const mm = (await db.listEvents(b.id, 100)).find((e) => e.type === "order_mail.amount_mismatch");
    expect(mm?.payload).toMatchObject({ sessionId: s.id, plan: "setup", expected: 14900, charged: 9900 });
  });
});
