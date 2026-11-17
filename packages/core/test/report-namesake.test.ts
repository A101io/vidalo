/**
 * Feature 005, CMP-04 and CMP-08 on the report page: a business Google does not list was checked on its name and town, so the
 * report says an answer may be about a namesake. Online businesses get it without naming Google. Not for a listed business,
 * a demo, or a business read by nothing. `notListedOf` is the page's own signal (QA-R2-05).
 */
import { describe, expect, it } from "vitest";
import { copy, copyFor } from "../src/copy/index.js";
import { buildReportView, notListedOf } from "../../../apps/web/lib/report";
import { demoOnlineReport, demoReport } from "../../../apps/web/lib/demo";

describe("the namesake line on the report", () => {
  it("is there for a local business Google does not list, NL and EN", () => {
    expect(buildReportView(demoReport(), copy, { notListed: true }).namesake).toBe(copy.result.namesake);
    expect(buildReportView(demoReport(), copyFor("en"), { notListed: true }).namesake).toBe(copyFor("en").result.namesake);
  });

  it("is there without Google for an online business", () => {
    expect(buildReportView(demoOnlineReport(), copy, { notListed: true }).namesake).toBe(copy.result.namesakeOnline);
  });

  it("is not there for a business read by nothing", () => {
    const r = demoOnlineReport();
    r.profile = { mode: "online", source: "fallback", offer: null, audience: null, category: null } as typeof r.profile;
    expect(buildReportView(r, copy, { notListed: true }).namesake).toBeNull();
  });

  it("is not there for a listed business or a demo", () => {
    expect(buildReportView(demoReport(), copy, { notListed: false, googlePlaceId: "x" }).namesake).toBeNull();
    expect(buildReportView(demoReport(), copy).namesake).toBeNull();
  });

  it("the page's signal: a real business record without a place id", () => {
    expect(notListedOf({ googlePlaceId: null })).toBe(true);
    expect(notListedOf({ googlePlaceId: "ChIJ" })).toBe(false);
    expect(notListedOf(null)).toBe(false);
    expect(notListedOf(undefined)).toBe(false);
  });
});
