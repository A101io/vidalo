/**
 * Google Search Console for facts pages: know that Google has read the page
 * instead of hoping. Per facts host, once:
 *
 *   1. token     Site Verification API hands out a meta-tag token; serve.ts
 *                puts it on the facts page
 *   2. verify    Site Verification API checks the tag; Vidalo's service
 *                account becomes owner of https://{host}/
 *   3. add       the host becomes a Search Console property
 *   4. sitemap   submit https://{host}/sitemap.xml
 * then on every check:
 *   5. inspect   URL Inspection API: is https://{host}/ indexed?
 *
 * Still not indexed two weeks after the last sitemap submit → submit again.
 * There is no API to ask Google to index an ordinary page; the sitemap is
 * the honest lever (Bing gets IndexNow on every publish).
 *
 * Needs GOOGLE_SERVICE_ACCOUNT_JSON (the key file as JSON, or base64 of it).
 * Without it every call is a logged no-op; in VIDALO_MOCK=1 a fake API runs
 * the whole flow so the pipeline can be tested offline.
 */
import { createSign } from "node:crypto";
import type { GoogleIndexState, GoogleInspection } from "../db/types.js";
import { getDb, isMock } from "../shared/db.js";
import { errorMessage, log } from "../shared/log.js";
import { clearServeCache } from "./serve.js";

const SCOPES = ["https://www.googleapis.com/auth/siteverification", "https://www.googleapis.com/auth/webmasters"];
/** Resubmit the sitemap when the page is still not indexed this long after the last submit. */
export const RESUBMIT_AFTER_DAYS = 14;

export interface GoogleApi {
  /** content="" value of the google-site-verification meta tag for this site */
  getToken(siteUrl: string): Promise<string>;
  verify(siteUrl: string): Promise<void>;
  addSite(siteUrl: string): Promise<void>;
  submitSitemap(siteUrl: string, sitemapUrl: string): Promise<void>;
  inspect(siteUrl: string, url: string): Promise<GoogleInspection>;
}

