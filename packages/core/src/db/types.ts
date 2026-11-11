/**
 * The Db interface: one set of typed query helpers, implemented by PgDb
 * (postgres.js, real Supabase/Postgres) and MemDb (Map-based, zero infra).
 * Rows come back as the camelCase types from ../types.
 */
import type {
  Business,
  BusinessStatus,
  Channel,
  Claim,
  Engine,
  Facts,
  Finding,
  FindingStatus,
  Fix,
  BusinessProfile,
  Prompt,
  PromptPool,
  ProfileMode,
  QuestionFamily,
  Sample,
  ScanKind,
  ScanRun,
} from "../types";
import type { RelayCounters, SupportLogRow } from "../support/kit-support";
import type { MailPrefs } from "../shared/mail-prefs";

/** Business plus the operational columns that exist in SQL but not in the shared Business type. */
export interface BusinessRecord extends Business {
  ownerUserId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  factsHost: string | null;
  factsHostVerifiedAt: string | null;
  anniversaryDay: number | null;
  /** Set when the owner proved ownership (see shared/ownership.ts); null = only claimed. */
  ownerVerifiedAt: string | null;
  ownerVerifiedVia: string | null;
  /** The owner's language ("nl" | "en"); the dashboard, the report and every mail to the owner follow it (letters to third parties stay Dutch). */
  language: "nl" | "en";
  /** The owner cancelled; the subscription ends at this moment (migration 0012). */
  cancelAt: string | null;
  /** The owner paused; nothing runs and nothing is charged until this moment (migration 0012). */
  pauseUntil: string | null;
  /** Optional mail groups the owner switched off or on (shared/mail-prefs.ts); absent = on. */
  mailPrefs: MailPrefs;
  /** The understanding step's profile (migration 0015); only setAutoProfile writes it. */
  profileAuto: BusinessProfile | null;
  /** The owner's correction; only setOwnerProfile writes it, an automatic profile never overwrites it. */
  profileOwner: BusinessProfile | null;
}

/** What Google's URL Inspection API last said about the facts page. */
export interface GoogleInspection {
  at: string;
  /** PASS = indexed; NEUTRAL / FAIL / PARTIAL / VERDICT_UNSPECIFIED otherwise */
  verdict: string;
  coverageState: string | null;
  indexingState: string | null;
  pageFetchState: string | null;
  robotsTxtState: string | null;
  lastCrawlTime: string | null;
  googleCanonical: string | null;
}

/** Search Console state of one business's facts page (table google_index). */
export interface GoogleIndexState {
  businessId: string;
  host: string;
  /** content of the google-site-verification meta tag served on the facts page */
  token: string | null;
  verifiedAt: string | null;
  addedAt: string | null;
  sitemapAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  inspection: GoogleInspection | null;
  /** first time the inspection said PASS */
  indexedAt: string | null;
  updatedAt: string;
}

export type GoogleIndexUpsert = Partial<Omit<GoogleIndexState, "businessId" | "updatedAt">> & { businessId: string; host: string };

export type BusinessUpsert = Partial<Omit<BusinessRecord, "createdAt">> & { name: string; place: string };

export type JobKind = "scan" | "publish" | "sync" | "fix" | "recheck" | "report" | (string & {});

