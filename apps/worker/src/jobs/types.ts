/**
 * Job kinds and payload shapes. The web app enqueues `setup`, `scan` (free),
 * `publish`, `sync`, `report` and `email`; everything else is enqueued by the
 * worker itself.
 */
import type { Engine, ScanKind } from "@vidalo/core/types";
import type { Job } from "@vidalo/core/db";

export interface ScanJob {
  businessId: string;
  kind: ScanKind;
  engines?: Engine[];
  samplesPerPrompt?: number;
  promptIds?: string[];
  /** what to do when the scan is done (defaults by kind: baseline → fixes+baseline mail, monthly → fixes+report) */
  then?: ("fixes" | "report" | "baseline_summary")[];
}

export interface SetupJob {
  businessId: string;
  /** "domain" = feiten.{domain} via CNAME (default when the business has a domain), "fallback" = {slug}.feiten.vidalo.io */
  hostChoice?: "domain" | "fallback";
  /** skip the welcome mail (e.g. re-run) */
  skipWelcome?: boolean;
}

export interface PublishJob {
  businessId: string;
  reason?: string;
}

export interface SyncJob {
  businessId: string;
  channelIds?: string[];
}

export interface FixesJob {
  scanRunId: string;
}

export interface RecheckJob {
  fixId: string;
}

export type EmailJob =
  | {
      to: string | string[];
      subject: string;
      text: string;
      html?: string;
      replyTo?: string;
      businessId?: string;
      findingId?: string;
      fixId?: string;
      kind?: string;
      template?: undefined;
    }
  | { template: "resolution"; findingId: string; businessId?: string }
  | { template: "unfixable"; findingId: string; note: string; businessId?: string }
  | { template: "welcome"; businessId: string }
  | { template: "baseline"; scanRunId: string; businessId?: string }
  | { template: "report"; businessId: string; scanRunId?: string }
  | { template: "followup"; businessId: string; day: 7 | 21 }
  | { template: "directory_correction"; to: string; directory: string; listingUrl?: string | null; businessId: string; channelId?: string; diff: { field: string; current: string | null; expected: string | null }[] };

export interface ReportJob {
  businessId: string;
  scanRunId?: string;
}

export interface FollowUpJob {
  businessId: string;
  day: 7 | 21;
}

/** Check the owner's own website (robots.txt, noindex, business data); mails the owner on a new problem. */
export interface SiteCheckJob {
  businessId: string;
}

/** Search Console: verify the facts host, add it, submit the sitemap, inspect the page. */
export interface IndexCheckJob {
  businessId: string;
}

export interface OperatorTaskJob {
  reason: string;
  businessId?: string | null;
  [k: string]: unknown;
}

export type JobPayloads = {
  scan: ScanJob;
  setup: SetupJob;
  publish: PublishJob;
  sync: SyncJob;
  fixes: FixesJob;
  fix: FixesJob; // alias (CONTRACT.md names it "fix")
  recheck: RecheckJob;
  email: EmailJob;
  report: ReportJob;
  followup: FollowUpJob;
  operator_task: OperatorTaskJob;
  sitecheck: SiteCheckJob;
  index_check: IndexCheckJob;
};

export type JobKind = keyof JobPayloads;
export const JOB_KINDS: JobKind[] = ["scan", "setup", "publish", "sync", "fixes", "fix", "recheck", "email", "report", "followup", "operator_task", "sitecheck", "index_check"];

export type Handler<K extends JobKind> = (payload: JobPayloads[K], job: Job) => Promise<Record<string, unknown> | void>;
