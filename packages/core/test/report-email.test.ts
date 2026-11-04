import { describe, expect, it } from "vitest";
import { REPORT_EMAIL_EVENT, reportEmailCheck } from "../src/shared/report-email";

describe("report mail request", () => {
  const run = { businessId: "b1" };

  it("sends for a scan run of the named business", () => {
    expect(reportEmailCheck(run, "b1", "s1", [])).toBe("send");
  });

  it("refuses a scan run that belongs to another business, or none", () => {
    expect(reportEmailCheck(run, "b2", "s1", [])).toBe("mismatch");
    expect(reportEmailCheck(null, "b1", "s1", [])).toBe("mismatch");
  });

  it("mails once per scan run", () => {
    const asked = [{ type: REPORT_EMAIL_EVENT, payload: { scanRunId: "s1" } }];
    expect(reportEmailCheck(run, "b1", "s1", asked)).toBe("duplicate");
    expect(reportEmailCheck(run, "b1", "s2", asked)).toBe("send");
    expect(reportEmailCheck(run, "b1", "s1", [{ type: "other", payload: { scanRunId: "s1" } }])).toBe("send");
  });
});
