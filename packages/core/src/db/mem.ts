/**
 * MemDb: in-memory implementation of Db (Map-based). Used when DATABASE_URL is
 * missing or VIDALO_MOCK=1, so the CLI and tests run with zero infrastructure.
 * Semantics mirror PgDb (same matching rules for upserts, same job backoff).
 */
import { randomUUID } from "node:crypto";
import type { BusinessProfile, BusinessStatus, Channel, Claim, Facts, Finding, FindingStatus, Fix, ProfileMode, Prompt, PromptPool, Sample, ScanRun } from "../types";
import { slugify } from "../scanner/normalize";
import { normalizeMailPrefs } from "../shared/mail-prefs";
import type {
  BusinessRecord,
  BusinessUpsert,
  ChannelUpsert,
  ClaimInput,
  Db,
  EventRow,
  FindingInput,
  FixInput,
  GoogleIndexState,
  GoogleIndexUpsert,
  Job,
  JobKind,
  PromptInput,
  SampleInput,
  ScanRunCreate,
  ScanRunUpdate,
  WaitlistInput,
  LibraryRow,
  QuestionUseInput,
  BrowserFamily,
  OsFamily,
  SignInEnd,
  SignInRow,
} from "./types";
import type { RelayCounters, SupportLogRow } from "../support/kit-support";
import type { PurgeGuard } from "./types";
import { purgeAllowed } from "../shared/deletion";

const nowIso = () => new Date().toISOString();

/** Columns only their own methods write (upsertBusiness never does), as in PgDb. */
const MEM_OWN_COLUMNS = new Set(["profileAuto", "profileOwner", "lastActiveAt", "churnedAt", "deleteAt", "deleteReason", "deletionRemindedAt"]);
const DAY_MS = 86_400_000;

/** The business_retention trigger of migration 0019, rule for rule, and its CHECK. */
function retentionTrigger(old: BusinessRecord | null, b: BusinessRecord): void {
  const now = new Date();
  if (b.status === "churned" && old?.status !== "churned") {
    b.churnedAt = now.toISOString();
    if (!b.deleteAt) {
      b.deleteAt = new Date(now.getTime() + 120 * DAY_MS).toISOString();
      b.deleteReason = "retention";
    }
  }
  if (b.status === "churned" && !b.deleteAt) {
    b.deleteAt = new Date(Date.parse(b.churnedAt ?? now.toISOString()) + 120 * DAY_MS).toISOString();
    b.deleteReason = "retention";
    b.deletionRemindedAt = null;
  }
  const scanRetention = b.plan === "setup" && b.status === "trial" && b.deleteReason === "retention";
  // A change of plan counts too: a dated Scan that buys Monthly loses its retention date (V-SEC-01).
  const changed = !old || old.status !== b.status || old.cancelAt !== b.cancelAt || old.plan !== b.plan;
  if (changed && (b.status === "trial" || b.status === "active" || b.status === "paused") && !b.cancelAt && !scanRetention) {
    b.deleteAt = null;
    b.deleteReason = null;
    b.deletionRemindedAt = null;
    if (old?.status === "churned") b.churnedAt = null;
  }
  if ((b.status === "trial" || b.status === "active") && old?.status !== b.status) b.lastActiveAt = now.toISOString();
  checkDeletion(b);
}

/** business_delete_reason_with_date and business_delete_only_when_ending (migration 0019). */
function checkDeletion(b: BusinessRecord): void {
  if ((b.deleteAt === null) !== (b.deleteReason === null)) throw new Error("violates check constraint business_delete_reason_with_date");
  const ok = b.deleteAt === null || b.status === "scanned" || b.status === "churned" || b.cancelAt !== null || (b.plan === "setup" && b.status === "trial" && b.deleteReason === "retention");
  if (!ok) throw new Error("violates check constraint business_delete_only_when_ending");
}
const OPEN_STATUSES: FindingStatus[] = ["open", "fixing", "recheck"];

export class MemDb implements Db {
  readonly kind = "mem" as const;
  businesses = new Map<string, BusinessRecord>();
  facts = new Map<string, Facts[]>(); // businessId -> versions asc
  prompts = new Map<string, Prompt>();
  scanRuns = new Map<string, ScanRun>();
  samples = new Map<string, Sample>();
  claims: Claim[] = [];
  findings = new Map<string, Finding>();
  jobs = new Map<number, Job>();
  events: EventRow[] = [];
  channels = new Map<string, Channel>();
  fixes = new Map<string, Fix>();
  googleIndex = new Map<string, GoogleIndexState>();
  waitlist = new Map<string, WaitlistInput & { createdAt: string; unsubscribedAt: string | null }>();
  supportLog: Array<SupportLogRow & { createdAt: string }> = [];
  /** The ledger. businessRef is the opaque per-business reference (PgDb: business.question_ref); scanRunId goes null with its business. */
  questionUse: Array<Omit<QuestionUseInput, "scanRunId"> & { scanRunId: string | null; businessRef: string }> = [];
  private questionRefs = new Map<string, string>();
  /** auth_session (migration 0018), by session id. */
  signIns = new Map<string, SignInRow>();
  /** auth_throttle (migration 0018). */
  authThrottle: { keyHash: string; at: string }[] = [];
  private jobSeq = 1;
  private eventSeq = 1;

