import { describe, expect, it } from "vitest";
import { CHECK_COOKIE_TTL_MS, readCheckCookie, signCheckCookie, freeCheckEvents, MARKETING_CONSENT_EVENT, MARKETING_CONSENT_TEXT, parseFreeCheckRequest, REPORT_EMAIL_EVENT, requesterFromEvents } from "../src/shared/free-check";

describe("the free check's address and news box", () => {
  it("normalises the address and refuses what is not one", () => {
    expect(parseFreeCheckRequest({ email: "  Naam@Bedrijf.NL " })).toEqual({ ok: true, email: "naam@bedrijf.nl", marketing: false });
    for (const bad of ["", "naam", "naam@bedrijf", "naam @bedrijf.nl", "a".repeat(250) + "@x.nl", undefined]) expect(parseFreeCheckRequest({ email: bad }).ok, String(bad)).toBe(false);
  });

  it("the news box is off unless ticked with the form's own value", () => {
    expect(parseFreeCheckRequest({ email: "a@b.nl", marketing: "ja" })).toMatchObject({ marketing: true });
    expect(parseFreeCheckRequest({ email: "a@b.nl", marketing: "on" })).toMatchObject({ marketing: false });
    expect(parseFreeCheckRequest({ email: "a@b.nl" })).toMatchObject({ marketing: false });
  });

  it("stores the request, and the consent only when given, with the server's sentence in the page's language", () => {
    const plain = freeCheckEvents({ email: "a@b.nl", marketing: false }, "nl");
    expect(plain.map((e) => e.type)).toEqual([REPORT_EMAIL_EVENT]);
    expect(plain[0]!.payload).toEqual({ email: "a@b.nl", lang: "nl", marketing: false, via: "check" });
    const news = freeCheckEvents({ email: "a@b.nl", marketing: true }, "en");
    expect(news.map((e) => e.type)).toEqual([REPORT_EMAIL_EVENT, MARKETING_CONSENT_EVENT]);
    expect(news[1]!.payload).toEqual({ email: "a@b.nl", lang: "en", text: MARKETING_CONSENT_TEXT.en });
  });

  it("the requester is the latest address that asked; nobody is null", () => {
    expect(requesterFromEvents([])).toBeNull();
    const events = [
      { type: REPORT_EMAIL_EVENT, payload: { email: "later@b.nl", lang: "en" } },
      { type: REPORT_EMAIL_EVENT, payload: { email: "eerder@b.nl", lang: "nl" } },
    ];
    expect(requesterFromEvents(events)).toEqual({ email: "later@b.nl", lang: "en" });
  });

  it("the cookie between form and pick page round-trips, and is refused when forged or expired", () => {
    const now = 1_700_000_000_000;
    const v = signCheckCookie("s", { email: "a@b.nl", marketing: true }, now);
    expect(v).not.toContain("a@b.nl");
    expect(readCheckCookie("s", v, now + 1000)).toEqual({ email: "a@b.nl", marketing: true });
    expect(readCheckCookie("other", v, now)).toBeNull();
    expect(readCheckCookie("s", v + "x", now)).toBeNull();
    expect(readCheckCookie("s", v, now + CHECK_COOKIE_TTL_MS + 1)).toBeNull();
    expect(readCheckCookie("s", undefined, now)).toBeNull();
  });
});

describe("a finished free scan mails the report to who asked", () => {
  it("enqueues the baseline mail to the requester, and not for a business with an owner", async () => {
    const { withMockDb } = await import("../src/db");
    const { prepareBusiness } = await import("../src/scanner/onboard");
    const { runScanWithProgress } = await import("../src/scanner/progress");
    const db = withMockDb();
    const run = async (ownerEmail: string | null) => {
      const { business } = await prepareBusiness({ name: ownerEmail ? "Kapper Met Eigenaar" : "Kapper Zonder", place: "Haarlem", db });
      if (ownerEmail) await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, ownerEmail });
      for (const ev of freeCheckEvents({ email: "vraagt@proef.nl", marketing: false }, "en")) await db.logEvent(business.id, ev.type, ev.payload);
      const state = { token: `${business.id}_abc`, businessId: business.id, scanRunId: null, status: "queued" as const, stage: "understand" as const, profile: null, questions: [], engines: [], steps: [], error: null };
      const report = await runScanWithProgress(state, { kind: "free", engines: ["chatgpt"], db });
      const jobs: { kind: string; payload: Record<string, unknown> }[] = [];
      for (let j = await db.claimJob(["email"]); j; j = await db.claimJob(["email"])) {
        jobs.push(j);
        await db.completeJob(j.id);
      }
      return { report, jobs };
    };
    const asked = await run(null);
    expect(asked.jobs.map((j) => j.payload)).toEqual([{ template: "baseline", scanRunId: asked.report!.scanRunId, businessId: asked.report!.business.id, to: "vraagt@proef.nl", lang: "en" }]);
    const owned = await run("eigenaar@proef.nl");
    expect(owned.jobs).toEqual([]);
  });
});
