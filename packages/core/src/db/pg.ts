/**
 * PgDb: postgres.js implementation of Db against the schema in
 * supabase/migrations/0001_init.sql. Plain SQL via `sql` tagged templates;
 * column names are transformed snake_case <-> camelCase by postgres.js
 * (`transform: postgres.camel`), Dates are converted to ISO strings here.
 */
import postgres, { type Sql } from "postgres";
import type { BusinessStatus, Channel, Claim, Facts, Finding, FindingStatus, Fix, Prompt, PromptPool, Sample, ScanRun } from "../types";
import { slugify } from "../scanner/normalize";
import { backoffMs } from "./mem";
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
} from "./types";

type Row = Record<string, unknown>;

/** Convert every Date in a row to an ISO string (types.ts uses strings). */
function iso<T extends Row>(row: T): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out as T;
}

function mapFacts(row: Row): Facts {
  const data = (row.data ?? {}) as Facts;
  return {
    ...data,
    businessId: row.businessId as string,
    version: row.version as number,
    provisional: row.provisional as boolean,
    verifiedAt: row.verifiedAt instanceof Date ? row.verifiedAt.toISOString() : ((row.verifiedAt as string | null) ?? null),
    ...(row.createdAt ? { createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt) } : {}),
  };
}

function mapBusiness(row: Row): BusinessRecord {
  const r = iso(row);
  return {
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    place: r.place as string,
    domain: (r.domain as string | null) ?? null,
    kvk: (r.kvk as string | null) ?? null,
    googlePlaceId: (r.googlePlaceId as string | null) ?? null,
    sector: (r.sector as BusinessRecord["sector"] | null) ?? null,
    plan: r.plan as BusinessRecord["plan"],
    status: r.status as BusinessRecord["status"],
    ownerEmail: (r.ownerEmail as string | null) ?? null,
    ownerUserId: (r.ownerUserId as string | null) ?? null,
    stripeCustomerId: (r.stripeCustomerId as string | null) ?? null,
    stripeSubscriptionId: (r.stripeSubscriptionId as string | null) ?? null,
    factsHost: (r.factsHost as string | null) ?? null,
    factsHostVerifiedAt: (r.factsHostVerifiedAt as string | null) ?? null,
    anniversaryDay: (r.anniversaryDay as number | null) ?? null,
    ownerVerifiedAt: (r.ownerVerifiedAt as string | null) ?? null,
    ownerVerifiedVia: (r.ownerVerifiedVia as string | null) ?? null,
    language: r.language === "en" ? "en" : "nl",
    cancelAt: (r.cancelAt as string | null) ?? null,
    pauseUntil: (r.pauseUntil as string | null) ?? null,
    mailPrefs: normalizeMailPrefs(r.mailPrefs),
    createdAt: r.createdAt as string,
  };
}

const mapPrompt = (r: Row): Prompt => ({
  id: r.id as string,
  businessId: r.businessId as string,
  category: r.category as Prompt["category"],
  textNl: r.textNl as string,
  probes: (r.probes as string[]) ?? [],
  active: r.active as boolean,
  criterium: (r.criterium as Prompt["criterium"]) ?? null,
  kind: ((r.kind as string | null) ?? "about") as Prompt["kind"],
  intent: (r.intent as Prompt["intent"]) ?? null,
  pool: ((r.pool as string | null) ?? "core") as Prompt["pool"],
  season: (r.season as Prompt["season"]) ?? null,
});

const mapScanRun = (row: Row): ScanRun => {
  const r = iso(row);
  return {
    id: r.id as string,
    businessId: r.businessId as string,
    kind: r.kind as ScanRun["kind"],
    engines: r.engines as ScanRun["engines"],
    samplesPerPrompt: r.samplesPerPrompt as number,
    startedAt: (r.startedAt as string | null) ?? (r.createdAt as string),
    finishedAt: (r.finishedAt as string | null) ?? null,
    costCents: r.costCents as number,
    status: r.status as ScanRun["status"],
  };
};