export interface Job {
  id: number;
  kind: JobKind;
  payload: Record<string, unknown>;
  runAt: string;
  attempts: number;
  maxAttempts: number;
  lockedAt: string | null;
  doneAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface EventRow {
  id: number;
  businessId: string | null;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

/** One address on the coming-soon list (migration 0009). */
export interface WaitlistInput {
  /** Lower-cased, trimmed, validated by the caller. */
  email: string;
  language: "nl" | "en";
  /** Where it was left, e.g. "coming_soon". */
  source: string;
  /** The exact consent sentence shown next to the field, in that language. */
  consentText: string;
}

export type PromptInput = Omit<Prompt, "id" | "businessId"> & { businessId?: string };
export type SampleInput = Omit<Sample, "id" | "capturedAt"> & { capturedAt?: string };
export type ClaimInput = Claim;
/** What the scanner hands to upsertFindings; id/status/timestamps are managed by the db. */
export type FindingInput = Omit<Finding, "id" | "status" | "firstSeenAt" | "resolvedAt" | "evidenceAfter" | "verdict"> & {
  status?: FindingStatus;
  /** defaults to "wrong" */
  verdict?: Finding["verdict"];
};
export type FixInput = Omit<Fix, "id" | "scheduledAt" | "sentAt" | "recheckAt" | "resolvedAt" | "evidence"> &
  Partial<Pick<Fix, "scheduledAt" | "sentAt" | "recheckAt" | "resolvedAt" | "evidence">>;
export type ChannelUpsert = Omit<Channel, "id" | "status" | "lastSyncedAt"> &
  Partial<Pick<Channel, "id" | "status" | "lastSyncedAt">> & { meta?: Record<string, unknown> };

export interface ScanRunCreate {
  businessId: string;
  kind: ScanKind;
  engines: Engine[];
  samplesPerPrompt: number;
  status?: ScanRun["status"];
  /** The effective profile this scan is asked with (scan_run.profile). */
  profile?: BusinessProfile | null;
}

/**
 * One question template's use in one scan (ADR-0004: an append-only ledger). Holds only the template
 * key, family, mode, category and counts. `templateNl` has slots ({naam}, {plaats}), never a filled
 * question and never an owner's fact value. The Db adds an opaque per-business reference itself.
 */
export interface QuestionUseInput {
  scanRunId: string;
  category: string;
  mode: ProfileMode;
  templateKey: string;
  templateNl: string;
  family: QuestionFamily;
  intent: string | null;
  asked: number;
  usable: number;
}

/** question_library: the ledger summed per (category, mode, template). */
export interface LibraryRow {
  category: string;
  mode: ProfileMode;
  templateKey: string;
  templateNl: string;
  family: QuestionFamily;
  intent: string | null;
  asked: number;
  usable: number;
  /** How many DIFFERENT businesses were asked it (ADR-0004: thresholds count businesses, not answers). */
  businesses: number;
}

export interface ScanRunUpdate {
  status?: ScanRun["status"];
  startedAt?: string | null;
  finishedAt?: string | null;
  costCents?: number;
  error?: string | null;
}

export interface Db {
  readonly kind: "pg" | "mem";

  // --- business ---
  getBusiness(idOrSlug: string): Promise<BusinessRecord | null>;
  upsertBusiness(input: BusinessUpsert): Promise<BusinessRecord>;
  businessesDueForMonthlyScan(dayOfMonth: number): Promise<BusinessRecord[]>;
  getBusinessByFactsHost(host: string): Promise<BusinessRecord | null>;
  /** The business paying through this Stripe customer (invoices carry only the customer). */
  getBusinessByStripeCustomer(customerId: string): Promise<BusinessRecord | null>;
  listBusinessesByStatus(statuses: BusinessStatus[]): Promise<BusinessRecord[]>;
  /** Owner lookup for the dashboard: by owner_user_id first, then by owner_email (case-insensitive). */
  /**
   * Removes the business and everything that hangs off it (facts, prompts,
   * scans, samples, claims, findings, fixes, channels, events, index state)
   * and its jobs that have not run. The owner's "verwijder mijn gegevens".
   */
  deleteBusiness(id: string): Promise<void>;
  getBusinessByOwner(opts: { userId?: string | null; email?: string | null }): Promise<BusinessRecord | null>;
  /** Writes business.profile_auto only. A fallback profile is never stored here. */
  setAutoProfile(businessId: string, profile: BusinessProfile): Promise<void>;
  /** Writes business.profile_owner only. */
  setOwnerProfile(businessId: string, profile: BusinessProfile): Promise<void>;

  // --- facts (versioned, owner-asserted) ---
  latestFacts(businessId: string): Promise<Facts | null>;
  /** Every facts version, oldest first (the owner's data export). */
  listFacts(businessId: string): Promise<Facts[]>;
  insertFacts(businessId: string, data: Omit<Facts, "businessId" | "version" | "provisional" | "verifiedAt"> & Partial<Facts>, opts?: { provisional?: boolean; verifiedAt?: string | null }): Promise<Facts>;

  // --- prompts ---
  listPrompts(businessId: string, opts?: { activeOnly?: boolean }): Promise<Prompt[]>;
  insertPrompts(businessId: string, prompts: PromptInput[]): Promise<Prompt[]>;
  /** Move a prompt between the fixed set and the rotating bank. */
  setPromptPool(id: string, pool: PromptPool): Promise<void>;

  // --- scan runs, samples, claims ---
  createScanRun(input: ScanRunCreate): Promise<ScanRun>;
  updateScanRun(id: string, patch: ScanRunUpdate): Promise<ScanRun>;
  getScanRun(id: string): Promise<ScanRun | null>;
  /** Scan runs for a business, newest first. */
  listScanRuns(businessId: string, limit?: number): Promise<ScanRun[]>;
  /** When the business's latest scan run of this kind started; null if it never had one. */
  lastScanRunStartedAt(businessId: string, kind: ScanRun["kind"]): Promise<string | null>;
  insertSamples(samples: SampleInput[]): Promise<Sample[]>;
  listSamples(scanRunId: string): Promise<Sample[]>;
  insertClaims(claims: ClaimInput[]): Promise<Claim[]>;
  listClaims(sampleIds: string[]): Promise<Claim[]>;

  // --- question library (ledger of which templates produce usable answers) ---
  /** Insert; a row for an existing (scanRunId, templateKey) is ignored, so a retried scan counts once. */
  recordQuestionUse(rows: QuestionUseInput[]): Promise<void>;
  /** Ledger summed per (category, mode, templateKey). */
  questionLibrary(filter?: { category?: string; mode?: ProfileMode }): Promise<LibraryRow[]>;

  // --- findings ---
  listFindings(businessId: string, status?: FindingStatus | FindingStatus[]): Promise<Finding[]>;
  listFindingsByScanRun(scanRunId: string): Promise<Finding[]>;
  getFinding(id: string): Promise<Finding | null>;
  /** Match on business_id + fact_key + subject + engine + verdict (non-resolved rows); update frequency/sample_count/values/source/scan_run, else insert. */
  upsertFindings(findings: FindingInput[]): Promise<Finding[]>;
  updateFindingStatus(id: string, status: FindingStatus): Promise<Finding>;
  markFindingResolved(id: string, evidenceAfter?: string | null): Promise<Finding>;

  // --- job queue ---
  enqueueJob(kind: JobKind, payload?: Record<string, unknown>, runAt?: Date | string): Promise<Job>;
  /** SELECT ... FOR UPDATE SKIP LOCKED; sets locked_at and bumps attempts. Returns null when nothing is due. */
  claimJob(kinds?: JobKind[]): Promise<Job | null>;
  completeJob(id: number): Promise<void>;
  /** Releases the lock and reschedules with exponential backoff, or marks done when max_attempts is reached. */
  failJob(id: number, error: string): Promise<Job>;

  // --- events ---
  logEvent(businessId: string | null, type: string, payload?: Record<string, unknown>): Promise<EventRow>;
  listEvents(businessId: string, limit?: number): Promise<EventRow[]>;
  /** Events of this type on a business whose payload.email is this address (case-insensitive), latest first. */
  listEventsByEmail(type: string, email: string, limit?: number): Promise<EventRow[]>;
  /** Events of one type since a moment, across every business (rate limits). */
  countEventsSince(type: string, since: Date): Promise<number>;
  /** Engine cost of every scan run started at or after `since`, free checks excluded (the daily ceiling, review R-11). */
  paidScanCentsSince(since: Date): Promise<number>;

  // --- coming-soon list ---
  /**
   * Adds an address once. `created` is false when it was already on the list
   * (the row is left as it was, so a second sign-up cannot change the consent
   * on record or undo an unsubscribe).
   */
  joinWaitlist(input: WaitlistInput): Promise<{ created: boolean }>;

  // --- support@ auto-replies (migration 0010; ../support) ---
  /** The counters the responder needs before it answers: replied on this thread before, this sender's decisions in 24 h (any outcome), model calls in 24 h (all senders). */
  supportAutoreplyCounters(fromEmail: string, threadId: string | null): Promise<RelayCounters>;
  /** One row per decision. `duplicate` when this provider message id was recorded before: the relay must not send again. */
  recordSupportAutoreply(row: SupportLogRow): Promise<{ duplicate: boolean }>;
  /** Addresses on the list that have not unsubscribed. */
  countWaitlist(): Promise<number>;
  /** Addresses on the list that have not unsubscribed, oldest first (the launch mail, scripts/launch-mail.mts). */
  listWaitlist(): Promise<{ email: string; language: "nl" | "en" }[]>;

  // --- channels ---
  listChannels(businessId: string): Promise<Channel[]>;
  upsertChannel(input: ChannelUpsert): Promise<Channel>;

  // --- fixes ---
  listFixes(findingId: string): Promise<Fix[]>;
  getFix(id: string): Promise<Fix | null>;
  insertFix(input: FixInput): Promise<Fix>;
  updateFix(id: string, patch: Partial<Omit<Fix, "id" | "findingId">>): Promise<Fix>;
  /** Fixes whose recheck_at has passed and that are not resolved. */
  listDueRechecks(now?: Date): Promise<Fix[]>;

  // --- Google Search Console state of the facts page ---
  getGoogleIndex(businessId: string): Promise<GoogleIndexState | null>;
  /** Insert or merge: fields left out keep their value; pass null to clear one. */
  upsertGoogleIndex(input: GoogleIndexUpsert): Promise<GoogleIndexState>;

  /**
   * Runs `fn` while holding a lock named `key`, across every Worker and process on this
   * database (PgDb: pg_advisory_xact_lock in a transaction; MemDb: a queue per key).
   * For count-then-insert limits and single-use links that must hold under parallel
   * requests. `fn` uses the ordinary handle; keep it short.
   */
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;

  /** Close connections (no-op for MemDb). */
  close(): Promise<void>;
}