  /** Wipe everything (tests). */
  reset(): void {
    this.businesses.clear();
    this.facts.clear();
    this.prompts.clear();
    this.scanRuns.clear();
    this.samples.clear();
    this.claims = [];
    this.findings.clear();
    this.jobs.clear();
    this.events = [];
    this.supportLog = [];
    this.channels.clear();
    this.fixes.clear();
    this.googleIndex.clear();
    this.waitlist.clear();
    this.questionUse = [];
    this.questionRefs.clear();
    this.signIns.clear();
    this.authThrottle = [];
  }

  // --- business ---
  async getBusiness(idOrSlug: string): Promise<BusinessRecord | null> {
    const byId = this.businesses.get(idOrSlug);
    if (byId) return { ...byId };
    for (const b of this.businesses.values()) if (b.slug === idOrSlug) return { ...b };
    return null;
  }

  async upsertBusiness(input: BusinessUpsert): Promise<BusinessRecord> {
    const slug = input.slug ?? slugify(input.name, input.place);
    let existing: BusinessRecord | undefined;
    if (input.id) existing = this.businesses.get(input.id);
    if (!existing) for (const b of this.businesses.values()) if (b.slug === slug) existing = b;
    const base: BusinessRecord = existing ?? {
      id: input.id ?? randomUUID(),
      slug,
      name: input.name,
      place: input.place,
      country: "NL",
      domain: null,
      kvk: null,
      googlePlaceId: null,
      sector: null,
      plan: "none",
      status: "scanned",
      ownerEmail: null,
      ownerUserId: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      factsHost: null,
      factsHostVerifiedAt: null,
      anniversaryDay: null,
      ownerVerifiedAt: null,
      ownerVerifiedVia: null,
      language: "nl",
      cancelAt: null,
      pauseUntil: null,
      mailPrefs: {},
      profileAuto: null,
      profileOwner: null,
      lastActiveAt: null,
      churnedAt: null,
      deleteAt: null,
      deleteReason: null,
      deletionRemindedAt: null,
      createdAt: nowIso(),
    };
    const merged: BusinessRecord = { ...base };
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined && k !== "id" && k !== "createdAt" && !MEM_OWN_COLUMNS.has(k)) (merged as unknown as Record<string, unknown>)[k] = v;
    }
    merged.slug = base.slug;
    merged.mailPrefs = normalizeMailPrefs(merged.mailPrefs);
    retentionTrigger(existing ?? null, merged);
    this.businesses.set(merged.id, merged);
    return { ...merged };
  }

  async setAutoProfile(businessId: string, profile: BusinessProfile): Promise<void> {
    const b = this.businesses.get(businessId);
    if (!b) throw new Error(`business ${businessId} not found`);
    b.profileAuto = { ...profile, competitors: [...profile.competitors], basis: [...profile.basis] };
  }

  async setOwnerProfile(businessId: string, profile: BusinessProfile): Promise<void> {
    const b = this.businesses.get(businessId);
    if (!b) throw new Error(`business ${businessId} not found`);
    b.profileOwner = { ...profile, competitors: [...profile.competitors], basis: [...profile.basis] };
  }

  async businessesDueForMonthlyScan(dayOfMonth: number): Promise<BusinessRecord[]> {
    const lastDay = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    return [...this.businesses.values()].filter(
      (b) =>
        (b.status === "trial" || b.status === "active") &&
        b.plan === "monitor" &&
        !(b.pauseUntil && new Date(b.pauseUntil) > new Date()) &&
        b.anniversaryDay != null &&
        (b.anniversaryDay === dayOfMonth || (dayOfMonth === lastDay && b.anniversaryDay > lastDay)),
    );
  }

  async getBusinessByFactsHost(host: string): Promise<BusinessRecord | null> {
    const h = host.toLowerCase();
    // Same order as PgDb: the earliest verified holder first.
    const all = [...this.businesses.values()].filter((b) => b.factsHost?.toLowerCase() === h);
    const time = (b: BusinessRecord) => (b.factsHostVerifiedAt ? Date.parse(b.factsHostVerifiedAt) : Number.POSITIVE_INFINITY);
    const found = all.sort((a, b) => time(a) - time(b))[0];
    return found ? { ...found } : null;
  }

  async getBusinessByStripeCustomer(customerId: string): Promise<BusinessRecord | null> {
    for (const b of this.businesses.values()) if (b.stripeCustomerId === customerId) return { ...b };
    return null;
  }

  async getBusinessByOwner(opts: { userId?: string | null; email?: string | null }): Promise<BusinessRecord | null> {
    if (opts.userId) for (const b of this.businesses.values()) if (b.ownerUserId === opts.userId) return { ...b };
    if (opts.email) {
      const e = opts.email.toLowerCase();
      for (const b of this.businesses.values()) if (b.ownerEmail?.toLowerCase() === e) return { ...b };
    }
    return null;
  }

  async listBusinessesByStatus(statuses: BusinessStatus[]): Promise<BusinessRecord[]> {
    return [...this.businesses.values()].filter((b) => statuses.includes(b.status)).map((b) => ({ ...b }));
  }

  // --- facts ---
  async listFacts(businessId: string): Promise<Facts[]> {
    return (this.facts.get(businessId) ?? []).map((f) => ({ ...f }));
  }

  async deleteBusiness(id: string): Promise<void> {
    this.businesses.delete(id);
    this.facts.delete(id);
    this.googleIndex.delete(id);
    for (const [k, p] of this.prompts) if (p.businessId === id) this.prompts.delete(k);
    const runs = new Set([...this.scanRuns.values()].filter((r) => r.businessId === id).map((r) => r.id));
    for (const r of runs) this.scanRuns.delete(r);
    const samples = new Set([...this.samples.values()].filter((s) => runs.has(s.scanRunId)).map((s) => s.id));
    for (const s of samples) this.samples.delete(s);
    this.claims = this.claims.filter((c) => !samples.has(c.sampleId));
    const findings = new Set([...this.findings.values()].filter((f) => f.businessId === id).map((f) => f.id));
    for (const f of findings) this.findings.delete(f);
    for (const [k, f] of this.fixes) if (findings.has(f.findingId)) this.fixes.delete(k);
    for (const [k, c] of this.channels) if (c.businessId === id) this.channels.delete(k);
    this.events = this.events.filter((e) => e.businessId !== id);
    for (const [k, j] of this.jobs) if (!j.doneAt && j.payload.businessId === id) this.jobs.delete(k);
    // Like PgDb: the ledger rows stay, unlinked (run id null, and the business's reference is gone with it).
    for (const u of this.questionUse) if (u.scanRunId && runs.has(u.scanRunId)) u.scanRunId = null;
    this.questionRefs.delete(id);
  }

  async latestFacts(businessId: string): Promise<Facts | null> {
    const list = this.facts.get(businessId);
    return list && list.length ? { ...list[list.length - 1]! } : null;
  }

  async insertFacts(businessId: string, data: Parameters<Db["insertFacts"]>[1], opts: { provisional?: boolean; verifiedAt?: string | null } = {}): Promise<Facts> {
    const list = this.facts.get(businessId) ?? [];
    const version = (list[list.length - 1]?.version ?? 0) + 1;
    const provisional = opts.provisional ?? data.provisional ?? true;
    // The profile is copied in by withProfile() and never stored with the facts (ADR-0001).
    const { profile: _profile, ...stored } = data as Facts;
    const row: Facts = { ...stored, businessId, version, provisional, verifiedAt: opts.verifiedAt ?? data.verifiedAt ?? null, createdAt: nowIso() };
    list.push(row);
    this.facts.set(businessId, list);
    return { ...row };
  }

  // --- prompts ---
  async listPrompts(businessId: string, opts: { activeOnly?: boolean } = {}): Promise<Prompt[]> {
    return [...this.prompts.values()].filter((p) => p.businessId === businessId && (!opts.activeOnly || p.active));
  }

  async insertPrompts(businessId: string, prompts: PromptInput[]): Promise<Prompt[]> {
    return prompts.map((p) => {
      const row: Prompt = { id: randomUUID(), businessId, category: p.category, textNl: p.textNl, probes: [...p.probes], active: p.active ?? true, criterium: p.criterium ?? null, kind: p.kind ?? "about", intent: p.intent ?? null, pool: p.pool ?? "core", season: p.season ?? null, templateKey: p.templateKey ?? null };
      this.prompts.set(row.id, row);
      return { ...row };
    });
  }

  async setPromptPool(id: string, pool: PromptPool): Promise<void> {
    const row = this.prompts.get(id);
    if (row) row.pool = pool;
  }

  // --- scan runs ---
  async createScanRun(input: ScanRunCreate): Promise<ScanRun> {
    const row: ScanRun = {
      id: randomUUID(),
      businessId: input.businessId,
      kind: input.kind,
      engines: [...input.engines],
      samplesPerPrompt: input.samplesPerPrompt,
      startedAt: nowIso(),
      finishedAt: null,
      costCents: 0,
      status: input.status ?? "queued",
      profile: input.profile ?? null,
    };
    this.scanRuns.set(row.id, row);
    return { ...row };
  }

  // --- question library ---
  async recordQuestionUse(rows: QuestionUseInput[]): Promise<void> {
    for (const r of rows) {
      if (this.questionUse.some((u) => u.scanRunId === r.scanRunId && u.templateKey === r.templateKey)) continue;
      // PgDb refuses a run that does not exist (foreign key); MemDb stays lenient so a bare ledger test needs no business.
      const owner = this.scanRuns.get(r.scanRunId)?.businessId ?? `run:${r.scanRunId}`;
      let ref = this.questionRefs.get(owner);
      if (!ref) this.questionRefs.set(owner, (ref = randomUUID()));
      this.questionUse.push({ ...r, businessRef: ref });
    }
  }

  async questionLibrary(filter: { category?: string; mode?: ProfileMode } = {}): Promise<LibraryRow[]> {
    const sums = new Map<string, LibraryRow>();
    const refs = new Map<string, Set<string>>();
    for (const u of this.questionUse) {
      if (filter.category !== undefined && u.category !== filter.category) continue;
      if (filter.mode !== undefined && u.mode !== filter.mode) continue;
      const key = `${u.category}\u0000${u.mode}\u0000${u.templateKey}`;
      const row = sums.get(key);
      if (row) {
        row.asked += u.asked;
        row.usable += u.usable;
        refs.get(key)!.add(u.businessRef);
      } else {
        sums.set(key, { category: u.category, mode: u.mode, templateKey: u.templateKey, templateNl: u.templateNl, family: u.family, intent: u.intent, asked: u.asked, usable: u.usable, businesses: 0 });
        refs.set(key, new Set([u.businessRef]));
      }
    }
    for (const [k, row] of sums) row.businesses = refs.get(k)!.size;
    return [...sums.values()];
  }

  async updateScanRun(id: string, patch: ScanRunUpdate): Promise<ScanRun> {
    const row = this.scanRuns.get(id);
    if (!row) throw new Error(`scan_run ${id} not found`);
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.startedAt !== undefined && patch.startedAt !== null) row.startedAt = patch.startedAt;
    if (patch.finishedAt !== undefined) row.finishedAt = patch.finishedAt;
    if (patch.costCents !== undefined) row.costCents = patch.costCents;
    return { ...row };
  }

  async lastScanRunStartedAt(businessId: string, kind: ScanRun["kind"]): Promise<string | null> {
    const runs = [...this.scanRuns.values()].filter((r) => r.businessId === businessId && r.kind === kind).map((r) => r.startedAt).sort();
    return runs.at(-1) ?? null;
  }

  async listScanRuns(businessId: string, limit = 50): Promise<ScanRun[]> {
    return [...this.scanRuns.values()]
      .filter((r) => r.businessId === businessId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async getScanRun(id: string): Promise<ScanRun | null> {
    const r = this.scanRuns.get(id);
    return r ? { ...r } : null;
  }

  async insertSamples(samples: SampleInput[]): Promise<Sample[]> {
    return samples.map((s) => {
      const row: Sample = { ...s, id: randomUUID(), citations: [...s.citations], capturedAt: s.capturedAt ?? nowIso() };
      this.samples.set(row.id, row);
      return { ...row };
    });
  }

  async listSamples(scanRunId: string): Promise<Sample[]> {
    return [...this.samples.values()].filter((s) => s.scanRunId === scanRunId);
  }

  async insertClaims(claims: ClaimInput[]): Promise<Claim[]> {
    const rows = claims.map((c) => ({ ...c }));
    this.claims.push(...rows);
    return rows.map((c) => ({ ...c }));
  }

  async listClaims(sampleIds: string[]): Promise<Claim[]> {
    const set = new Set(sampleIds);
    return this.claims.filter((c) => set.has(c.sampleId)).map((c) => ({ ...c }));
  }

  // --- findings ---
  async listFindings(businessId: string, status?: FindingStatus | FindingStatus[]): Promise<Finding[]> {
    const statuses = status == null ? null : Array.isArray(status) ? status : [status];
    return [...this.findings.values()]
      .filter((f) => f.businessId === businessId && (!statuses || statuses.includes(f.status)))
      .sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt));
  }

  async listFindingsByScanRun(scanRunId: string): Promise<Finding[]> {
    return [...this.findings.values()].filter((f) => f.scanRunId === scanRunId);
  }

  async getFinding(id: string): Promise<Finding | null> {
    const f = this.findings.get(id);
    return f ? { ...f } : null;
  }

  async upsertFindings(inputs: FindingInput[]): Promise<Finding[]> {
    return inputs.map((f) => {
      const existing = [...this.findings.values()].find(
        (x) =>
          x.businessId === f.businessId &&
          x.factKey === f.factKey &&
          (x.subject ?? null) === (f.subject ?? null) &&
          x.engine === f.engine &&
          x.verdict === (f.verdict ?? "wrong") &&
          (x.evidenceKind ?? "about") === (f.evidenceKind ?? "about") &&
          OPEN_STATUSES.includes(x.status),
      );
      if (existing) {
        Object.assign(existing, {
          scanRunId: f.scanRunId,
          wrongValue: f.wrongValue,
          correctValue: f.correctValue,
          frequency: f.frequency,
          sampleCount: f.sampleCount,
          sourceUrl: f.sourceUrl ?? existing.sourceUrl,
          sourceType: f.sourceType !== "none" ? f.sourceType : existing.sourceType,
          status: f.status ?? existing.status,
          evidenceBefore: existing.evidenceBefore ?? f.evidenceBefore,
          criterium: f.criterium ?? existing.criterium ?? null,
        });
        return { ...existing };
      }
      const row: Finding = {
        id: randomUUID(),
        ...f,
        verdict: f.verdict ?? "wrong",
        evidenceKind: f.evidenceKind ?? "about",
        criterium: f.criterium ?? null,
        status: f.status ?? "open",
        firstSeenAt: nowIso(),
        resolvedAt: null,
        evidenceAfter: null,
      };
      this.findings.set(row.id, row);
      return { ...row };
    });
  }

  async updateFindingStatus(id: string, status: FindingStatus): Promise<Finding> {
    const f = this.findings.get(id);
    if (!f) throw new Error(`finding ${id} not found`);
    f.status = status;
    return { ...f };
  }

  async markFindingResolved(id: string, evidenceAfter: string | null = null): Promise<Finding> {
    const f = this.findings.get(id);
    if (!f) throw new Error(`finding ${id} not found`);
    f.status = "resolved";
    f.resolvedAt = nowIso();
    if (evidenceAfter) f.evidenceAfter = evidenceAfter;
    return { ...f };
  }

  // --- jobs ---
  async enqueueJob(kind: JobKind, payload: Record<string, unknown> = {}, runAt?: Date | string): Promise<Job> {
    const row: Job = {
      id: this.jobSeq++,
      kind,
      payload: { ...payload },
      runAt: runAt ? new Date(runAt).toISOString() : nowIso(),
      attempts: 0,
      maxAttempts: 5,
      lockedAt: null,
      doneAt: null,
      error: null,
      createdAt: nowIso(),
    };
    this.jobs.set(row.id, row);
    return { ...row };
  }

  async claimJob(kinds?: JobKind[]): Promise<Job | null> {
    const now = Date.now();
    const stale = now - 15 * 60 * 1000;
    const due = [...this.jobs.values()]
      .filter(
        (j) =>
          j.doneAt === null &&
          (j.lockedAt === null || new Date(j.lockedAt).getTime() < stale) &&
          new Date(j.runAt).getTime() <= now &&
          (!kinds || kinds.includes(j.kind)),
      )
      .sort((a, b) => a.runAt.localeCompare(b.runAt) || a.id - b.id);
    const job = due[0];
    if (!job) return null;
    job.lockedAt = nowIso();
    job.attempts += 1;
    return { ...job, payload: { ...job.payload } };
  }

  async completeJob(id: number): Promise<void> {
    const j = this.jobs.get(id);
    if (j) {
      j.doneAt = nowIso();
      j.lockedAt = null;
    }
  }

  async failJob(id: number, error: string): Promise<Job> {
    const j = this.jobs.get(id);
    if (!j) throw new Error(`job ${id} not found`);
    j.error = error;
    j.lockedAt = null;
    if (j.attempts >= j.maxAttempts) {
      j.doneAt = nowIso();
    } else {
      j.runAt = new Date(Date.now() + backoffMs(j.attempts)).toISOString();
    }
    return { ...j };
  }

  // --- events ---
  async logEvent(businessId: string | null, type: string, payload: Record<string, unknown> = {}): Promise<EventRow> {
    const row: EventRow = { id: this.eventSeq++, businessId, type, payload: { ...payload }, at: nowIso() };
    this.events.push(row);
    return { ...row };
  }

  async listEvents(businessId: string, limit = 100): Promise<EventRow[]> {
    return this.events.filter((e) => e.businessId === businessId).slice(-limit).reverse();
  }

  async listEventsByEmail(type: string, email: string, limit = 50): Promise<EventRow[]> {
    const want = email.trim().toLowerCase();
    return this.events
      .filter((e) => e.type === type && e.businessId && String((e.payload as Record<string, unknown>).email ?? "").toLowerCase() === want)
      .slice()
      .reverse()
      .slice(0, limit);
  }

  async countEventsSince(type: string, since: Date): Promise<number> {
    return this.events.filter((e) => e.type === type && new Date(e.at).getTime() >= since.getTime()).length;
  }

  async paidScanCentsSince(since: Date): Promise<number> {
    return [...this.scanRuns.values()].filter((r) => r.kind !== "free" && new Date(r.startedAt).getTime() >= since.getTime()).reduce((n, r) => n + (r.costCents ?? 0), 0);
  }

  // --- coming-soon list ---
  async joinWaitlist(input: WaitlistInput): Promise<{ created: boolean }> {
    if (this.waitlist.has(input.email)) return { created: false };
    this.waitlist.set(input.email, { ...input, createdAt: nowIso(), unsubscribedAt: null });
    return { created: true };
  }

  async countWaitlist(): Promise<number> {
    return [...this.waitlist.values()].filter((w) => w.unsubscribedAt === null).length;
  }

  // --- support@ auto-replies ---
  async supportAutoreplyCounters(fromEmail: string, threadId: string | null): Promise<RelayCounters> {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const today = this.supportLog.filter((r) => new Date(r.createdAt).getTime() > dayAgo);
    return {
      alreadyRepliedInThread: threadId !== null && this.supportLog.some((r) => r.provider_thread_id === threadId && r.action === "replied"),
      decisionsForSenderToday: today.filter((r) => r.from_email === fromEmail).length,
      modelCallsToday: today.reduce((n, r) => n + (r.model_calls ?? 0), 0),
    };
  }

  async recordSupportAutoreply(row: SupportLogRow): Promise<{ duplicate: boolean }> {
    if (row.provider_message_id && this.supportLog.some((r) => r.provider_message_id === row.provider_message_id)) return { duplicate: true };
    this.supportLog.push({ ...row, createdAt: nowIso() });
    return { duplicate: false };
  }

  async listWaitlist(): Promise<{ email: string; language: "nl" | "en" }[]> {
    return [...this.waitlist.values()].filter((w) => w.unsubscribedAt === null).map((w) => ({ email: w.email, language: w.language }));
  }

  // --- channels ---
  async listChannels(businessId: string): Promise<Channel[]> {
    return [...this.channels.values()].filter((c) => c.businessId === businessId);
  }

  async upsertChannel(input: ChannelUpsert): Promise<Channel> {
    let existing: Channel | undefined;
    if (input.id) existing = this.channels.get(input.id);
    if (!existing)
      existing = [...this.channels.values()].find(
        (c) => c.businessId === input.businessId && c.type === input.type && c.name === input.name,
      );
    const row: Channel = {
      id: existing?.id ?? randomUUID(),
      businessId: input.businessId,
      type: input.type,
      name: input.name,
      externalId: input.externalId ?? existing?.externalId ?? null,
      url: input.url ?? existing?.url ?? null,
      status: input.status ?? existing?.status ?? "pending",
      lastSyncedAt: input.lastSyncedAt ?? existing?.lastSyncedAt ?? null,
      meta: input.meta ?? existing?.meta ?? {},
    };
    this.channels.set(row.id, row);
    return { ...row };
  }

  // --- fixes ---
  async listFixes(findingId: string): Promise<Fix[]> {
    return [...this.fixes.values()].filter((f) => f.findingId === findingId);
  }

  async getFix(id: string): Promise<Fix | null> {
    const f = this.fixes.get(id);
    return f ? { ...f } : null;
  }

  async insertFix(input: FixInput): Promise<Fix> {
    const row: Fix = {
      id: randomUUID(),
      findingId: input.findingId,
      action: input.action,
      target: input.target,
      scheduledAt: input.scheduledAt ?? nowIso(),
      sentAt: input.sentAt ?? null,
      recheckAt: input.recheckAt ?? null,
      resolvedAt: input.resolvedAt ?? null,
      evidence: { ...(input.evidence ?? {}) },
    };
    this.fixes.set(row.id, row);
    return { ...row };
  }

  async updateFix(id: string, patch: Partial<Omit<Fix, "id" | "findingId">>): Promise<Fix> {
    const f = this.fixes.get(id);
    if (!f) throw new Error(`fix ${id} not found`);
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (f as unknown as Record<string, unknown>)[k] = v;
    return { ...f };
  }

  async listDueRechecks(now: Date = new Date()): Promise<Fix[]> {
    return [...this.fixes.values()].filter((f) => f.resolvedAt === null && f.recheckAt !== null && new Date(f.recheckAt) <= now);
  }

  // --- Google Search Console state ---
  async getGoogleIndex(businessId: string): Promise<GoogleIndexState | null> {
    const row = this.googleIndex.get(businessId);
    return row ? structuredClone(row) : null;
  }

  async upsertGoogleIndex(input: GoogleIndexUpsert): Promise<GoogleIndexState> {
    const existing = this.googleIndex.get(input.businessId);
    const empty: GoogleIndexState = { businessId: input.businessId, host: input.host, token: null, verifiedAt: null, addedAt: null, sitemapAt: null, lastAttemptAt: null, lastError: null, inspection: null, indexedAt: null, updatedAt: "" };
    const defined = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const row: GoogleIndexState = { ...(existing ?? empty), ...defined, updatedAt: new Date().toISOString() };
    this.googleIndex.set(row.businessId, row);
    return structuredClone(row);
  }

  // --- sign-ins (feature 002, migration 0018) ---
  async recordSignIn(row: { sessionId: string; userId: string; browser: BrowserFamily; os: OsFamily; at: Date }): Promise<void> {
    for (const b of this.businesses.values()) if (b.ownerUserId === row.userId) b.lastActiveAt = row.at.toISOString();
    if (!this.signIns.has(row.sessionId)) {
      const at = row.at.toISOString();
      this.signIns.set(row.sessionId, { sessionId: row.sessionId, userId: row.userId, signedInAt: at, lastSeenAt: at, endedAt: null, endedReason: null, browser: row.browser, os: row.os });
    }
    const keep = new Set(
      [...this.signIns.values()]
        .filter((r) => r.userId === row.userId)
        .sort((a, b) => b.signedInAt.localeCompare(a.signedInAt))
        .slice(0, 10)
        .map((r) => r.sessionId),
    );
    for (const r of [...this.signIns.values()]) if (r.userId === row.userId && r.endedAt && !keep.has(r.sessionId)) this.signIns.delete(r.sessionId);
  }

  async getSignIn(sessionId: string): Promise<SignInRow | null> {
    const r = this.signIns.get(sessionId);
    return r ? { ...r } : null;
  }

  async touchSignIn(sessionId: string, at: Date): Promise<void> {
    const r = this.signIns.get(sessionId);
    if (r && !r.endedAt && Date.parse(r.lastSeenAt) < at.getTime() - 3_600_000) r.lastSeenAt = at.toISOString();
  }

  async endSignIns(userId: string, reason: SignInEnd, opts: { sessionId?: string } = {}): Promise<number> {
    let n = 0;
    const now = nowIso();
    for (const r of this.signIns.values()) {
      if (r.userId !== userId || r.endedAt || (opts.sessionId && r.sessionId !== opts.sessionId)) continue;
      r.endedAt = now < r.signedInAt ? r.signedInAt : now;
      r.endedReason = reason;
      n++;
    }
    return n;
  }

  async listSignIns(userId: string, limit: number): Promise<SignInRow[]> {
    return [...this.signIns.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.signedInAt.localeCompare(a.signedInAt))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async deleteSignIns(userId: string): Promise<void> {
    for (const r of [...this.signIns.values()]) if (r.userId === userId) this.signIns.delete(r.sessionId);
  }

  async throttleAuth(keyHashes: string[], since: Date): Promise<number[]> {
    // Like PgDb: the rows already in the window, plus this request's own row(s).
    const before = keyHashes.map((k) => this.authThrottle.filter((r) => r.keyHash === k && Date.parse(r.at) >= since.getTime()).length);
    const at = nowIso();
    for (const k of keyHashes) this.authThrottle.push({ keyHash: k, at });
    return keyHashes.map((k, i) => before[i]! + keyHashes.filter((x) => x === k).length);
  }

  async pruneAuthThrottle(before: Date): Promise<number> {
    const n = this.authThrottle.length;
    this.authThrottle = this.authThrottle.filter((r) => Date.parse(r.at) >= before.getTime());
    return n - this.authThrottle.length;
  }

  async listSamplesForRuns(scanRunIds: string[]): Promise<Sample[]> {
    const want = new Set(scanRunIds);
    return [...this.samples.values()].filter((s) => want.has(s.scanRunId));
  }

  async listEventsPage(businessId: string, opts: { beforeId?: number; limit: number }): Promise<EventRow[]> {
    return this.events
      .filter((e) => e.businessId === businessId && (opts.beforeId === undefined || e.id < opts.beforeId))
      .sort((a, b) => b.id - a.id)
      .slice(0, opts.limit)
      .map((e) => ({ ...e }));
  }

  async deleteChannel(id: string): Promise<void> {
    this.channels.delete(id);
  }

  // --- deletion and retention (feature 002, migration 0019) ---
  async setDeletion(businessId: string, input: { at: string; reason: "owner" } | null): Promise<BusinessRecord> {
    const b = this.businesses.get(businessId);
    if (!b) throw new Error(`business ${businessId} not found`);
    const next: BusinessRecord = { ...b, deleteAt: input?.at ?? null, deleteReason: input ? "owner" : null, deletionRemindedAt: null };
    retentionTrigger(b, next);
    this.businesses.set(businessId, next);
    return { ...next };
  }

  async listDueDeletions(now: Date, limit: number, opts: { retention?: boolean } = {}): Promise<BusinessRecord[]> {
    const remindedBefore = now.getTime() - 14 * DAY_MS;
    return [...this.businesses.values()]
      .filter((b) => purgeAllowed(b, "due", now))
      .filter((b) => b.deleteReason === "owner" || (opts.retention !== false && b.deletionRemindedAt !== null && Date.parse(b.deletionRemindedAt) <= remindedBefore))
      .sort((a, b) => (a.deleteReason === "owner" ? 0 : 1) - (b.deleteReason === "owner" ? 0 : 1) || Date.parse(a.deleteAt!) - Date.parse(b.deleteAt!))
      .slice(0, limit)
      .map((b) => ({ ...b }));
  }

  async listDeletionReminders(now: Date, limit: number): Promise<BusinessRecord[]> {
    return [...this.businesses.values()]
      .filter((b) => b.deleteReason === "retention" && b.deleteAt && !b.deletionRemindedAt && Date.parse(b.deleteAt) - 14 * DAY_MS <= now.getTime())
      .slice(0, limit)
      .map((b) => ({ ...b }));
  }

  async claimDeletionReminder(businessId: string, at: Date = new Date()): Promise<boolean> {
    const b = this.businesses.get(businessId);
    if (!b || b.deletionRemindedAt) return false;
    b.deletionRemindedAt = at.toISOString();
    return true;
  }

  async countOverdueDeletions(now: Date): Promise<number> {
    const late = new Set([...this.businesses.values()].filter((b) => b.deleteAt && Date.parse(b.deleteAt) < now.getTime() - DAY_MS).map((b) => b.id));
    for (const j of this.jobs.values()) {
      const id = j.payload.businessId;
      if (j.kind !== "purge" || typeof id !== "string" || !this.businesses.has(id)) continue;
      const stuck = !j.doneAt && Date.parse(j.createdAt) < now.getTime() - DAY_MS;
      const gaveUp = !!j.doneAt && !!j.error;
      if (stuck || gaveUp) late.add(id);
    }
    return late.size;
  }

  async listScanRetention(limit: number): Promise<BusinessRecord[]> {
    return [...this.businesses.values()].filter((b) => b.plan === "setup" && b.status === "trial").slice(0, limit).map((b) => ({ ...b }));
  }

  async setScanRetention(businessId: string, at: string | null): Promise<void> {
    const b = this.businesses.get(businessId);
    if (!b || b.plan !== "setup" || b.status !== "trial") return;
    const later = at && b.deleteAt ? Date.parse(at) > Date.parse(b.deleteAt) : true;
    b.deleteAt = at;
    b.deleteReason = at ? "retention" : null;
    if (later || !at) b.deletionRemindedAt = null;
  }

  async hasUnrunJob(kind: JobKind, businessId: string): Promise<boolean> {
    return [...this.jobs.values()].some((j) => !j.doneAt && j.kind === kind && j.payload.businessId === businessId);
  }

  async purgeBusiness(id: string, guard: PurgeGuard, now: Date): Promise<boolean> {
    const b = this.businesses.get(id);
    if (!b || !purgeAllowed(b, guard, now)) return false;
    for (const j of [...this.jobs.values()]) if (!j.doneAt && j.payload.businessId === id) this.jobs.delete(j.id);
    await this.deleteBusiness(id);
    return true;
  }

  async close(): Promise<void> {}
}

/** Exponential backoff for failed jobs: 1, 2, 4, 8, 16 minutes (capped at 60). */
export function backoffMs(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60 * 1000;
}
