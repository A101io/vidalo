import { describe, expect, it } from "vitest";
import type { ScanRun } from "../src/types";
import { addYears, inReconfirmMailWindow, buildFactsHistory, diffFacts, lastConfirmed, reconfirmAlreadyAsked, reconfirmation, RECONFIRM_EVENT } from "../src/facts-history";
import { sampleFacts } from "./scanner-fixtures";

const run = (id: string, startedAt: string): ScanRun => ({ id, businessId: "b1", kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 3, startedAt, finishedAt: startedAt, costCents: 0, status: "done" });

describe("diffFacts", () => {
  it("finds nothing between identical versions, whatever the list order", () => {
    const a = sampleFacts();
    const b = sampleFacts({ version: 2, servicesYes: [...a.servicesYes].reverse(), prices: [...a.prices].reverse(), phone: " 023-5312345 " });
    expect(diffFacts(a, b)).toEqual([]);
  });

  it("reports values, hours per day, list items and prices", () => {
    const a = sampleFacts();
    const b = sampleFacts({
      phone: "023-5399999",
      email: "info@bakkerijdevries.nl",
      openStatus: "temporarily_closed",
      hours: a.hours.map((h) => (h.day === 4 ? { ...h, close: "21:00" } : h.day === 6 ? { day: 6, open: "10:00", close: "14:00", closed: false } : h)),
      servicesYes: ["taarten op bestelling", "lunch"],
      prices: [{ label: "een brood", amount: 4.25 }, a.prices[1]!],
      serviceArea: { places: ["Heemstede"], radiusKm: 10 },
      urgency: { available: true, hoursNl: null },
    });
    const changes = diffFacts(a, b);
    expect(changes).toEqual([
      { kind: "value", field: "phone", before: "023-5312345", after: "023-5399999" },
      { kind: "value", field: "email", before: null, after: "info@bakkerijdevries.nl" },
      { kind: "value", field: "openStatus", before: "open", after: "temporarily_closed" },
      {
        kind: "hours",
        days: [
          { day: 4, before: a.hours[4], after: { ...a.hours[4], close: "21:00" } },
          { day: 6, before: a.hours[6], after: { day: 6, open: "10:00", close: "14:00", closed: false } },
        ],
      },
      { kind: "list", field: "servicesYes", added: ["lunch"], removed: ["glutenvrij brood"] },
      { kind: "list", field: "serviceAreaPlaces", added: ["Heemstede"], removed: [] },
      { kind: "prices", added: [{ label: "een brood", amount: 4.25 }], removed: [{ label: "een brood", amount: 3.95 }] },
      { kind: "value", field: "serviceAreaRadiusKm", before: null, after: "10" },
      { kind: "value", field: "urgencyAvailable", before: null, after: "yes" },
    ]);
  });

  it("treats two closed days as equal whatever their times say", () => {
    const a = sampleFacts();
    const b = sampleFacts({ hours: a.hours.map((h) => (h.day === 6 ? { ...h, open: "", close: "" } : h)) });
    expect(diffFacts(a, b)).toEqual([]);
  });
});

