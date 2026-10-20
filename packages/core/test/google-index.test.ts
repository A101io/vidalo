import { generateKeyPairSync, createVerify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "../src/db";
import { setDb } from "../src/shared/db";
import {
  checkGoogleIndex,
  createGoogleApi,
  inspectionFrom,
  metaTokenContent,
  serviceAccountAssertion,
  serviceAccountFromEnv,
  setGoogleApi,
  type GoogleApi,
} from "../src/publisher/google-index";
import { clearServeCache, createFactsHandler } from "../src/publisher/serve";
import { facts } from "./worker-fixtures";

/** Records calls; `fail` makes one step throw once. */
function fakeApi(verdicts: string[] = ["PASS"]) {
  const calls: string[] = [];
  let fail: string | null = null;
  const step = (name: string) => {
    calls.push(name);
    if (fail === name) {
      fail = null;
      throw new Error(`${name} refused`);
    }
  };
  const api: GoogleApi = {
    async getToken(site) {
      step("token");
      return `tok-${site}`;
    },
    async verify() {
      step("verify");
    },
    async addSite() {
      step("add");
    },
    async submitSitemap() {
      step("sitemap");
    },
    async inspect() {
      step("inspect");
      return inspectionFrom({ verdict: verdicts.shift() ?? "PASS", coverageState: "Submitted and indexed" });
    },
  };
  return { api, calls, failNext: (name: string) => (fail = name) };
}

describe("Google API plumbing", () => {
  it("keeps only the content of the meta tag", () => {
    expect(metaTokenContent('<meta name="google-site-verification" content="abc123" />')).toBe("abc123");
    expect(metaTokenContent("abc123")).toBe("abc123");
  });

  it("reads the service account as JSON or base64 and signs a valid RS256 assertion", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    const json = JSON.stringify({ client_email: "vidalo@project.iam.gserviceaccount.com", private_key: privateKey });
    expect(serviceAccountFromEnv(json)?.client_email).toBe("vidalo@project.iam.gserviceaccount.com");
    const sa = serviceAccountFromEnv(Buffer.from(json).toString("base64"))!;
    expect(serviceAccountFromEnv("")).toBeNull();

    const jwt = serviceAccountAssertion(sa, 1_800_000_000);
    const [h, c, sig] = jwt.split(".");
    expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig!, "base64url"))).toBe(true);
    const claims = JSON.parse(Buffer.from(c!, "base64url").toString()) as Record<string, unknown>;
    expect(claims).toMatchObject({ iss: sa.client_email, aud: "https://oauth2.googleapis.com/token", iat: 1_800_000_000, exp: 1_800_003_600 });
    expect(String(claims.scope)).toContain("webmasters");
  });

  it("calls the right endpoints with a bearer token", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    const seen: string[] = [];
    const api = createGoogleApi({ client_email: "x@y", private_key: privateKey }, async (url, init) => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "at", expires_in: 3600 });
      seen.push(`${init?.method} ${url} ${(init?.headers as Record<string, string>).authorization}`);
      if (url.endsWith("/siteVerification/v1/token")) return Response.json({ method: "META", token: '<meta name="google-site-verification" content="T1" />' });
      if (url.includes("urlInspection")) return Response.json({ inspectionResult: { indexStatusResult: { verdict: "NEUTRAL", coverageState: "Discovered - currently not indexed" } } });
      return new Response("", { status: 200 });
    });
    const site = "https://feiten.bakkerijjansen.nl/";
    expect(await api.getToken(site)).toBe("T1");
    await api.verify(site);
    await api.addSite(site);
    await api.submitSitemap(site, `${site}sitemap.xml`);
    expect(await api.inspect(site, site)).toMatchObject({ verdict: "NEUTRAL", coverageState: "Discovered - currently not indexed" });
    expect(seen).toEqual([
      "POST https://www.googleapis.com/siteVerification/v1/token Bearer at",
      "POST https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=META Bearer at",
      "PUT https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Ffeiten.bakkerijjansen.nl%2F Bearer at",
      "PUT https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Ffeiten.bakkerijjansen.nl%2F/sitemaps/https%3A%2F%2Ffeiten.bakkerijjansen.nl%2Fsitemap.xml Bearer at",
      "POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect Bearer at",
    ]);
  });
});

