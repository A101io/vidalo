/**
 * ADR-0007: the website a visitor types on /scan/kies is an address the server will fetch. It is validated at the
 * boundary (security S-12, S-13) before it is stored or fetched; /api/scan calls parseTypedWebsite and nothing else.
 */
import { describe, expect, it } from "vitest";
import { withMockDb } from "../src/db";
import { prepareBusiness } from "../src/scanner/onboard";
import { mockCandidate } from "../src/scanner/resolve";
import { MAX_TYPED_WEBSITE, parseTypedWebsite } from "../src/shared/typed-website";

const ok = (raw: unknown) => {
  const r = parseTypedWebsite(raw);
  return r.ok ? r.url : "refused";
};

describe("parseTypedWebsite", () => {
  it("accepts a public address, adds https when the scheme is missing, and keeps the host and path only", () => {
    expect(ok("https://sonable.io")).toBe("https://sonable.io");
    expect(ok("sonable.io")).toBe("https://sonable.io");
    expect(ok("www.Sonable.io/over-ons")).toBe("https://www.sonable.io/over-ons");
    expect(ok("  http://sonable.io  ")).toBe("http://sonable.io");
    expect(ok("https://sonable.io:443/x")).toBe("https://sonable.io/x");
    expect(ok("https://sonable.io/a?token=secret#frag")).toBe("https://sonable.io/a");
  });

  it("treats empty as 'no website given': the check runs without it", () => {
    for (const empty of ["", "   ", null, undefined]) expect(parseTypedWebsite(empty)).toEqual({ ok: true, url: null });
  });

  it("refuses a loopback, private or link-local address, an IP literal and an internal name", () => {
    for (const bad of ["http://127.0.0.1", "http://10.0.0.1", "10.0.0.1", "http://192.168.1.1/", "http://172.16.0.1", "http://169.254.169.254/latest", "http://[::1]/", "http://localhost", "localhost:3000", "http://0.0.0.0", "http://2130706433", "http://0x7f.0.0.1", "http://8.8.8.8", "http://metadata.internal", "http://printer.local", "http://intranet"]) {
      expect(ok(bad), bad).toBe("refused");
    }
  });

  it("refuses credentials, other schemes, markup and odd ports", () => {
    for (const bad of ["https://user:pw@x.nl", "user:pw@x.nl", "https://user@x.nl", "javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "ftp://x.nl", "mailto:a@x.nl", "https://x.nl:8080", "https://x.nl:6379", "https://x.nl/<script>", "https://x.nl/\"onload=x", "https://x .nl", "https://x.nl/\u0000", "https://x.nl/‮"]) {
      expect(ok(bad), bad).toBe("refused");
    }
    expect(ok(42)).toBe("refused");
    expect(ok({})).toBe("refused");
  });

  it("refuses 201 characters and takes 200", () => {
    const base = "https://www.sonable.io/";
    expect(ok(base + "a".repeat(MAX_TYPED_WEBSITE + 1 - base.length))).toBe("refused");
    expect(ok(base + "a".repeat(MAX_TYPED_WEBSITE - base.length))).not.toBe("refused");
    // the cap is on what was typed, not on what is kept: a long query that would be dropped is still refused
    expect(ok("https://www.sonable.io/?" + "q=1&".repeat(60))).toBe("refused");
  });
});

describe("the typed website on onboarding", () => {
  it("is stored as the provisional facts.website and never as the business's domain", async () => {
    const db = withMockDb();
    const { business } = await prepareBusiness({ name: "Vloedlijn Music", place: "Utrecht", website: "https://www.vloedlijn-music.example", db });
    const facts = await db.latestFacts(business.id);
    expect(facts).toMatchObject({ provisional: true, website: "https://www.vloedlijn-music.example" });
    expect(business.domain).toBeNull();
  });

  it("is added to earlier provisional facts that had none, and does not overwrite one that has a website", async () => {
    const db = withMockDb();
    const first = await prepareBusiness({ name: "Vloedlijn Music", place: "Utrecht", db });
    expect((await db.latestFacts(first.business.id))!.website).toBeNull();
    await prepareBusiness({ name: "Vloedlijn Music", place: "Utrecht", website: "https://eerste.example", db });
    expect((await db.latestFacts(first.business.id))!.website).toBe("https://eerste.example");
    await prepareBusiness({ name: "Vloedlijn Music", place: "Utrecht", website: "https://tweede.example", db });
    expect((await db.latestFacts(first.business.id))!.website).toBe("https://eerste.example");
  });

  it("is ignored for a business that Google lists", async () => {
    const db = withMockDb();
    const candidate = mockCandidate("Bakkerij De Vries", "Haarlem");
    const { business } = await prepareBusiness({ name: "Bakkerij De Vries", place: "Haarlem", candidate, website: "https://evil.example", db });
    expect((await db.latestFacts(business.id))!.website).toBe(candidate.website);
    expect(business.googlePlaceId).not.toBeNull();
  });
});
