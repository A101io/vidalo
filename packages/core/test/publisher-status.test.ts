import { describe, expect, it } from "vitest";
import { factsPageStatus, siteCheckView } from "../src/publisher/status";
import type { GoogleInspection } from "../src/db/types";

const inspection = (verdict: string, at = "2026-10-20T08:00:00.000Z"): GoogleInspection => ({ at, verdict, coverageState: null, indexingState: null, pageFetchState: null, robotsTxtState: null, lastCrawlTime: null, googleCanonical: null });

describe("factsPageStatus", () => {
  it("is not published and not checked without a channel or index row", () => {
    expect(factsPageStatus(null, null)).toEqual({ url: null, published: "no", publishedAt: null, google: "not_checked", googleCheckedAt: null, googleIndexedAt: null });
  });
  it("a channel that was never synced is not published", () => {
    expect(factsPageStatus({ url: "https://feiten.x.nl/", status: "pending", lastSyncedAt: null }, null).published).toBe("no");
  });
  it("published but the host does not point to Vidalo yet", () => {
    const s = factsPageStatus({ url: "https://feiten.x.nl/", status: "pending", lastSyncedAt: "2026-10-01T10:00:00.000Z" }, null);
    expect(s).toMatchObject({ published: "waiting_dns", publishedAt: "2026-10-01T10:00:00.000Z", url: "https://feiten.x.nl/" });
  });
  it("live and indexed, with the check date and the first indexed date", () => {
    const s = factsPageStatus({ url: "https://feiten.x.nl/", status: "synced", lastSyncedAt: "2026-10-01T10:00:00.000Z" }, { inspection: inspection("PASS"), indexedAt: "2026-10-05T08:00:00.000Z" });
    expect(s).toMatchObject({ published: "live", google: "indexed", googleCheckedAt: "2026-10-20T08:00:00.000Z", googleIndexedAt: "2026-10-05T08:00:00.000Z" });
  });
  it("the latest verdict decides, not an earlier indexed date", () => {
    expect(factsPageStatus(null, { inspection: inspection("NEUTRAL"), indexedAt: "2026-10-05T08:00:00.000Z" }).google).toBe("not_indexed");
  });
  it("a row without an inspection is not checked yet", () => {
    expect(factsPageStatus(null, { inspection: null, indexedAt: null }).google).toBe("not_checked");
  });
});

const done = (payload: Record<string, unknown>, at = "2026-10-20T09:00:00.000Z") => ({ type: "sitecheck.done", payload, at });

describe("siteCheckView", () => {
  it("not checked without an event", () => {
    expect(siteCheckView([{ type: "facts_page.published", payload: {}, at: "x" }])).toEqual({ state: "not_checked" });
  });
  it("no_domain when the last check was skipped", () => {
    expect(siteCheckView([{ type: "sitecheck.skipped", payload: { reason: "no_domain" }, at: "2026-10-20T09:00:00.000Z" }])).toEqual({ state: "no_domain", at: "2026-10-20T09:00:00.000Z" });
  });
  it("takes the newest event (list is newest first)", () => {
    const v = siteCheckView([done({ domain: "new.nl", robotsStatus: 200, homepageStatus: 200, issues: [] }, "2026-10-20T00:00:00.000Z"), done({ domain: "old.nl", robotsStatus: 200, homepageStatus: 200, issues: [] }, "2026-09-20T00:00:00.000Z")]);
    expect(v).toMatchObject({ state: "checked", domain: "new.nl", at: "2026-10-20T00:00:00.000Z" });
  });
  it("a clean site: every robot allowed, no noindex, business data, phone fine", () => {
    const v = siteCheckView([done({ domain: "x.nl", robotsStatus: 404, homepageStatus: 200, issues: [] })]);
    if (v.state !== "checked") throw new Error("expected checked");
    expect(v.robots.every((r) => r.allowed === true)).toBe(true);
    expect(v).toMatchObject({ noindex: false, businessData: true, phoneOk: true, issues: [] });
  });
  it("marks blocked robots, noindex and a wrong phone", () => {
    const issues = [
      { kind: "robots_blocked", robots: ["PerplexityBot"], engines: ["perplexity"], robotsUrl: "https://x.nl/robots.txt" },
      { kind: "noindex", via: "meta", pageUrl: "https://x.nl/" },
      { kind: "phone_mismatch", found: "023 000 00 00", expected: "023 123 45 67", pageUrl: "https://x.nl/" },
    ];
    const v = siteCheckView([done({ domain: "x.nl", robotsStatus: 200, homepageStatus: 200, issues })]);
    if (v.state !== "checked") throw new Error("expected checked");
    expect(v.robots.find((r) => r.token === "PerplexityBot")?.allowed).toBe(false);
    expect(v.robots.find((r) => r.token === "OAI-SearchBot")?.allowed).toBe(true);
    expect(v).toMatchObject({ noindex: true, businessData: true, phoneOk: false });
    expect(v.issues).toHaveLength(3);
  });
  it("no business data: phone cannot be compared", () => {
    const v = siteCheckView([done({ domain: "x.nl", robotsStatus: 200, homepageStatus: 200, issues: [{ kind: "no_business_data", pageUrl: "https://x.nl/" }] })]);
    expect(v).toMatchObject({ businessData: false, phoneOk: null });
  });
  it("unreadable robots.txt and homepage read as unknown, not as fine", () => {
    const v = siteCheckView([done({ domain: "x.nl", robotsStatus: null, homepageStatus: 503, issues: [] })]);
    if (v.state !== "checked") throw new Error("expected checked");
    expect(v.robots.every((r) => r.allowed === null)).toBe(true);
    expect(v).toMatchObject({ noindex: null, businessData: null, phoneOk: null });
  });
});
