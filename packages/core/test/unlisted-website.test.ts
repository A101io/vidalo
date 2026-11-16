/**
 * Feature 005, SEC-01: "Mijn bedrijf staat er niet bij" checks a business as typed. Typing the exact name and town of
 * a business Google already lists must not let a stranger put a website of their choosing on it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "../src/db";
import { setDb } from "../src/shared";
import { mockCandidate, prepareBusiness, unlistedCandidate } from "../src/scanner";

describe("a typed website on a business that is already listed", () => {
  let db: MemDb;
  beforeEach(() => {
    process.env.VIDALO_MOCK = "1";
    db = new MemDb();
    setDb(db);
  });

  it("is ignored: the listed business keeps its own facts", async () => {
    const listed = mockCandidate("Bakkerij Lijst", "Haarlem");
    const first = await prepareBusiness({ name: listed.name, place: "Haarlem", candidate: { ...listed, website: null }, db });
    const second = await prepareBusiness({ name: listed.name, place: "Haarlem", candidate: unlistedCandidate(listed.name, "Haarlem"), website: "https://evil.example.com", db });
    expect(second.business.id).toBe(first.business.id);
    expect(second.business.googlePlaceId).toBe(listed.placeId);
    expect((await db.latestFacts(first.business.id))!.website ?? null).not.toBe("https://evil.example.com");
  });

  it("is ignored for a business only the KvK lists (QA-03)", async () => {
    const kvkOnly = { ...unlistedCandidate("Smederij Register", "Haarlem"), kvk: "12345678", source: "kvk" as const };
    const p = await prepareBusiness({ name: kvkOnly.name, place: "Haarlem", candidate: kvkOnly, website: "https://evil.example.com", db });
    expect((await db.latestFacts(p.business.id))!.website ?? null).not.toBe("https://evil.example.com");
  });

  it("is used for a business nothing lists", async () => {
    const p = await prepareBusiness({ name: "Nergens Te Vinden", place: "Haarlem", candidate: unlistedCandidate("Nergens Te Vinden", "Haarlem"), website: "https://nergens.example.com", db });
    expect((await db.latestFacts(p.business.id))!.website).toBe("https://nergens.example.com");
  });
});
