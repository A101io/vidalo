/**
 * What the owner sees on the domain page about work the worker already did:
 * the facts page (published, indexed by Google) and the last own-website
 * check. Pure: the caller reads the rows, these helpers only interpret them.
 */
import type { Channel, Engine } from "../types.js";
import type { EventRow, GoogleIndexState } from "../db/types.js";
import { ANSWER_ROBOTS, type SiteIssue } from "./sitecheck.js";

export interface FactsPageStatus {
  url: string | null;
  /** live = published and the host points to Vidalo; waiting_dns = published, host not pointing yet; no = never published */
  published: "live" | "waiting_dns" | "no";
  /** last publish */
  publishedAt: string | null;
  google: "indexed" | "not_indexed" | "not_checked";
  /** when Google's URL Inspection last answered */
  googleCheckedAt: string | null;
  /** first time Google said indexed */
  googleIndexedAt: string | null;
}

/** The facts_page channel (written by publishFactsPage) plus the google_index row. */
export function factsPageStatus(channel: Pick<Channel, "url" | "status" | "lastSyncedAt"> | null, index: Pick<GoogleIndexState, "inspection" | "indexedAt"> | null): FactsPageStatus {
  const publishedAt = channel?.lastSyncedAt ?? null;
  const published = !publishedAt ? "no" : channel!.status === "synced" ? "live" : "waiting_dns";
  const inspection = index?.inspection ?? null;
  const google = !inspection ? "not_checked" : inspection.verdict === "PASS" ? "indexed" : "not_indexed";
  return { url: channel?.url ?? null, published, publishedAt, google, googleCheckedAt: inspection?.at ?? null, googleIndexedAt: index?.indexedAt ?? null };
}

export interface RobotLine {
  token: string;
  engines: Engine[];
  /** null = robots.txt could not be read */
  allowed: boolean | null;
}

export type SiteCheckView =
  | { state: "not_checked" }
  | { state: "no_domain"; at: string }
  | {
      state: "checked";
      at: string;
      domain: string;
      robots: RobotLine[];
      /** null = homepage could not be read */
      noindex: boolean | null;
      businessData: boolean | null;
      /** false = a different number in the business data; null = nothing to compare */
      phoneOk: boolean | null;
      /** the failing items, in the order the owner mail lists them */
      issues: SiteIssue[];
    };

/** The newest sitecheck.done or sitecheck.skipped event (events newest first, as listEvents returns them). */
export function siteCheckView(events: Pick<EventRow, "type" | "payload" | "at">[]): SiteCheckView {
  const e = events.find((x) => x.type === "sitecheck.done" || x.type === "sitecheck.skipped");
  if (!e) return { state: "not_checked" };
  if (e.type === "sitecheck.skipped") return { state: "no_domain", at: e.at };
  const p = e.payload as { domain?: string; robotsStatus?: number | null; homepageStatus?: number | null; issues?: SiteIssue[] };
  const issues = Array.isArray(p.issues) ? p.issues : [];
  // checkSite only parses a 200; any 4xx means "no rules" (RFC 9309), so every robot may read.
  const robotsKnown = typeof p.robotsStatus === "number" && (p.robotsStatus === 200 || (p.robotsStatus >= 400 && p.robotsStatus < 500));
  const blocked = new Set(issues.flatMap((i) => (i.kind === "robots_blocked" ? i.robots : [])));
  const robots = ANSWER_ROBOTS.map((r) => ({ token: r.token, engines: r.engines, allowed: robotsKnown ? !blocked.has(r.token) : null }));
  const pageKnown = p.homepageStatus === 200;
  const has = (kind: SiteIssue["kind"]) => issues.some((i) => i.kind === kind);
  const businessData = pageKnown ? !has("no_business_data") : null;
  return {
    state: "checked",
    at: e.at,
    domain: p.domain ?? "",
    robots,
    noindex: pageKnown ? has("noindex") : null,
    businessData,
    phoneOk: has("phone_mismatch") ? false : businessData ? true : null,
    issues,
  };
}
