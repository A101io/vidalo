import { describe, expect, it } from "vitest";
import { copyFor } from "../src/copy";

// Review CMP-01: only Vidalo Monthly checks every month; Vidalo Scan checks
// once and then the fixed errors. Every place that says "elke maand" says so.
describe("copy follows the plan", () => {
  for (const lang of ["nl", "en"] as const) {
    const c = copyFor(lang);
    const monthly = lang === "nl" ? "Vidalo Monthly" : "Vidalo Monthly";

    it(`${lang}: /welkom has a Scan variant of step 4 without a monthly report`, () => {
      expect(c.welcome.steps).toHaveLength(4);
      expect(c.welcome.lastStepScan.body).toContain(monthly);
      expect(c.welcome.lastStepScan.body).not.toMatch(lang === "nl" ? /krijg je elke maand/ : /you get a report every month/);
    });

    it(`${lang}: the result page's plan steps mark the monthly check as Monthly`, () => {
      expect(c.result.plan.stepsGreen[2]).toContain(monthly);
      expect(c.result.plan.stepsGrey.recheck(6)).toContain(monthly);
    });

    it(`${lang}: the FAQ answers per plan`, () => {
      const faq = c.landing.vragen.items.find((i) => (lang === "nl" ? /Hoe vaak/ : /How often/).test(i.q))!;
      expect(faq.a).toContain("Vidalo Monthly");
      expect(faq.a).toContain("Vidalo Scan");
    });

    it(`${lang}: the dashboard rail has a Scan text, and a queued check does not promise an hour`, () => {
      expect(c.dashboard.scanOnly.body).toContain(monthly);
      expect(c.dashboard.checkQueued).toMatch(lang === "nl" ? /zodra de controle klaar is, meestal binnen een uur/ : /as soon as the check is done, usually within an hour/);
    });

    it(`${lang}: signed in without a business points to the payer's address and support`, () => {
      expect(c.auth.noBusinessSignedIn("x@y.nl")).toContain("support@vidalo.io");
    });
  }
});
