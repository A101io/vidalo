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
  /** set when the daily AI ceiling moved this baseline or monthly check once; it then runs (jobs/spend.ts) */
  deferredOnce?: boolean;
}

export interface SetupJob {
  businessId: string;
  /** "domain" = feiten.{domain} via CNAME (default when the business has a domain), "fallback" = {slug}-feiten.vidalo.io */
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
      /** the owner's language for an owner mail (business.language); the HTML part follows it */
      lang?: "nl" | "en";
      template?: undefined;
    }
  | { template: "resolution"; findingId: string; businessId?: string }
  | { template: "unfixable"; findingId: string; note: string; businessId?: string }
  | { template: "welcome"; businessId: string }
  | { template: "baseline"; scanRunId: string; businessId?: string; /** the address that asked on the report page */ to?: string; lang?: "nl" | "en" }
  | { template: "report"; businessId: string; scanRunId?: string }
  | { template: "followup"; businessId: string; day: 7 | 21 }
  | { template: "reconfirm"; businessId: string }
  | { template: "deletion_reminder"; businessId: string }
  | { template: "directory_correction"; to: string; directory: string; listingUrl?: string | null; businessId: string; channelId?: string; diff: { field: string; current: string | null; expected: string | null }[]; reminder?: boolean; firstSentAt?: string };

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

/** Feature 002: delete a business when its guard allows (core/shared/purge.ts). */
export interface PurgeJob {
  businessId: string;
  guard: "no_subscription" | "due";
}

/** Feature 002: end the Google connection (revoke at Google, delete the channel). */
export interface GoogleDisconnectJob {
  businessId: string;
  reason: "churn" | "purge" | "scan_done";
}

/** Feature 002, R2: delete a login whose deletion failed during a purge (Supabase Admin), once it has no business. */
export interface LoginDeleteJob {
  userId: string;
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
  purge: PurgeJob;
  google_disconnect: GoogleDisconnectJob;
  login_delete: LoginDeleteJob;
};

export type JobKind = keyof JobPayloads;
export const JOB_KINDS: JobKind[] = ["scan", "setup", "publish", "sync", "fixes", "fix", "recheck", "email", "report", "followup", "operator_task", "sitecheck", "index_check", "purge", "google_disconnect", "login_delete"];

export type Handler<K extends JobKind> = (payload: JobPayloads[K], job: Job) => Promise<Record<string, unknown> | void>;