const mapSample = (row: Row): Sample => {
  const r = iso(row);
  return {
    id: r.id as string,
    scanRunId: r.scanRunId as string,
    promptId: r.promptId as string,
    engine: r.engine as Sample["engine"],
    answerText: r.answerText as string,
    citations: (r.citations as string[]) ?? [],
    capturedAt: r.capturedAt as string,
    costCents: r.costCents as number,
  };
};

const mapClaim = (r: Row): Claim => ({
  sampleId: r.sampleId as string,
  factKey: r.factKey as Claim["factKey"],
  value: r.value as string,
  subject: (r.subject as string | null) ?? null,
  confidence: Number(r.confidence),
  otherEntity: r.otherEntity as boolean,
  rawQuote: (r.rawQuote as string | null) ?? "",
});

const mapFinding = (row: Row): Finding => {
  const r = iso(row);
  return {
    id: r.id as string,
    businessId: r.businessId as string,
    scanRunId: r.scanRunId as string,
    factKey: r.factKey as Finding["factKey"],
    subject: (r.subject as string | null) ?? null,
    engine: r.engine as Finding["engine"],
    verdict: ((r.verdict as string | null) ?? "wrong") as Finding["verdict"],
    wrongValue: r.wrongValue as string,
    correctValue: r.correctValue as string,
    frequency: r.frequency as number,
    sampleCount: r.sampleCount as number,
    sourceUrl: (r.sourceUrl as string | null) ?? null,
    sourceType: r.sourceType as Finding["sourceType"],
    status: r.status as FindingStatus,
    firstSeenAt: r.firstSeenAt as string,
    resolvedAt: (r.resolvedAt as string | null) ?? null,
    evidenceBefore: (r.evidenceBefore as string | null) ?? null,
    evidenceAfter: (r.evidenceAfter as string | null) ?? null,
    evidenceKind: ((r.evidenceKind as string | null) ?? "about") as Finding["evidenceKind"],
    criterium: (r.criterium as Finding["criterium"]) ?? null,
  };
};