// ---------------------------------------------------------------------------
// service account → access token
// ---------------------------------------------------------------------------

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export function serviceAccountFromEnv(raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON): ServiceAccount | null {
  const v = raw?.trim();
  if (!v) return null;
  try {
    const json = v.startsWith("{") ? v : Buffer.from(v, "base64").toString("utf8");
    const sa = JSON.parse(json) as ServiceAccount;
    return sa.client_email && sa.private_key ? sa : null;
  } catch {
    log.warn("google_index.bad_service_account");
    return null;
  }
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** Signed JWT assertion for the OAuth 2.0 service-account flow. */
export function serviceAccountAssertion(sa: ServiceAccount, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPES.join(" "), aud: sa.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.private_key);
  return `${header}.${claims}.${b64url(signature)}`;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** The real API over fetch. Access tokens are cached until a minute before they expire. */
export function createGoogleApi(sa: ServiceAccount, fetchImpl: FetchLike = fetch): GoogleApi {
  let cached: { token: string; until: number } | null = null;

  async function accessToken(): Promise<string> {
    if (cached && cached.until > Date.now()) return cached.token;
    const res = await fetchImpl(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceAccountAssertion(sa) }).toString(),
    });
    const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !body.access_token) throw new Error(`google token ${res.status}: ${body.error ?? "no access_token"}`);
    cached = { token: body.access_token, until: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000 };
    return body.access_token;
  }

  async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(url, {
      method,
      headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`google ${method} ${new URL(url).pathname} ${res.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  const site = (siteUrl: string) => ({ site: { type: "SITE", identifier: siteUrl } });

  return {
    async getToken(siteUrl) {
      const r = await call<{ token: string }>("POST", "https://www.googleapis.com/siteVerification/v1/token", { verificationMethod: "META", ...site(siteUrl) });
      return metaTokenContent(r.token);
    },
    async verify(siteUrl) {
      await call("POST", "https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=META", site(siteUrl));
    },
    async addSite(siteUrl) {
      await call("PUT", `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}`);
    },
    async submitSitemap(siteUrl, sitemapUrl) {
      await call("PUT", `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`);
    },
    async inspect(siteUrl, url) {
      const r = await call<{ inspectionResult?: { indexStatusResult?: Record<string, unknown> } }>("POST", "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
        inspectionUrl: url,
        siteUrl,
        languageCode: "nl",
      });
      return inspectionFrom(r.inspectionResult?.indexStatusResult ?? {});
    },
  };
}

/** The API returns the whole tag for META; keep only the content value. */
export function metaTokenContent(token: string): string {
  return /content\s*=\s*["']([^"']+)["']/i.exec(token)?.[1] ?? token.trim();
}

export function inspectionFrom(r: Record<string, unknown>, at = new Date()): GoogleInspection {
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : null);
  return {
    at: at.toISOString(),
    verdict: s("verdict") ?? "VERDICT_UNSPECIFIED",
    coverageState: s("coverageState"),
    indexingState: s("indexingState"),
    pageFetchState: s("pageFetchState"),
    robotsTxtState: s("robotsTxtState"),
    lastCrawlTime: s("lastCrawlTime"),
    googleCanonical: s("googleCanonical"),
  };
}

/** Offline stand-in: verification works, the page reads as indexed. */
export const mockGoogleApi: GoogleApi = {
  async getToken(siteUrl) {
    return `mock-${b64url(siteUrl).slice(0, 16)}`;
  },
  async verify() {},
  async addSite() {},
  async submitSitemap() {},
  async inspect(_siteUrl, url) {
    return inspectionFrom({ verdict: "PASS", coverageState: "Submitted and indexed", indexingState: "INDEXING_ALLOWED", pageFetchState: "SUCCESSFUL", robotsTxtState: "ALLOWED", googleCanonical: url });
  },
};

let override: GoogleApi | null | undefined;

/** Tests inject an API; null forces "not configured"; undefined restores the default. */
export function setGoogleApi(api: GoogleApi | null | undefined): void {
  override = api;
}

export function googleApi(): GoogleApi | null {
  if (override !== undefined) return override;
  const sa = serviceAccountFromEnv();
  if (sa) return createGoogleApi(sa);
  return isMock() ? mockGoogleApi : null;
}

// ---------------------------------------------------------------------------
// the check
// ---------------------------------------------------------------------------

export interface GoogleIndexCheck {
  skipped?: "no_business" | "host_not_verified" | "not_configured";
  /** the step that failed, when one did */
  failedAt?: "token" | "verify" | "add" | "sitemap" | "inspect";
  state: GoogleIndexState | null;
  indexed: boolean;
}

function daysBetween(a: string, b: Date): number {
  return (b.getTime() - new Date(a).getTime()) / 86_400_000;
}

/**
 * Walk the facts page through verify → add → sitemap, then inspect it. Each
 * step is stored as it succeeds, so a failed run resumes where it stopped.
 * Never throws for Google errors: they are stored in last_error and the next
 * cron run tries again.
 */
export async function checkGoogleIndex(businessId: string, opts: { now?: Date; api?: GoogleApi | null } = {}): Promise<GoogleIndexCheck> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const business = await db.getBusiness(businessId);
  if (!business) return { skipped: "no_business", state: null, indexed: false };
  if (!business.factsHost || !business.factsHostVerifiedAt) return { skipped: "host_not_verified", state: await db.getGoogleIndex(businessId), indexed: false };
  const api = opts.api !== undefined ? opts.api : googleApi();
  if (!api) {
    log.info("google_index.skip", { businessId, reason: "no GOOGLE_SERVICE_ACCOUNT_JSON" });
    return { skipped: "not_configured", state: await db.getGoogleIndex(businessId), indexed: false };
  }

  const host = business.factsHost;
  const siteUrl = `https://${host}/`;
  let state = await db.getGoogleIndex(businessId);
  if (state && state.host !== host) {
    // New facts host: start over for the new property.
    state = await db.upsertGoogleIndex({ businessId, host, token: null, verifiedAt: null, addedAt: null, sitemapAt: null, lastError: null, inspection: null, indexedAt: null });
  }
  const save = async (patch: Partial<GoogleIndexState>) => (state = await db.upsertGoogleIndex({ ...patch, businessId, host, lastAttemptAt: now.toISOString() }));

  let step: NonNullable<GoogleIndexCheck["failedAt"]> = "token";
  try {
    if (!state?.token) {
      await save({ token: await api.getToken(siteUrl) });
      clearServeCache(host); // the next request serves the meta tag
    }
    step = "verify";
    if (!state!.verifiedAt) {
      await api.verify(siteUrl);
      await save({ verifiedAt: now.toISOString() });
      await db.logEvent(businessId, "google_index.verified", { host });
    }
    step = "add";
    if (!state!.addedAt) {
      await api.addSite(siteUrl);
      await save({ addedAt: now.toISOString() });
    }
    step = "sitemap";
    const notIndexed = state!.inspection?.verdict !== "PASS";
    if (!state!.sitemapAt || (notIndexed && daysBetween(state!.sitemapAt, now) >= RESUBMIT_AFTER_DAYS)) {
      await api.submitSitemap(siteUrl, `${siteUrl}sitemap.xml`);
      if (state!.sitemapAt) await db.logEvent(businessId, "google_index.sitemap_resubmitted", { host, coverageState: state!.inspection?.coverageState ?? null });
      await save({ sitemapAt: now.toISOString() });
    }
    step = "inspect";
    const inspection = await api.inspect(siteUrl, siteUrl);
    const indexed = inspection.verdict === "PASS";
    const firstIndexed = indexed && !state!.indexedAt;
    await save({ inspection, lastError: null, ...(firstIndexed ? { indexedAt: now.toISOString() } : {}) });
    if (firstIndexed) await db.logEvent(businessId, "google_index.indexed", { host, lastCrawlTime: inspection.lastCrawlTime });
    await db.logEvent(businessId, "google_index.checked", { host, verdict: inspection.verdict, coverageState: inspection.coverageState });
    log.info("google_index.checked", { businessId, host, verdict: inspection.verdict, coverageState: inspection.coverageState });
    return { state, indexed };
  } catch (err) {
    const error = errorMessage(err);
    await save({ lastError: `${step}: ${error}` });
    await db.logEvent(businessId, "google_index.failed", { host, step, error });
    log.warn("google_index.failed", { businessId, host, step, error });
    return { failedAt: step, state, indexed: state?.inspection?.verdict === "PASS" };
  }
}

/** Token to serve on a facts page, or null (none yet, or it belongs to another host). */
export async function googleVerificationToken(businessId: string, host: string): Promise<string | null> {
  const state = await getDb().getGoogleIndex(businessId);
  return state && state.host === host ? state.token : null;
}