describe("buildFactsHistory", () => {
  const v1 = sampleFacts({ version: 1, createdAt: "2026-01-10T10:00:00.000Z" });
  const v2 = sampleFacts({ version: 2, provisional: false, verifiedAt: "2026-01-12T09:00:00.000Z", createdAt: "2026-01-12T09:00:00.000Z", phone: "023-5399999" });
  const v3 = sampleFacts({ version: 3, provisional: false, verifiedAt: "2026-03-01T09:00:00.000Z", createdAt: "2026-03-01T09:00:00.000Z", phone: "023-5399999" });

  it("lists every version newest first, with changes against the one before and the checks per version", () => {
    const runs = [run("free", "2026-01-10T10:05:00.000Z"), run("feb", "2026-02-07T02:00:00.000Z"), run("jan", "2026-01-14T02:00:00.000Z"), run("mar", "2026-03-07T02:00:00.000Z"), run("old", "2025-12-01T00:00:00.000Z")];
    const h = buildFactsHistory([v3, v1, v2], runs);
    expect(h.map((e) => e.version)).toEqual([3, 2, 1]);
    expect(h[2]!.changes).toBeNull();
    expect(h[2]!.provisional).toBe(true);
    expect(h[2]!.confirmedAt).toBeNull();
    expect(h[1]!.changes).toEqual([{ kind: "value", field: "phone", before: "023-5312345", after: "023-5399999" }]);
    expect(h[0]!.changes).toEqual([]); // confirmed again without changes
    expect(h.map((e) => e.runs.map((r) => r.id))).toEqual([["mar"], ["feb", "jan"], ["free"]]);
  });

  it("falls back to the confirmation date when a version has no stored date", () => {
    const { createdAt: _c, ...noDate } = v2;
    const h = buildFactsHistory([noDate], [run("jan", "2026-01-14T02:00:00.000Z")]);
    expect(h[0]!.since).toBe(v2.verifiedAt);
    expect(h[0]!.runs).toHaveLength(1);
  });
});

describe("yearly re-confirmation", () => {
  const confirmed = sampleFacts({ version: 4, provisional: false, verifiedAt: "2026-03-01T09:00:00.000Z" });

  it("picks the newest confirmed version, never a provisional one", () => {
    const later = sampleFacts({ version: 5, provisional: true, verifiedAt: null });
    expect(lastConfirmed([confirmed, later])?.version).toBe(4);
    expect(lastConfirmed([later])).toBeNull();
  });

  it("is due one year after the confirmation, not a day before", () => {
    expect(reconfirmation(confirmed, new Date("2027-02-28T23:59:00.000Z"))).toMatchObject({ due: false, cycle: 0, dueAt: "2027-03-01T09:00:00.000Z" });
    expect(reconfirmation(confirmed, new Date("2027-03-01T09:00:00.000Z"))).toMatchObject({ due: true, cycle: 1, version: 4 });
    expect(reconfirmation(confirmed, new Date("2028-03-01T09:00:00.000Z"))).toMatchObject({ due: true, cycle: 2 });
  });

  it("asks nothing when nothing was confirmed", () => {
    expect(reconfirmation(null)).toBeNull();
    expect(reconfirmation(sampleFacts())).toBeNull();
  });

  it("handles 29 February", () => {
    expect(addYears("2028-02-29T12:00:00.000Z", 1).toISOString()).toBe("2029-03-01T12:00:00.000Z");
  });

  it("mails only in the first 30 days of a due year", () => {
    const at = (iso: string) => reconfirmation(confirmed, new Date(iso))!;
    expect(inReconfirmMailWindow(at("2027-03-01T09:00:00.000Z"), new Date("2027-03-01T09:00:00.000Z"))).toBe(true);
    expect(inReconfirmMailWindow(at("2027-03-30T09:00:00.000Z"), new Date("2027-03-30T09:00:00.000Z"))).toBe(true);
    expect(inReconfirmMailWindow(at("2027-03-31T09:00:00.000Z"), new Date("2027-03-31T09:00:00.000Z"))).toBe(false);
    expect(inReconfirmMailWindow(at("2028-03-05T09:00:00.000Z"), new Date("2028-03-05T09:00:00.000Z"))).toBe(true);
    expect(inReconfirmMailWindow(at("2027-02-01T09:00:00.000Z"), new Date("2027-02-01T09:00:00.000Z"))).toBe(false);
  });

  it("knows when this year's question was already asked", () => {
    const r = reconfirmation(confirmed, new Date("2027-03-02T00:00:00.000Z"))!;
    const asked = [{ type: RECONFIRM_EVENT, payload: { version: 4, cycle: 1 } }];
    expect(reconfirmAlreadyAsked(asked, r)).toBe(true);
    expect(reconfirmAlreadyAsked(asked, { version: 4, cycle: 2 })).toBe(false);
    expect(reconfirmAlreadyAsked(asked, { version: 5, cycle: 1 })).toBe(false);
  });
});
