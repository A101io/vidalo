import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemDb } from "../src/db";
import { setDb } from "../src/shared/db";
import { checkFactsHost, deleteCustomHostname, ensureCustomHostname, fallbackSlug, isFallbackHost, isOurName, isOwnFactsHost } from "../src/publisher/host";
import { defaultFactsHost } from "../src/publisher/render";
import { ensureFactsHost, factsHostTaken, pollFactsHost } from "../src/publisher";
import { clearServeCache, createFactsHandler } from "../src/publisher/serve";
import { facts } from "./worker-fixtures";

describe("fallback facts host {slug}-feiten.vidalo.ai", () => {
  it("is one label under the suffix", () => {
    expect(defaultFactsHost({ slug: "bakkerij-jansen-haarlem" })).toBe("bakkerij-jansen-haarlem-feiten.vidalo.ai");
    expect(fallbackSlug("bakkerij-jansen-haarlem-feiten.vidalo.ai")).toBe("bakkerij-jansen-haarlem");
    expect(isFallbackHost("Bakkerij-Jansen-Haarlem-Feiten.Vidalo.ai")).toBe(true);
  });

  it("cuts a slug too long for one DNS label and keeps two long slugs apart", () => {
    const a = defaultFactsHost({ slug: `${"a".repeat(60)}-amsterdam` });
    const b = defaultFactsHost({ slug: `${"a".repeat(60)}-rotterdam` });
    expect(a).not.toBe(b);
    for (const h of [a, b]) {
      expect(h.split(".")[0]!.length).toBeLessThanOrEqual(63);
      expect(isFallbackHost(h)).toBe(true);
    }
  });

  it.each([
    "x-feiten.vidalo.ai.evil.com",
    "x-feiten.evilvidalo.ai",
    "a.b-feiten.vidalo.ai",
    "x.feiten.vidalo.ai",
    "feiten.vidalo.ai",
    "-feiten.vidalo.ai",
    "x--feiten.vidalo.ai",
    "x-feiten.vidalo.ai.",
    "www.vidalo.ai",
    "vidalo.ai",
    "feiten.bakkerijjansen.nl",
    "x-feiten.bakkerijjansen.nl",
    `${"a".repeat(57)}-feiten.vidalo.ai`,
  ])("is not fooled by %s", (host) => {
    expect(isFallbackHost(host)).toBe(false);
  });

  it("is never one of our own names", () => {
    for (const slug of ["www", "feiten", "vidalo"]) expect(defaultFactsHost({ slug })).toBe(`${slug}-feiten.vidalo.ai`);
  });

  it("counts as own only for the business it belongs to", () => {
    expect(isOwnFactsHost("bakker-feiten.vidalo.ai", { slug: "bakker" })).toBe(true);
    expect(isOwnFactsHost("bakker-feiten.vidalo.ai", { slug: "slager" })).toBe(false);
    expect(isOwnFactsHost("feiten.vidalo.ai", { slug: "vidalo" })).toBe(true);
    expect(isOwnFactsHost("feiten.vidalo.ai", { slug: "bakker" })).toBe(false);
    expect(isOurName("www.vidalo.ai")).toBe(true);
    // vidalo.io held the facts hosts until 20 Nov 2026 and keeps the mail: still never claimable.
    expect(isOurName("feiten.vidalo.io")).toBe(true);
    expect(isOurName("bakker-feiten.vidalo.io")).toBe(true);
    expect(isOurName("vidalo.io")).toBe(true);
    expect(isOurName("evilvidalo.io")).toBe(false);
    expect(isOurName("feiten.bakkerijjansen.nl")).toBe(false);
  });
});

