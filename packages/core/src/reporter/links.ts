/**
 * Customer-facing URLs. The web app (apps/web) owns the routes:
 *   /app            dashboard          /app/gegevens  facts confirmation
 *   /app/google     Google login       /app/domein    domain step
 *   /r/{scanRunId}  public result      /inloggen      magic-link login
 * Override the base with PUBLIC_BASE_URL. An owner who chose English
 * (business.language) gets the English URLs (/en/app, /en/unsubscribe), the
 * same ones apps/web/lib/lang-paths.ts makes; the mail lab checks every link.
 */
import type { BusinessRecord } from "../db/types.js";
import { defaultFactsHost } from "../publisher/render.js";
import { unsubscribeToken } from "../shared/unsubscribe.js";

type Lang = "nl" | "en";
type WithLang = { language?: Lang | null };

/** The first segments a mail links to whose English URL differs (apps/web/lib/lang-paths.ts EN_SLUGS). */
const EN_SEGMENTS: Record<string, string> = { inloggen: "login", afmelden: "unsubscribe" };

/** A route as the code writes it (Dutch) → its URL path in `lang`. API routes have one URL. */
export function mailPath(route: string, lang: Lang | null | undefined): string {
  if (lang !== "en" || route.startsWith("/api/")) return route;
  const [, first = "", ...rest] = route.split("/");
  return `/en${first ? `/${[EN_SEGMENTS[first] ?? first, ...rest].join("/")}` : ""}`;
}

export function baseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function dashboardUrl(business?: Pick<BusinessRecord, "slug"> & WithLang): string {
  return `${baseUrl()}${mailPath("/app", business?.language)}`;
}

export function confirmFactsUrl(business?: Pick<BusinessRecord, "slug"> & WithLang): string {
  return `${baseUrl()}${mailPath("/app/gegevens", business?.language)}`;
}

export function googleConnectUrl(business?: Pick<BusinessRecord, "slug"> & WithLang): string {
  return `${baseUrl()}${mailPath("/app/google", business?.language)}`;
}

export function domainUrl(business?: Pick<BusinessRecord, "slug"> & WithLang): string {
  return `${baseUrl()}${mailPath("/app/domein", business?.language)}`;
}

export function loginUrl(next?: string, lang?: Lang): string {
  return `${baseUrl()}${mailPath("/inloggen", lang)}${next ? `?next=${encodeURIComponent(next)}` : ""}`;
}

/** Public result page for a scan run (valid 30 days for non-customers). */
export function resultUrl(scanRunIdOrBusiness: string | (Pick<BusinessRecord, "slug"> & { scanRunId?: string } & WithLang), lang?: Lang): string {
  const id = typeof scanRunIdOrBusiness === "string" ? scanRunIdOrBusiness : (scanRunIdOrBusiness.scanRunId ?? scanRunIdOrBusiness.slug);
  return `${baseUrl()}${mailPath(`/r/${id}`, lang ?? (typeof scanRunIdOrBusiness === "string" ? null : scanRunIdOrBusiness.language))}`;
}

export function factsPageUrl(business: Pick<BusinessRecord, "slug" | "factsHost">): string {
  return `https://${business.factsHost ?? defaultFactsHost(business)}/`;
}

/** Opt-out page for the follow-up mails; signed, see shared/unsubscribe.ts. */
export function unsubscribeUrl(business: Pick<BusinessRecord, "id"> & WithLang): string {
  return `${baseUrl()}${mailPath("/afmelden", business.language)}?b=${encodeURIComponent(business.id)}&t=${unsubscribeToken(business.id)}`;
}

/** RFC 8058 one-click target that mail apps POST to. */
export function unsubscribeOneClickUrl(business: Pick<BusinessRecord, "id">): string {
  return `${baseUrl()}/api/afmelden?b=${encodeURIComponent(business.id)}&t=${unsubscribeToken(business.id)}`;
}