describe("checkGoogleIndex", () => {
  let db: MemDb;
  beforeEach(() => {
    db = new MemDb();
    setDb(db);
    clearServeCache();
  });
  afterEach(() => setGoogleApi(undefined));

  async function seed(host = "feiten.bakkerijjansen.nl", verified = true) {
    const b = await db.upsertBusiness({ name: "Bakkerij Jansen", place: "Haarlem", status: "active", factsHost: host, factsHostVerifiedAt: verified ? "2026-10-01T10:00:00.000Z" : null });
    await db.insertFacts(b.id, facts, { verifiedAt: "2026-10-01T10:00:00.000Z" });
    return b;
  }

  it("verifies, adds, submits the sitemap and inspects; later runs only inspect", async () => {
    const b = await seed();
    const { api, calls } = fakeApi(["NEUTRAL", "PASS"]);
    const now = new Date("2026-10-15T08:00:00Z");
    const first = await checkGoogleIndex(b.id, { api, now });
    expect(calls).toEqual(["token", "verify", "add", "sitemap", "inspect"]);
    expect(first.indexed).toBe(false);
    expect(first.state).toMatchObject({ token: "tok-https://feiten.bakkerijjansen.nl/", verifiedAt: now.toISOString(), indexedAt: null, lastError: null });

    calls.length = 0;
    const later = new Date("2026-10-16T08:00:00Z");
    const second = await checkGoogleIndex(b.id, { api, now: later });
    expect(calls).toEqual(["inspect"]);
    expect(second.indexed).toBe(true);
    expect(second.state?.indexedAt).toBe(later.toISOString());
    const types = (await db.listEvents(b.id, 50)).map((e) => e.type);
    expect(types).toContain("google_index.verified");
    expect(types.filter((t) => t === "google_index.indexed")).toHaveLength(1);
  });

  it("stores a failed step and resumes there", async () => {
    const b = await seed();
    const { api, calls, failNext } = fakeApi();
    failNext("verify");
    const failed = await checkGoogleIndex(b.id, { api });
    expect(failed.failedAt).toBe("verify");
    expect(failed.state?.lastError).toBe("verify: Error: verify refused");
    expect(failed.state?.token).toBeTruthy();

    calls.length = 0;
    const ok = await checkGoogleIndex(b.id, { api });
    expect(calls).toEqual(["verify", "add", "sitemap", "inspect"]);
    expect(ok.state?.lastError).toBeNull();
  });

  it("resubmits the sitemap when still not indexed two weeks later", async () => {
    const b = await seed();
    const { api, calls } = fakeApi(["NEUTRAL", "NEUTRAL", "NEUTRAL"]);
    await checkGoogleIndex(b.id, { api, now: new Date("2026-10-01T00:00:00Z") });
    calls.length = 0;
    await checkGoogleIndex(b.id, { api, now: new Date("2026-10-10T00:00:00Z") });
    expect(calls).toEqual(["inspect"]);
    calls.length = 0;
    await checkGoogleIndex(b.id, { api, now: new Date("2026-10-16T00:00:00Z") });
    expect(calls).toEqual(["sitemap", "inspect"]);
  });

  it("starts over for a new facts host, and waits for an unverified one", async () => {
    const b = await seed("x.feiten.vidalo.io");
    const { api, calls } = fakeApi();
    await checkGoogleIndex(b.id, { api });
    await db.upsertBusiness({ id: b.id, name: b.name, place: b.place, factsHost: "feiten.bakkerijjansen.nl" });
    calls.length = 0;
    const moved = await checkGoogleIndex(b.id, { api });
    expect(calls).toEqual(["token", "verify", "add", "sitemap", "inspect"]);
    expect(moved.state?.host).toBe("feiten.bakkerijjansen.nl");

    const pending = await seed("feiten.ander.nl", false);
    expect((await checkGoogleIndex(pending.id, { api })).skipped).toBe("host_not_verified");
  });

  it("is a no-op without a service account", async () => {
    const b = await seed();
    expect(await checkGoogleIndex(b.id, { api: null })).toMatchObject({ skipped: "not_configured", indexed: false });
  });

  it("serves the verification meta tag on the facts page once a token exists", async () => {
    const b = await seed();
    const handle = createFactsHandler();
    const get = () => handle(new Request("https://feiten.bakkerijjansen.nl/", { headers: { host: "feiten.bakkerijjansen.nl" } })).then((r) => r.text());
    expect(await get()).not.toContain("google-site-verification");
    await checkGoogleIndex(b.id, { api: fakeApi().api });
    expect(await get()).toContain('<meta name="google-site-verification" content="tok-https://feiten.bakkerijjansen.nl/">');
  });
});