describe("checkFactsHost", () => {
  it("verifies the own fallback host without DNS, and never another name under the suffix", async () => {
    vi.stubEnv("VIDALO_MOCK", "1"); // a DNS check would pass in mock mode: the refusal must come first
    try {
      expect((await checkFactsHost("bakker-feiten.vidalo.ai", { slug: "bakker" })).verified).toBe(true);
      expect(await checkFactsHost("slager-feiten.vidalo.ai", { slug: "bakker" })).toEqual({ verified: false, cname: null, cloudflare: null });
      expect((await checkFactsHost("www.vidalo.ai", { slug: "bakker" })).verified).toBe(false);
      expect((await checkFactsHost("feiten.bakkerijjansen.nl", { slug: "bakker" })).verified).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("facts host ownership", () => {
  let db: MemDb;
  beforeEach(() => {
    db = new MemDb();
    setDb(db);
    clearServeCache();
    vi.stubEnv("VIDALO_MOCK", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("gives a business without a domain its fallback host, verified", async () => {
    const b = await db.upsertBusiness({ name: "Bakker", place: "Delft", status: "active" });
    const updated = await ensureFactsHost(b.id, "fallback");
    expect(updated.factsHost).toBe(`${b.slug}-feiten.vidalo.ai`);
    expect(updated.factsHostVerifiedAt).not.toBeNull();
  });

  it("does not let a second business take a host another business verified", async () => {
    const a = await db.upsertBusiness({ name: "A", place: "Delft", status: "active", factsHost: "feiten.a.nl", factsHostVerifiedAt: "2026-10-01T10:00:00.000Z" });
    const b = await db.upsertBusiness({ name: "B", place: "Delft", status: "active", factsHost: "feiten.a.nl" });
    expect(await factsHostTaken("feiten.a.nl", b.id)).toBe(true);
    expect(await factsHostTaken("feiten.a.nl", a.id)).toBe(false);
    expect(await pollFactsHost(b.id)).toEqual({ verified: false, host: "feiten.a.nl" });
    expect((await db.getBusiness(b.id))!.factsHostVerifiedAt).toBeNull();
  });

  it("does not verify another business's fallback host typed in as a domain", async () => {
    const b = await db.upsertBusiness({ name: "B", place: "Delft", status: "active", factsHost: "a-delft-feiten.vidalo.ai" });
    expect((await pollFactsHost(b.id)).verified).toBe(false);
  });
});

describe("serving facts pages by host", () => {
  let db: MemDb;
  beforeEach(() => {
    db = new MemDb();
    setDb(db);
    clearServeCache();
  });

  async function seed(name: string, host: string, verifiedAt: string | null) {
    const b = await db.upsertBusiness({ name, place: "Haarlem", status: "active", factsHost: host, factsHostVerifiedAt: verifiedAt });
    await db.insertFacts(b.id, { ...facts, businessId: b.id, name }, { verifiedAt: "2026-10-01T10:00:00.000Z" });
    return b;
  }

  const get = (url: string, headers: Record<string, string> = {}) => createFactsHandler()(new Request(url, { headers }));

  it("serves {slug}-feiten.vidalo.ai and a customer's own host", async () => {
    await seed("Bakkerij Jansen", "bakkerij-jansen-haarlem-feiten.vidalo.ai", "2026-10-01T10:00:00.000Z");
    await seed("Slagerij Smit", "feiten.slagerijsmit.nl", "2026-10-01T10:00:00.000Z");
    const fallback = await get("https://bakkerij-jansen-haarlem-feiten.vidalo.ai/");
    expect(fallback.status).toBe(200);
    expect(fallback.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    expect(fallback.headers.get("x-content-type-options")).toBe("nosniff");
    const html = await fallback.text();
    expect(html).toContain('<link rel="canonical" href="https://bakkerij-jansen-haarlem-feiten.vidalo.ai/">');
    expect(html).toContain("Bakkerij Jansen");
    const custom = await get("https://feiten.slagerijsmit.nl/llms.txt");
    expect(custom.status).toBe(200);
    expect(await custom.text()).toContain("Slagerij Smit");
    expect((await get("https://onbekend-feiten.vidalo.ai/")).status).toBe(404);
    expect((await get("https://feiten.vidalo.ai/")).status).toBe(404);
  });

  it("answers with the verified holder when someone else typed the same host", async () => {
    await seed("Indringer", "feiten.slagerijsmit.nl", null);
    await seed("Slagerij Smit", "feiten.slagerijsmit.nl", "2026-10-01T10:00:00.000Z");
    const html = await (await get("https://feiten.slagerijsmit.nl/")).text();
    expect(html).toContain("Slagerij Smit");
    expect(html).not.toContain("Indringer");
  });
});

describe("Cloudflare for SaaS: one worker route per custom hostname", () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "t");
    vi.stubEnv("CLOUDFLARE_ZONE_ID", "z");
    const routes: { id: string; pattern: string; script: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const path = url.replace("https://api.cloudflare.com/client/v4/zones/z", "");
      const method = init.method ?? "GET";
      calls.push(`${method} ${path}${init.body ? ` ${init.body}` : ""}`);
      let result: unknown = [];
      if (path === "/workers/routes" && method === "POST") routes.push({ id: `r${routes.length}`, ...JSON.parse(String(init.body)) });
      else if (path === "/workers/routes") result = routes;
      else if (path === "/custom_hostnames" && method === "POST") result = { id: "h1", hostname: "feiten.a.nl", status: "pending" };
      return new Response(JSON.stringify({ success: true, result }), { status: 200 });
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("adds {host}/* → vidalo-worker once, next to the custom hostname", async () => {
    expect((await ensureCustomHostname("feiten.a.nl")).status).toBe("pending");
    await ensureCustomHostname("feiten.a.nl");
    const posts = calls.filter((c) => c.startsWith("POST /workers/routes"));
    expect(posts).toEqual(['POST /workers/routes {"pattern":"feiten.a.nl/*","script":"vidalo-worker"}']);
    await deleteCustomHostname("feiten.a.nl");
    expect(calls).toContain("DELETE /workers/routes/r0");
  });

  it.each(["vidalo.ai", "www.vidalo.ai", "*.a.nl", "feiten.a.nl/x"])("never routes %s", async (host) => {
    await expect(ensureCustomHostname(host)).rejects.toThrow(/refusing/);
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
  });
});