const mapJob = (row: Row): Job => {
  const r = iso(row);
  return {
    id: Number(r.id),
    kind: r.kind as string,
    payload: (r.payload as Record<string, unknown>) ?? {},
    runAt: r.runAt as string,
    attempts: r.attempts as number,
    maxAttempts: r.maxAttempts as number,
    lockedAt: (r.lockedAt as string | null) ?? null,
    doneAt: (r.doneAt as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    createdAt: r.createdAt as string,
  };
};

const mapEvent = (row: Row): EventRow => {
  const r = iso(row);
  return { id: Number(r.id), businessId: (r.businessId as string | null) ?? null, type: r.type as string, payload: (r.payload as Record<string, unknown>) ?? {}, at: r.at as string };
};

const mapChannel = (row: Row): Channel => {
  const r = iso(row);
  return {
    id: r.id as string,
    businessId: r.businessId as string,
    type: r.type as Channel["type"],
    name: r.name as string,
    externalId: (r.externalId as string | null) ?? null,
    url: (r.url as string | null) ?? null,
    status: r.status as Channel["status"],
    lastSyncedAt: (r.lastSyncedAt as string | null) ?? null,
    meta: (r.meta as Record<string, unknown> | null) ?? {},
  };
};

const mapFix = (row: Row): Fix => {
  const r = iso(row);
  return {
    id: r.id as string,
    findingId: r.findingId as string,
    action: r.action as Fix["action"],
    target: r.target as string,
    scheduledAt: r.scheduledAt as string,
    sentAt: (r.sentAt as string | null) ?? null,
    recheckAt: (r.recheckAt as string | null) ?? null,
    resolvedAt: (r.resolvedAt as string | null) ?? null,
    evidence: (r.evidence as Record<string, unknown>) ?? {},
  };
};

const OPEN_STATUSES: FindingStatus[] = ["open", "fixing", "recheck"];
const toDate = (v: string | null | undefined) => (v ? new Date(v) : null);

function mapGoogleIndex(row: Row): GoogleIndexState {
  const r = iso(row);
  return {
    businessId: String(r.businessId),
    host: String(r.host),
    token: (r.token as string | null) ?? null,
    verifiedAt: (r.verifiedAt as string | null) ?? null,
    addedAt: (r.addedAt as string | null) ?? null,
    sitemapAt: (r.sitemapAt as string | null) ?? null,
    lastAttemptAt: (r.lastAttemptAt as string | null) ?? null,
    lastError: (r.lastError as string | null) ?? null,
    inspection: (r.inspection as GoogleIndexState["inspection"]) ?? null,
    indexedAt: (r.indexedAt as string | null) ?? null,
    updatedAt: String(r.updatedAt),
  };
}

export class PgDb implements Db {
  readonly kind = "pg" as const;
  readonly sql: Sql;

  /**
   * `opts` for a short-lived handle (one Worker request through Hyperdrive):
   * few connections, closed soon after the last query, because the next
   * request may not reuse them.
   */
  constructor(databaseUrl: string, opts: { max?: number; idleTimeout?: number } = {}) {
    this.sql = postgres(databaseUrl, {
      transform: postgres.camel,
      max: opts.max ?? Number(process.env.PG_POOL_MAX ?? 5),
      idle_timeout: opts.idleTimeout ?? 30,
      connect_timeout: 10,
      prepare: false, // Supabase pooler (pgbouncer transaction mode) friendly
    });
  }

  // --- business ---
  async getBusiness(idOrSlug: string): Promise<BusinessRecord | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const rows = isUuid
      ? await this.sql`select * from business where id = ${idOrSlug} or slug = ${idOrSlug} limit 1`
      : await this.sql`select * from business where slug = ${idOrSlug} limit 1`;
    return rows[0] ? mapBusiness(rows[0]) : null;
  }

  async upsertBusiness(input: BusinessUpsert): Promise<BusinessRecord> {
    const slug = input.slug ?? slugify(input.name, input.place);
    const cols: Row = {};
    const keys: (keyof BusinessUpsert)[] = [
      "name", "place", "domain", "kvk", "googlePlaceId", "sector", "plan", "status", "ownerEmail", "ownerUserId",
      "stripeCustomerId", "stripeSubscriptionId", "factsHost", "anniversaryDay", "ownerVerifiedVia", "language",
    ];
    for (const k of keys) if (input[k] !== undefined) cols[k] = input[k];
    if (input.factsHostVerifiedAt !== undefined) cols.factsHostVerifiedAt = toDate(input.factsHostVerifiedAt);
    if (input.ownerVerifiedAt !== undefined) cols.ownerVerifiedAt = toDate(input.ownerVerifiedAt);
    if (input.cancelAt !== undefined) cols.cancelAt = toDate(input.cancelAt);
    if (input.pauseUntil !== undefined) cols.pauseUntil = toDate(input.pauseUntil);
    if (input.mailPrefs !== undefined) cols.mailPrefs = this.sql.json(normalizeMailPrefs(input.mailPrefs) as never);
    const insertRow = { ...cols, slug, ...(input.id ? { id: input.id } : {}) } as Row;
    const updateCols = Object.keys(cols) as string[];
    const rows = updateCols.length
      ? await this.sql`insert into business ${this.sql(insertRow)} on conflict (slug) do update set ${this.sql(cols, ...(updateCols as never[]))} returning *`
      : await this.sql`insert into business ${this.sql(insertRow)} on conflict (slug) do update set slug = excluded.slug returning *`;
    return mapBusiness(rows[0]!);
  }

  async businessesDueForMonthlyScan(dayOfMonth: number): Promise<BusinessRecord[]> {
    // On the last day of a short month also pick up anniversaries 29-31.
    const rows = await this.sql`
      select * from business
      where status in ('trial','active') and anniversary_day is not null
        and (pause_until is null or pause_until <= now())
        and (anniversary_day = ${dayOfMonth}
             or (${dayOfMonth} = extract(day from (date_trunc('month', now()) + interval '1 month - 1 day'))::int and anniversary_day > ${dayOfMonth}))
      order by created_at`;
    return rows.map(mapBusiness);
  }

  async getBusinessByFactsHost(host: string): Promise<BusinessRecord | null> {
    const rows = await this.sql`select * from business where lower(facts_host) = ${host.toLowerCase()} limit 1`;
    return rows[0] ? mapBusiness(rows[0]) : null;
  }

  async getBusinessByStripeCustomer(customerId: string): Promise<BusinessRecord | null> {
    const rows = await this.sql`select * from business where stripe_customer_id = ${customerId} limit 1`;
    return rows[0] ? mapBusiness(rows[0]) : null;
  }

  async getBusinessByOwner(opts: { userId?: string | null; email?: string | null }): Promise<BusinessRecord | null> {
    if (opts.userId) {
      const rows = await this.sql`select * from business where owner_user_id = ${opts.userId} order by created_at desc limit 1`;
      if (rows[0]) return mapBusiness(rows[0]);
    }
    if (opts.email) {
      const rows = await this.sql`select * from business where lower(owner_email) = ${opts.email.toLowerCase()} order by created_at desc limit 1`;
      if (rows[0]) return mapBusiness(rows[0]);
    }
    return null;
  }

  async listBusinessesByStatus(statuses: BusinessStatus[]): Promise<BusinessRecord[]> {
    if (!statuses.length) return [];
    const rows = await this.sql`select * from business where status in ${this.sql(statuses)} order by created_at`;
    return rows.map(mapBusiness);
  }

  // --- facts ---
  async listFacts(businessId: string): Promise<Facts[]> {
    const rows = await this.sql`select * from facts where business_id = ${businessId} order by version`;
    return rows.map(mapFacts);
  }

  async deleteBusiness(id: string): Promise<void> {
    // Every table that refers to business has on delete cascade (0001, 0007); jobs keep the id in their payload.
    await this.sql.begin(async (tx) => {
      await tx`delete from job where done_at is null and payload->>'businessId' = ${id}`;
      await tx`delete from business where id = ${id}`;
    });
  }

  async latestFacts(businessId: string): Promise<Facts | null> {
    const rows = await this.sql`select * from facts where business_id = ${businessId} order by version desc limit 1`;
    return rows[0] ? mapFacts(rows[0]) : null;
  }

  async insertFacts(businessId: string, data: Parameters<Db["insertFacts"]>[1], opts: { provisional?: boolean; verifiedAt?: string | null } = {}): Promise<Facts> {
    const provisional = opts.provisional ?? data.provisional ?? true;
    const verifiedAt = opts.verifiedAt ?? data.verifiedAt ?? null;
    // Strip the row-level fields from the jsonb payload; they live in columns.
    const { businessId: _b, version: _v, provisional: _p, verifiedAt: _va, createdAt: _c, ...payload } = data as Facts;
    const rows = await this.sql`
      insert into facts (business_id, version, provisional, verified_at, data)
      values (${businessId},
              (select coalesce(max(version), 0) + 1 from facts where business_id = ${businessId}),
              ${provisional}, ${toDate(verifiedAt)}, ${this.sql.json(payload as never)})
      returning *`;
    return mapFacts(rows[0]!);
  }

  // --- prompts ---
  async listPrompts(businessId: string, opts: { activeOnly?: boolean } = {}): Promise<Prompt[]> {
    const rows = opts.activeOnly
      ? await this.sql`select * from prompt where business_id = ${businessId} and active order by created_at, id`
      : await this.sql`select * from prompt where business_id = ${businessId} order by created_at, id`;
    return rows.map(mapPrompt);
  }

  async insertPrompts(businessId: string, prompts: PromptInput[]): Promise<Prompt[]> {
    if (!prompts.length) return [];
    const rows = prompts.map((p) => ({ businessId, category: p.category, textNl: p.textNl, probes: p.probes, active: p.active ?? true, criterium: p.criterium ?? null, kind: p.kind ?? "about", intent: p.intent ?? null, pool: p.pool ?? "core", season: p.season ?? null }));
    const out = await this.sql`insert into prompt ${this.sql(rows)} returning *`;
    return out.map(mapPrompt);
  }

  async setPromptPool(id: string, pool: PromptPool): Promise<void> {
    await this.sql`update prompt set pool = ${pool} where id = ${id}`;
  }

  // --- scan runs ---
  async createScanRun(input: ScanRunCreate): Promise<ScanRun> {
    const rows = await this.sql`
      insert into scan_run (business_id, kind, engines, samples_per_prompt, status, started_at)
      values (${input.businessId}, ${input.kind}, ${this.sql.array(input.engines)}::engine[], ${input.samplesPerPrompt}, ${input.status ?? "queued"}, now())
      returning *`;
    return mapScanRun(rows[0]!);
  }

  async updateScanRun(id: string, patch: ScanRunUpdate): Promise<ScanRun> {
    const cols: Row = {};
    if (patch.status !== undefined) cols.status = patch.status;
    if (patch.startedAt !== undefined) cols.startedAt = toDate(patch.startedAt);
    if (patch.finishedAt !== undefined) cols.finishedAt = toDate(patch.finishedAt);
    if (patch.costCents !== undefined) cols.costCents = patch.costCents;
    if (patch.error !== undefined) cols.error = patch.error;
    const rows = Object.keys(cols).length
      ? await this.sql`update scan_run set ${this.sql(cols)} where id = ${id} returning *`
      : await this.sql`select * from scan_run where id = ${id}`;
    if (!rows[0]) throw new Error(`scan_run ${id} not found`);
    return mapScanRun(rows[0]);
  }

  async listScanRuns(businessId: string, limit = 50): Promise<ScanRun[]> {
    const rows = await this.sql`select * from scan_run where business_id = ${businessId} order by created_at desc limit ${limit}`;
    return rows.map(mapScanRun);
  }

  async getScanRun(id: string): Promise<ScanRun | null> {
    const rows = await this.sql`select * from scan_run where id = ${id}`;
    return rows[0] ? mapScanRun(rows[0]) : null;
  }

  async insertSamples(samples: SampleInput[]): Promise<Sample[]> {
    if (!samples.length) return [];
    const rows = samples.map((s) => ({
      scanRunId: s.scanRunId,
      promptId: s.promptId,
      engine: s.engine,
      answerText: s.answerText,
      citations: s.citations,
      costCents: s.costCents,
      capturedAt: s.capturedAt ? new Date(s.capturedAt) : new Date(),
    }));
    const out = await this.sql`insert into sample ${this.sql(rows as never[])} returning *`;
    return out.map(mapSample);
  }

  async listSamples(scanRunId: string): Promise<Sample[]> {
    const rows = await this.sql`select * from sample where scan_run_id = ${scanRunId} order by captured_at, id`;
    return rows.map(mapSample);
  }

  async insertClaims(claims: ClaimInput[]): Promise<Claim[]> {
    if (!claims.length) return [];
    const rows = claims.map((c) => ({
      sampleId: c.sampleId,
      factKey: c.factKey,
      subject: c.subject,
      value: c.value,
      confidence: c.confidence,
      otherEntity: c.otherEntity,
      rawQuote: c.rawQuote,
    }));
    const out = await this.sql`insert into claim ${this.sql(rows)} returning *`;
    return out.map(mapClaim);
  }

  async listClaims(sampleIds: string[]): Promise<Claim[]> {
    if (!sampleIds.length) return [];
    const rows = await this.sql`select * from claim where sample_id in ${this.sql(sampleIds)} order by id`;
    return rows.map(mapClaim);
  }

  // --- findings ---
  async listFindings(businessId: string, status?: FindingStatus | FindingStatus[]): Promise<Finding[]> {
    const statuses = status == null ? null : Array.isArray(status) ? status : [status];
    const rows = statuses
      ? await this.sql`select * from finding where business_id = ${businessId} and status in ${this.sql(statuses)} order by first_seen_at`
      : await this.sql`select * from finding where business_id = ${businessId} order by first_seen_at`;
    return rows.map(mapFinding);
  }

  async listFindingsByScanRun(scanRunId: string): Promise<Finding[]> {
    const rows = await this.sql`select * from finding where scan_run_id = ${scanRunId} order by first_seen_at`;
    return rows.map(mapFinding);
  }

  async getFinding(id: string): Promise<Finding | null> {
    const rows = await this.sql`select * from finding where id = ${id}`;
    return rows[0] ? mapFinding(rows[0]) : null;
  }

  async upsertFindings(inputs: FindingInput[]): Promise<Finding[]> {
    const out: Finding[] = [];
    await this.sql.begin(async (tx) => {
      for (const f of inputs) {
        const existing = await tx`
          select * from finding
          where business_id = ${f.businessId} and fact_key = ${f.factKey}
            and subject is not distinct from ${f.subject} and engine = ${f.engine}
            and verdict = ${f.verdict ?? "wrong"}::verdict
            and evidence_kind = ${f.evidenceKind ?? "about"}
            and status in ${tx(OPEN_STATUSES)}
          order by first_seen_at limit 1 for update`;
        if (existing[0]) {
          const rows = await tx`
            update finding set
              scan_run_id = ${f.scanRunId},
              wrong_value = ${f.wrongValue},
              correct_value = ${f.correctValue},
              frequency = ${f.frequency},
              sample_count = ${f.sampleCount},
              source_url = coalesce(${f.sourceUrl}, source_url),
              source_type = case when ${f.sourceType}::source_type = 'none' then source_type else ${f.sourceType}::source_type end,
              status = ${f.status ?? (existing[0].status as string)},
              evidence_before = coalesce(evidence_before, ${f.evidenceBefore}),
              criterium = coalesce(${f.criterium ?? null}, criterium)
            where id = ${existing[0].id as string} returning *`;
          out.push(mapFinding(rows[0]!));
        } else {
          const rows = await tx`
            insert into finding (business_id, scan_run_id, fact_key, subject, engine, verdict, wrong_value, correct_value, frequency, sample_count, source_url, source_type, status, evidence_before, evidence_kind, criterium)
            values (${f.businessId}, ${f.scanRunId}, ${f.factKey}, ${f.subject}, ${f.engine}, ${f.verdict ?? "wrong"}, ${f.wrongValue}, ${f.correctValue}, ${f.frequency}, ${f.sampleCount}, ${f.sourceUrl}, ${f.sourceType}, ${f.status ?? "open"}, ${f.evidenceBefore}, ${f.evidenceKind ?? "about"}, ${f.criterium ?? null})
            returning *`;
          out.push(mapFinding(rows[0]!));
        }
      }
    });
    return out;
  }

  async updateFindingStatus(id: string, status: FindingStatus): Promise<Finding> {
    const rows = await this.sql`update finding set status = ${status} where id = ${id} returning *`;
    if (!rows[0]) throw new Error(`finding ${id} not found`);
    return mapFinding(rows[0]);
  }

  async markFindingResolved(id: string, evidenceAfter: string | null = null): Promise<Finding> {
    const rows = await this.sql`
      update finding set status = 'resolved', resolved_at = now(), evidence_after = coalesce(${evidenceAfter}, evidence_after)
      where id = ${id} returning *`;
    if (!rows[0]) throw new Error(`finding ${id} not found`);
    return mapFinding(rows[0]);
  }

  // --- jobs ---
  async enqueueJob(kind: JobKind, payload: Record<string, unknown> = {}, runAt?: Date | string): Promise<Job> {
    const rows = await this.sql`
      insert into job (kind, payload, run_at) values (${kind}, ${this.sql.json(payload as never)}, ${runAt ? new Date(runAt) : new Date()})
      returning *`;
    return mapJob(rows[0]!);
  }

  async claimJob(kinds?: JobKind[]): Promise<Job | null> {
    // Locks older than 15 minutes are considered abandoned (crashed worker).
    const rows = await this.sql`
      update job set locked_at = now(), attempts = attempts + 1
      where id = (
        select id from job
        where done_at is null and run_at <= now()
          and (locked_at is null or locked_at < now() - interval '15 minutes')
          ${kinds && kinds.length ? this.sql`and kind in ${this.sql(kinds)}` : this.sql``}
        order by run_at, id
        limit 1 for update skip locked
      ) returning *`;
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async completeJob(id: number): Promise<void> {
    await this.sql`update job set done_at = now(), locked_at = null where id = ${id}`;
  }

  async failJob(id: number, error: string): Promise<Job> {
    const current = await this.sql`select * from job where id = ${id}`;
    if (!current[0]) throw new Error(`job ${id} not found`);
    const job = mapJob(current[0]);
    const rows =
      job.attempts >= job.maxAttempts
        ? await this.sql`update job set error = ${error}, locked_at = null, done_at = now() where id = ${id} returning *`
        : await this.sql`update job set error = ${error}, locked_at = null, run_at = ${new Date(Date.now() + backoffMs(job.attempts))} where id = ${id} returning *`;
    return mapJob(rows[0]!);
  }

  // --- events ---
  async logEvent(businessId: string | null, type: string, payload: Record<string, unknown> = {}): Promise<EventRow> {
    const rows = await this.sql`insert into event (business_id, type, payload) values (${businessId}, ${type}, ${this.sql.json(payload as never)}) returning *`;
    return mapEvent(rows[0]!);
  }

  async listEvents(businessId: string, limit = 100): Promise<EventRow[]> {
    const rows = await this.sql`select * from event where business_id = ${businessId} order by at desc limit ${limit}`;
    return rows.map(mapEvent);
  }

  async countEventsSince(type: string, since: Date): Promise<number> {
    const [row] = await this.sql`select count(*)::int as n from event where type = ${type} and at >= ${since}`;
    return Number(row?.n ?? 0);
  }

  // --- coming-soon list ---
  async joinWaitlist(input: WaitlistInput): Promise<{ created: boolean }> {
    const rows = await this.sql`
      insert into waitlist (email, language, source, consent_text)
      values (${input.email}, ${input.language}, ${input.source}, ${input.consentText})
      on conflict (email) do nothing
      returning id`;
    return { created: rows.length > 0 };
  }

  async countWaitlist(): Promise<number> {
    const [row] = await this.sql`select count(*)::int as n from waitlist where unsubscribed_at is null`;
    return Number(row?.n ?? 0);
  }

  async listWaitlist(): Promise<{ email: string; language: "nl" | "en" }[]> {
    const rows = await this.sql`select email, language from waitlist where unsubscribed_at is null order by created_at, email`;
    return rows.map((r) => ({ email: String(r.email), language: r.language === "en" ? "en" : "nl" }));
  }

  // --- channels ---
  async listChannels(businessId: string): Promise<Channel[]> {
    const rows = await this.sql`select * from channel where business_id = ${businessId} order by type, name`;
    return rows.map(mapChannel);
  }

  async upsertChannel(input: ChannelUpsert): Promise<Channel> {
    const existing = input.id
      ? await this.sql`select * from channel where id = ${input.id}`
      : await this.sql`select * from channel where business_id = ${input.businessId} and type = ${input.type} and name = ${input.name} limit 1`;
    const cols: Row = { businessId: input.businessId, type: input.type, name: input.name };
    if (input.externalId !== undefined) cols.externalId = input.externalId;
    if (input.url !== undefined) cols.url = input.url;
    if (input.status !== undefined) cols.status = input.status;
    if (input.lastSyncedAt !== undefined) cols.lastSyncedAt = toDate(input.lastSyncedAt);
    if (input.meta !== undefined) cols.meta = this.sql.json(input.meta as never);
    const rows = existing[0]
      ? await this.sql`update channel set ${this.sql(cols)} where id = ${existing[0].id as string} returning *`
      : await this.sql`insert into channel ${this.sql(cols)} returning *`;
    return mapChannel(rows[0]!);
  }

  // --- fixes ---
  async listFixes(findingId: string): Promise<Fix[]> {
    const rows = await this.sql`select * from fix where finding_id = ${findingId} order by scheduled_at`;
    return rows.map(mapFix);
  }

  async getFix(id: string): Promise<Fix | null> {
    const rows = await this.sql`select * from fix where id = ${id}`;
    return rows[0] ? mapFix(rows[0]) : null;
  }

  async insertFix(input: FixInput): Promise<Fix> {
    const rows = await this.sql`
      insert into fix (finding_id, action, target, scheduled_at, sent_at, recheck_at, resolved_at, evidence)
      values (${input.findingId}, ${input.action}, ${input.target}, ${input.scheduledAt ? new Date(input.scheduledAt) : new Date()},
              ${toDate(input.sentAt)}, ${toDate(input.recheckAt)}, ${toDate(input.resolvedAt)}, ${this.sql.json((input.evidence ?? {}) as never)})
      returning *`;
    return mapFix(rows[0]!);
  }

  async updateFix(id: string, patch: Partial<Omit<Fix, "id" | "findingId">>): Promise<Fix> {
    const cols: Row = {};
    if (patch.action !== undefined) cols.action = patch.action;
    if (patch.target !== undefined) cols.target = patch.target;
    if (patch.scheduledAt !== undefined) cols.scheduledAt = toDate(patch.scheduledAt);
    if (patch.sentAt !== undefined) cols.sentAt = toDate(patch.sentAt);
    if (patch.recheckAt !== undefined) cols.recheckAt = toDate(patch.recheckAt);
    if (patch.resolvedAt !== undefined) cols.resolvedAt = toDate(patch.resolvedAt);
    if (patch.evidence !== undefined) cols.evidence = this.sql.json(patch.evidence as never);
    const rows = Object.keys(cols).length
      ? await this.sql`update fix set ${this.sql(cols)} where id = ${id} returning *`
      : await this.sql`select * from fix where id = ${id}`;
    if (!rows[0]) throw new Error(`fix ${id} not found`);
    return mapFix(rows[0]);
  }

  async listDueRechecks(now: Date = new Date()): Promise<Fix[]> {
    const rows = await this.sql`select * from fix where resolved_at is null and recheck_at is not null and recheck_at <= ${now} order by recheck_at`;
    return rows.map(mapFix);
  }

  // --- Google Search Console state ---
  async getGoogleIndex(businessId: string): Promise<GoogleIndexState | null> {
    const rows = await this.sql`select * from google_index where business_id = ${businessId}`;
    return rows[0] ? mapGoogleIndex(rows[0]) : null;
  }

  async upsertGoogleIndex(input: GoogleIndexUpsert): Promise<GoogleIndexState> {
    const cols: Row = { businessId: input.businessId, host: input.host, updatedAt: new Date() };
    if (input.token !== undefined) cols.token = input.token;
    if (input.lastError !== undefined) cols.lastError = input.lastError;
    if (input.inspection !== undefined) cols.inspection = input.inspection === null ? null : this.sql.json(input.inspection as never);
    for (const k of ["verifiedAt", "addedAt", "sitemapAt", "lastAttemptAt", "indexedAt"] as const) {
      if (input[k] !== undefined) cols[k] = toDate(input[k]);
    }
    const { businessId: _id, ...update } = cols;
    const rows = await this.sql`
      insert into google_index ${this.sql(cols)}
      on conflict (business_id) do update set ${this.sql(update)}
      returning *`;
    return mapGoogleIndex(rows[0]!);
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
