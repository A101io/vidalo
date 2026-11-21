# Architecture — 006 Productlijnen in het dashboard

*architect · 2026-11-21 · built against `01-brief.md` (written as "005" on another branch; on main this is 006, because 004-scan-confirm and 005-scan-identity exist). Nothing is applied to the hosted Supabase project in this feature (D4).*

## Shape

A product line is a **second kind of scan subject** next to the business. The owner enters it on
`/app/productlijnen`; saving is the confirmation and writes version n+1 of its facts
(`product_line_facts`). Each month the cron that enqueues the business's monthly check also
enqueues **one scan job per (active line, market)**. Each such job is an ordinary `runScan`
with `productLineId` and `market` set: it asks that line's questions (category recommendation,
specifications, certificates, where to buy, successor) in `scanLang(market)` with the engines'
user location set to the market, using the existing sampling rules (`FIRST_SAMPLES`, escalation,
`SAMPLES_CAP`) unchanged. Judging reuses `compare()` and `computeStip()`: the line is presented
to them as an in-memory `Facts` view (`lineFacts()`, like `withCountry()`/`withProfile()`) whose
`productLine` field carries what four new fact keys (`spec`, `certificate`, `outlet`,
`successor`) are compared against. So the report, the dot, the run summary and the progress
snapshot of a line run fall out of the code that already exists, one run per (line, market).

Rows of a line run live in the existing tables (`prompt`, `scan_run`, `sample`, `finding`)
with a nullable `product_line_id` and `market`. Every business-level reader keeps its meaning
because the `Db` method decides scope in one place: **no line argument means
`product_line_id is null`**. The database keeps a sample's and a finding's line equal to its
scan run's (trigger), a prompt's and a run's line inside the same business (composite foreign
keys), and a run tied to the exact facts version it was asked with. The monthly report mail
waits (bounded) for the month's line runs and adds one section per line. Line findings open on
the same `/app/fouten/[id]` page and take only the fix paths that need no page of ours.

```
cron enqueueMonthlyScans ──► scan {businessId, kind:"monthly"}                       (today)
                        └──► scan {businessId, kind:"monthly", productLineId, market} × (active line × market)
                                      │  paid.ts: paying + verified + productLineAccess + lineScanRefusal
                                      ▼
runScan ── line? ── lineFacts(business, facts, version, market) ── loadLinePrompts() ── sample (unchanged rules)
                                      ── extract (4 new keys) ── compare ── attribute ── upsertFindings(scope)
                                      ── ScanReport{productLine} ── saveRunSummary(+recommend)
scan job then: fixes ──► openFixForFinding ──► fixPathFor(line) (owner mail | correction mail | keep checking)
business scan then: report {lines: expected} ──► waits ≤ 8 × 15 min for the month's line runs ──► monthly mail + line sections
```

## Decisions

| ADR | Decision | Why | Alternative rejected |
|---|---|---|---|
| [ADR-0010](adr/0010-a-product-line-is-scanned-as-its-own-run-per-market.md) | One `scan_run` per (line, market), inside `runScan`, judged through an in-memory `Facts` view; the monthly mail waits for those runs, bounded | Report, dot, summary, snapshot, recheck and fixer work per run without a second pipeline; the business dot can never be moved by a line | Line questions inside the business run (every business reader and the dot would have to filter); a separate line scanner (a second copy of the sampling rules) |
| [ADR-0011](adr/0011-line-rows-share-the-scan-tables-scoped-by-the-database.md) | `product_line` (identity, status) + `product_line_facts` (versioned, immutable); nullable `product_line_id`/`market` on `prompt`, `scan_run`, `sample`, `finding`; composite FKs and one trigger keep the scope consistent; `Db` methods default to business-only | The fixer, the finding page and the RLS member policies need no copy; the invariants are in SQL | Separate `line_*` tables (duplicate fixer and finding page); name/category/markets on the row as well as in the version (two answers to one question) |
| [ADR-0012](adr/0012-lines-are-written-by-the-server-only-limits-under-a-lock.md) | Members read lines through a SELECT policy; only the server writes, after `requireOwnerOf` + `productLineAccess`; the active-line limit is checked under `withLock` in the one `Db` method; limits are one constant object, access is one function | Lines cost money every month (nothing that grants value is client-writable); D1/D2 change one constant and one function | An RLS insert policy (cannot see the plan, the limit or the sanitiser); the limit in a trigger (a second copy of a number that is about to change) |
| [ADR-0013](adr/0013-line-criteria-13-to-16-kept-off-the-public-twelve.md) | Four criteria 13–16 (specificaties, certificaten, verkooppunten, opvolger) in `LINE_CRITERIA`, beside the public `CRITERIA` twelve; severities are defaults for Julian | Each line finding needs a severity for the dot; the public pages render `CRITERIA` and must not change | Reusing criteria 6/8/11/12 (wrong labels on the owner's page); one array of 16 (the landing's criteria cards would show them) |
| [ADR-0014](adr/0014-line-findings-take-only-fix-paths-that-need-no-page.md) | A line finding takes the owner-website or the third-party correction path; not found, not named, model memory and anything that would republish the facts page become "keep checking" | Vidalo publishes no page for a product line; republishing the business facts page or syncing Google for a product would be false evidence | Publishing line facts on the facts page (not in the brief); the existing not-found path (claims a remedy that does not exist) |

## Data model

Migration **`supabase/migrations/0020_product_lines.sql`** (main ends at 0019). Not applied to
the hosted project in this feature (D4); `pnpm verify:pg` applies it to a local Postgres.

```sql
-- Feature 006 (product lines, ADR-0010..0014). A product line is a scan subject next to the business:
-- versioned owner facts, and line rows on the existing scan tables with a nullable product_line_id + market.

-- 1. New fact keys (criteria 13-16). Not used in this file, so the enum additions may commit with it.
alter type fact_key add value if not exists 'spec';
alter type fact_key add value if not exists 'certificate';
alter type fact_key add value if not exists 'outlet';
alter type fact_key add value if not exists 'successor';

-- 2. The line: identity and status only. What it is lives in its versions.
create table product_line (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id) on delete cascade,
  status      text not null default 'active' check (status in ('active', 'discontinued')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint product_line_id_business unique (id, business_id)
);
create index product_line_business_idx on product_line (business_id);

-- 3. Versions: one row per owner confirmation, never changed afterwards.
create table product_line_facts (
  product_line_id uuid not null references product_line(id) on delete cascade,
  version         int  not null check (version >= 1),
  data            jsonb not null,           -- ProductLineData (packages/core/src/types.ts)
  confirmed_at    timestamptz not null default now(),
  primary key (product_line_id, version),
  -- Backstop bounds, looser than PRODUCT_LINE_LIMITS (which change with D2): they cap what one version can cost.
  constraint product_line_facts_shape check (
    jsonb_typeof(data) = 'object'
    and jsonb_typeof(data -> 'name') = 'string'     and char_length(data ->> 'name') between 2 and 80
    and jsonb_typeof(data -> 'category') = 'string' and char_length(data ->> 'category') between 2 and 60
    and jsonb_typeof(data -> 'markets') = 'array'   and jsonb_array_length(data -> 'markets') between 1 and 10
    and not jsonb_path_exists(data, '$.markets[*] ? (!(@ like_regex "^[A-Z]{2}$"))')
    and jsonb_typeof(data -> 'useCases') = 'array'     and jsonb_array_length(data -> 'useCases') <= 10
    and jsonb_typeof(data -> 'specs') = 'array'        and jsonb_array_length(data -> 'specs') <= 20
    and jsonb_typeof(data -> 'certificates') = 'array' and jsonb_array_length(data -> 'certificates') <= 10
    and jsonb_typeof(data -> 'outlets') = 'array'      and jsonb_array_length(data -> 'outlets') <= 50
    and jsonb_typeof(data -> 'replaces') = 'array'     and jsonb_array_length(data -> 'replaces') <= 10
  )
);

create function public.refuse_update() returns trigger
  language plpgsql set search_path = '' as $$
begin
  raise exception '% rows are never changed', tg_table_name;
end $$;
revoke execute on function public.refuse_update() from public, anon, authenticated;
create trigger product_line_facts_immutable before update on product_line_facts
  for each row execute function public.refuse_update();

-- 4. Line rows on the scan tables. Null line = the business itself (every row before this migration).
alter table prompt
  add column product_line_id uuid,
  add column market text,
  add constraint prompt_line_with_market check ((product_line_id is null) = (market is null)),
  add constraint prompt_market_code check (market is null or market ~ '^[A-Z]{2}$'),
  add constraint prompt_line_same_business foreign key (product_line_id, business_id)
    references product_line (id, business_id) on delete cascade;
create index prompt_line_idx on prompt (product_line_id, market) where product_line_id is not null;

alter table scan_run
  add column product_line_id uuid,
  add column product_line_version int,
  add column market text,
  add constraint scan_run_line_all_or_none check (
    (product_line_id is null) = (market is null) and (product_line_id is null) = (product_line_version is null)),
  add constraint scan_run_market_code check (market is null or market ~ '^[A-Z]{2}$'),
  add constraint scan_run_line_same_business foreign key (product_line_id, business_id)
    references product_line (id, business_id) on delete cascade,
  add constraint scan_run_line_version foreign key (product_line_id, product_line_version)
    references product_line_facts (product_line_id, version) on delete cascade;
create index scan_run_line_idx on scan_run (product_line_id, market, created_at desc) where product_line_id is not null;

alter table sample
  add column product_line_id uuid,
  add column market text;
alter table finding
  add column product_line_id uuid,
  add column market text;
create index finding_line_idx on finding (product_line_id, market, status) where product_line_id is not null;

-- A sample's and a finding's line and market are their scan run's, set here and nowhere else.
-- A sample must also answer a question of that same line and market. A finding never moves to a run of
-- another line or market (upsertFindings moves scan_run_id to the latest run that saw it).
create function public.inherit_line_scope() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  run_line uuid; run_market text; p_line uuid; p_market text;
begin
  select product_line_id, market into run_line, run_market from public.scan_run where id = new.scan_run_id;
  if tg_op = 'UPDATE' and (run_line, run_market) is distinct from (old.product_line_id, old.market) then
    raise exception 'a % row cannot move to another product line or market', tg_table_name;
  end if;
  new.product_line_id := run_line;
  new.market := run_market;
  if tg_table_name = 'sample' then
    select product_line_id, market into p_line, p_market from public.prompt where id = new.prompt_id;
    if (p_line, p_market) is distinct from (run_line, run_market) then
      raise exception 'sample: prompt and scan run belong to different product lines or markets';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.inherit_line_scope() from public, anon, authenticated;
create trigger sample_line_scope before insert or update of scan_run_id, prompt_id, product_line_id, market on sample
  for each row execute function public.inherit_line_scope();
create trigger finding_line_scope before insert or update of scan_run_id, product_line_id, market on finding
  for each row execute function public.inherit_line_scope();

-- 5. RLS: members read their own lines; nothing but select for the Data API roles (as business_member, 0016).
alter table product_line enable row level security;
alter table product_line_facts enable row level security;
create policy member_product_line on product_line for select using (
  exists (select 1 from business_member m where m.business_id = product_line.business_id and m.user_id = (select auth.uid())));
create policy member_product_line_facts on product_line_facts for select using (
  exists (select 1 from product_line l join business_member m on m.business_id = l.business_id
          where l.id = product_line_facts.product_line_id and m.user_id = (select auth.uid())));
revoke all on table product_line, product_line_facts from anon, authenticated;
grant select on table product_line, product_line_facts to authenticated;
-- prompt and sample stay internal (0004: no policies). finding and scan_run keep member_finding / member_scan
-- from 0016, so a member sees the line rows of their own business and nothing else.
```

| Rule | Enforced by |
|---|---|
| A line belongs to one business and its rows stay in that business | FK `prompt_line_same_business`, `scan_run_line_same_business` (composite `(product_line_id, business_id)`); sample/finding inherit from the run |
| A line run is asked and judged with one exact version | FK `scan_run_line_version`; `buildReport`/`buildSnapshot` read that version, never the latest |
| A confirmed version is never changed | Trigger `product_line_facts_immutable`; `Db` has no update method for versions |
| Versions are consecutive, one per confirmation | PK `(product_line_id, version)`; `saveProductLine` computes `max + 1` under `withLock("product_line:<businessId>")` |
| A sample answers a question of its own run's line and market | Trigger `inherit_line_scope` on `sample` |
| A finding's line and market are its run's, and never change | Trigger `inherit_line_scope` on `finding` |
| Line and market are set together | CHECKs `*_line_with_market`, `scan_run_line_all_or_none`; trigger derives both for sample/finding |
| At most `PRODUCT_LINE_LIMITS.lines` active lines per business | `Db.saveProductLine` / `setProductLineStatus`: count-then-write inside `withLock` (PgDb `pg_advisory_xact_lock`, MemDb a queue). The number is code (D2 open); stated plainly: the database holds the lock, not the number |
| A version cannot hold more than the backstop sizes | CHECK `product_line_facts_shape` |
| Owners read only their own lines; nobody writes through the Data API | Policies `member_product_line*`; `revoke all` + `grant select` |
| A business reader never sees line rows | Every `Db`/owner-area reader without a `line` argument adds `product_line_id is null`; proven by the isolation test (BE-02) on MemDb and PgDb |
| A line finding never moves the business dot | Different scan runs; the business run's `compare()` never sees a line prompt (scoped `listPrompts`) |

Deletion: `business` → `product_line` → versions, prompts, runs, samples, claims, findings, fixes,
all `on delete cascade`; `purgeBusiness` needs no change. A line itself is never deleted, only
marked discontinued.

## Interface contract

**BE-01 writes all of this into code (types, signatures, MemDb, pure functions, mock seed) before
any other ticket needs it.** Frontend tickets compile and run against these exact names on MemDb
with the mock seed.

### Types (`packages/core/src/types.ts`)

```ts
export type ProductLineStatus = "active" | "discontinued";
export interface ProductLineSpec { label: string; value: string }
export interface ProductLineCertificate { name: string; number: string | null; /** YYYY-MM-DD; null = no end date */ validUntil: string | null }
export interface ProductLineOutlet { /** ISO alpha-2, one of the line's markets */ market: string; name: string; /** http(s) only */ url: string | null }

/** What the owner confirms. Stored as product_line_facts.data. */
export interface ProductLineData {
  name: string;                 // "Tigris K5"
  category: string;             // the noun the comparison questions use: "persfittingsysteem"
  useCases: string[];           // ["renovatie", "nieuwbouw"]
  markets: string[];            // ["NL", "BE"], from core/shared/country.ts COUNTRY_CODES
  specs: ProductLineSpec[];
  certificates: ProductLineCertificate[];
  outlets: ProductLineOutlet[];
  replaces: string[];           // older product names this line replaces
  replacedBy: string | null;    // shown to the owner; no question is asked from it
}
export interface ProductLineVersion extends ProductLineData { productLineId: string; version: number; confirmedAt: string }
export interface ProductLine {
  id: string;
  businessId: string;
  status: ProductLineStatus;
  createdAt: string;
  updatedAt: string;
  /** The latest confirmed version. Every line has one: the row and version 1 are written together. */
  current: ProductLineVersion;
}

/** Which line and market a read is about. Absent = the business itself (product_line_id is null). */
export interface LineScope { productLineId: string; market?: string }

/** In memory only (lineFacts in scanner/line.ts); never stored in business facts. */
export interface LineFactsView {
  productLineId: string;
  version: number;
  market: string;
  brand: string;                                   // the business name
  category: string;
  useCases: string[];
  specs: ProductLineSpec[];
  certificates: (ProductLineCertificate & { valid: boolean })[]; // valid on the scan date
  outlets: ProductLineOutlet[];                     // this market's only
  replaces: string[];
}

// FactKey gains (and FACT_KEYS, copy.factKey, facts-nl/facts-en words):
//   | "spec" | "certificate" | "outlet" | "successor"
// CriteriumId becomes 1 | … | 16 (ADR-0013).
// Facts gains:        productLine?: LineFactsView | null;          // in memory only; insertFacts strips it
// Prompt gains:       productLineId?: string | null; market?: string | null;
// Sample gains:       productLineId?: string | null; market?: string | null;   // read-only, set by the database
// ScanRun gains:      productLineId?: string | null; productLineVersion?: number | null; market?: string | null;
// Finding gains:      productLineId?: string | null; market?: string | null;
// ScanReport gains:   productLine?: { id: string; name: string; version: number; market: string } | null;
```

Report rule the frontend relies on: a line run's `ScanReport` has `comparedAs = category`,
`recommendations` only from the category questions, and findings only on the keys `spec`,
`certificate`, `outlet`, `successor` (criteria 13–16) plus `not_found` on those keys. A line
finding's `wrongValue`/`correctValue`:

| factKey | subject | correctValue | wrongValue |
|---|---|---|---|
| `spec` | spec label as entered ("Drukklasse") | owner's value ("PN16") | value AI gave |
| `certificate` | certificate name ("KIWA") | `"yes"` when valid on the scan date, `"no"` when expired | the other one |
| `outlet` | market code ("BE") | the owner's outlets for that market, joined `" · "` | outlet AI named that is not in the list |
| `successor` | the old name ("Tigris K3") | the line's name | product AI named instead, or `"__absent__"` |

### Limits and access (`packages/core/src/shared/product-lines.ts`, exported from `@vidalo/core/shared`)

```ts
/** D2 open (Julian). Provisional, sized by cost (see Cost): the only place these numbers live. */
export const PRODUCT_LINE_LIMITS = {
  lines: 2,              // active lines per business
  marketsPerLine: 2,
  useCases: 3,
  specs: 5,
  certificates: 3,
  outletsPerMarket: 5,
  replaces: 2,
} as const;

export type LineAccessRefusal = "not_verified" | "not_paying" | "no_monthly_plan" | "paused";
export type LineAccess = { ok: true } | { ok: false; reason: LineAccessRefusal };

/**
 * D1/D3 open (Julian). The one function that says whether lines may be saved and scanned.
 * Today: the signed-in user is the verified owner (isVerifiedOwner), the business is paying
 * (trial | active), on the monthly plan (plan === "monitor": only that plan has a monthly check),
 * and not paused by the owner. Checked in this order; the first failing reason is returned.
 * The worker passes business.ownerUserId as userId.
 */
export function productLineAccess(
  business: Pick<BusinessRecord, "plan" | "status" | "ownerVerifiedAt" | "ownerUserId" | "pauseUntil">,
  userId: string | null | undefined,
  now?: Date,
): LineAccess;

/** Worker: null when this (line, market) may be scanned now; else the reason. A recheck may scan a discontinued line. */
export function lineScanRefusal(line: ProductLine | null, businessId: string, market: string, kind: ScanKind): "no_line" | "other_business" | "discontinued" | "not_a_market" | null;

/** Active lines × their current markets, in name order. The cron, the report wait and the mail use it. */
export function scannableLineMarkets(lines: ProductLine[]): { productLineId: string; version: number; market: string }[];

/** The scope a finding's reads need: undefined for a business finding. */
export function lineScopeOf(f: { productLineId?: string | null; market?: string | null }): LineScope | undefined;
```

### Parsing the owner's form (`packages/core/src/shared/product-lines.ts`)

Pure, runs on the server action and in the browser (FE-02 validates on submit with it; the server
stays authoritative).

```ts
export interface ProductLineFormInput {
  name: string;
  category: string;
  useCases: string;                       // one per line (textarea)
  markets: string[];                      // checked country codes
  specs: { label: string; value: string }[];
  certificates: { name: string; number: string; validUntil: string }[];  // validUntil "" or YYYY-MM-DD
  outlets: { market: string; name: string; url: string }[];
  replaces: string;                       // one per line (textarea)
  replacedBy: string;
}
export type ProductLineField = "name" | "category" | "useCases" | "markets" | "specs" | "certificates" | "outlets" | "replaces" | "replacedBy";
export type ProductLineFieldError = { field: ProductLineField; index?: number; reason: "required" | "refused" | "too_long" | "too_many" | "invalid" | "outside_markets" };

export function parseProductLine(input: ProductLineFormInput): { ok: true; data: ProductLineData } | { ok: false; errors: ProductLineFieldError[] };
```

| Field | Rule | Error |
|---|---|---|
| `name` | trimmed; `sanitizeSlot(name, "name")` must not refuse; ≤ 80 | `required`, `refused`, `too_long` |
| `category` | `sanitizeSlot(…, "category")`; ≤ 60 | same |
| `useCases` | split on line breaks, trimmed, empty and duplicate lines dropped; each `sanitizeSlot(…, "use")` (new slot kind, ≤ 60); ≤ `useCases` | `refused` (with `index`), `too_many` |
| `markets` | each `isCountryCode`; de-duplicated; 1 to `marketsPerLine` | `required`, `invalid`, `too_many` |
| `specs` | rows with both parts empty dropped; label `sanitizeSlot(…, "spec")` (new, ≤ 40), value plain text ≤ 60, both required; ≤ `specs` | `required`, `refused`, `too_long`, `too_many` (with `index`) |
| `certificates` | name `sanitizeSlot(…, "certificate")` (new, ≤ 60); number ≤ 40 or empty → null; validUntil empty → null, else a real `YYYY-MM-DD`; ≤ `certificates` | `required`, `refused`, `invalid`, `too_many` |
| `outlets` | market in `markets`; name plain ≤ 80 required; url empty → null, else `new URL()` with `http:`/`https:` and ≤ 300; ≤ `outletsPerMarket` per market | `outside_markets`, `required`, `invalid`, `too_many` |
| `replaces` | as `useCases`, slot `"name"`; never the line's own name; ≤ `replaces` | `refused`, `invalid`, `too_many` |
| `replacedBy` | plain ≤ 80, empty → null | `too_long` |

Stored values are the owner's trimmed text; questions use the `sanitizeSlot` output of the same
text (the check above guarantees there is one). "Plain text" = control and format characters
removed, as `plainText()` in `prompts/slots.ts`.

### `Db` (`packages/core/src/db/types.ts`; MemDb in BE-01, PgDb in BE-02)

```ts
// --- product lines (feature 006, migration 0020) ---
/** The business's lines with their current version: active first, then by name. */
listProductLines(businessId: string): Promise<ProductLine[]>;
getProductLine(id: string): Promise<ProductLine | null>;
/** Oldest first. */
listProductLineVersions(productLineId: string): Promise<ProductLineVersion[]>;
getProductLineVersion(productLineId: string, version: number): Promise<ProductLineVersion | null>;
/**
 * New line (productLineId null): the row and version 1. Existing line: version n+1 (any status).
 * Under withLock("product_line:<businessId>"): a new line is refused with "limit" when the business
 * already has `maxActive` active lines. "not_found": the id is not a line of this business.
 */
saveProductLine(input: { businessId: string; productLineId: string | null; data: ProductLineData; maxActive: number }): Promise<SaveLineResult>;
/** Same lock; discontinued → active is refused with "limit" as above. Sets updated_at. */
setProductLineStatus(input: { businessId: string; productLineId: string; status: ProductLineStatus; maxActive: number }): Promise<SaveLineResult>;
type SaveLineResult = { ok: true; line: ProductLine; created: boolean } | { ok: false; reason: "limit" | "not_found" };

// --- changed: scope (absent = business only, i.e. product_line_id is null) ---
listPrompts(businessId: string, opts?: { activeOnly?: boolean; line?: LineScope }): Promise<Prompt[]>;
insertPrompts(businessId: string, prompts: PromptInput[], line?: { productLineId: string; market: string }): Promise<Prompt[]>;
listScanRuns(businessId: string, limit?: number, line?: LineScope): Promise<ScanRun[]>;
listFindings(businessId: string, status?: FindingStatus | FindingStatus[], line?: LineScope): Promise<Finding[]>;
// ScanRunCreate gains productLineId?, productLineVersion?, market? (all or none).
// FindingInput gains productLineId?, market?; upsertFindings matches on them too (`is not distinct from`).
// insertSamples: unchanged input; the returned Sample carries productLineId/market from its run (trigger; MemDb mirrors it).
// Business-only, unchanged signatures, now `product_line_id is null`: lastScanRunStartedAt, deleteScanRun's
// "findings that last saw it" move target, dashboardRows (owner-area), listReportArchive (owner-area).
```

`packages/core/src/db/owner-area.ts`:

```ts
// RunSummary gains (filled by summarizeRun for every run, read by the line pages):
recommend?: { named: number; answers: number; others: { name: string; answers: number }[] }; // others: top 5
// runSummaries gains the scope:
export async function runSummaries(db: Db, businessId: string, limit: number, line?: LineScope): Promise<ArchiveRow[]>;
```

### Scanner (`packages/core/src/scanner`)

| Operation | Input | Output | Errors | Who may call it |
|---|---|---|---|---|
| `runScan(opts)` | `RunScanOptions` gains `productLineId?: string`, `market?: string` (both or neither) | `ScanReport` with `productLine` set | throws `line_not_scannable:<reason>` from `lineScanRefusal`; otherwise as today | worker `scan` and `recheck` jobs, `e2e:mock`, the CLI |
| `lineFacts(business, facts, version, market, now?)` `scanner/line.ts` | business record, its latest business facts (for website), a `ProductLineVersion`, a market | `Facts` with `name = version.name`, `place = ""`, `country = market`, `website` = the business's, `openStatus "open"`, every list empty, `profile null`, `productLine: LineFactsView` | — | `runScan`, `buildReport`, `buildSnapshot` |
| `loadLinePrompts(db, businessId, version, market, kind, promptIds?)` `prompts/line.ts` | | the wanted prompts for this version and market, stored first when missing (by text, scoped), in template order | — | `runScan` |
| `generateLinePrompts(version, market, brand)` `prompts/line.ts` | | `PromptInput[]` in `scanLang(market)` | — | `loadLinePrompts`, tests |
| `buildReport(scanRunId)` / `buildSnapshot(scanRunId)` | | a line run is rebuilt with `lineFacts(…, getProductLineVersion(run.productLineId, run.productLineVersion), run.market)` and scoped prompts | as today | as today |

Inside `runScan`, a line run differs from a business run in exactly these places (everything
else, sampling included, is the same code):

1. `getProductLine` → `lineScanRefusal` → `lineFacts(…)`; no understanding step (`profile = null`).
2. Prompts from `loadLinePrompts`; never `loadPrompts`.
3. The engines are asked with `ctx.business = { ...business, country: market, place: "" }`
   (`openAiUserLocation` and `perplexityUserLocation` already drop an empty city; `systemFor(market)`
   gives Dutch for NL and English elsewhere, which is `scanLang`).
4. `createScanRun({ …, productLineId, productLineVersion: version.version, market, profile: null })`.
5. `previousOpen = listFindings(business.id, OPEN, { productLineId, market })`; `FindingInput`s carry the scope.
6. No `recordScanUse` (question library), no bank promotion.
7. `assembleReport` sets `comparedAs = version.category` and `productLine`.

Questions per (line, market), in `scanLang(market)`, from code-held templates in
`prompts/line.ts` / `line.en.ts` (same keys, same order, kept in step by a test like
`sectors-en.test.ts`). Slots only from `slotValue()`; `{Welke}`/`{de beste}` via `welkFor` /
`deBesteFor` (nouns.ts); `{merk}` is added as " van {merk}" only when the line name does not
already contain the business name (normalised).

| Key | NL | EN | kind, category, probe, criterium | How many |
|---|---|---|---|---|
| `line.rec.use` | `{Welke} is het beste voor {toepassing}?` | `Which {category} is best for {use}?` | recommendation, `existence`, `existence:<use>`, 6 | one per use case |
| `line.rec.quality` | `Wat is {de beste}?` | `What is the best {category}?` | recommendation, `existence`, `existence:beste`, 6 | only when there are no use cases |
| `line.spec` | `{Welke spec} heeft {naam}{ van merk}?` | `What {spec} does {name}{ by brand} have?` | about, `spec`, `spec:<label>`, 13 | one per spec |
| `line.cert` | `Is {naam}{ van merk} {certificaat}-gecertificeerd?` | `Is {name}{ by brand} {certificate} certified?` | about, `certificate`, `certificate:<name>`, 14 | one per certificate |
| `line.outlet` | `Waar koop ik {naam}{ van merk} in {land}?` | `Where can I buy {name}{ by brand} in {country}?` | about, `outlet`, `outlet:<market>`, 15 | one, when the market has an outlet |
| `line.successor` | `Wat is de opvolger van {oud}{ van merk}?` | `What is the successor of {old}{ by brand}?` | about, `successor`, `successor:<old>`, 16 | one per replaced name |

At most 3 + 5 + 3 + 1 + 2 = **14 questions per (line, market)** with today's limits.

Judging the four keys (`factValue` / `valuesMatch` in `normalize.ts`, extraction in `extract.ts`,
rules mode for mock and LLM mode for real answers, both emitting `Claim`s with the probe's key and subject):

| Key | Claim value | Correct when |
|---|---|---|
| `spec` | the value the answer gives for that label, normalised (`normalizeLabel`, number + unit kept) | equal to the owner's value after the same normalisation, or both parse to the same number with the same unit |
| `certificate` | `yes` / `no` (`yesNo`) | equal to `valid ? "yes" : "no"` on the scan date |
| `outlet` | one claim per outlet named (name, or the host of a cited/named URL) | the name or host matches one of the owner's outlets for that market |
| `successor` | `__present__` when the answer names the line (`mentionsBusiness` with the line view), else the product named, else `__absent__` | `__present__` |

`mentionsBusiness` treats a facts object with `productLine` like an online profile (the name stands
alone, no place). `detectOtherEntity` returns false for it (no namesake judging for lines, no
criterium 11 finding). Not found works unchanged (sentinel claim, ≥ 50 % per key → `not_found`
finding on that key).

### Owner pages (web)

| Operation | Input | Output | Errors | Who may call it |
|---|---|---|---|---|
| Page `/app/productlijnen` (EN `/en/app/product-lines`) | `?nieuw=1` shows the add form; `?opgeslagen=<id>`, `?fout=<code>` | Every line of the active business: name, status, per market one dot per AI system from the latest line run summary (`engineStips`), open error count, "genoemd als aanrader n van m keer" from `summary.recommend`; "nog niet gecontroleerd" before its first run. A banner with the access reason when `productLineAccess` fails (AC1); the add button only when it passes and the limit is not reached | — | Signed-in member (`requireOwner`); reading needs no access check |
| Page `/app/productlijnen/[id]` (EN `/en/app/product-lines/[id]`) | `?bewerken=1` shows the edit form, `?markt=<code>` picks the market (default: first) | Per market: dot per AI system, open errors grouped per question (`groupByQuestion`) with source and link to `/app/fouten/[id]`, "Wie AI wel noemt" (n van m, the others named), trend as on `/app/voortgang` (`engineGrid`, `criteriumGrid`, `changeOver` over the line runs' snapshots), the current version and its date, versions count, the discontinue/activate button | `notFound()` when the id is not a line of the active business | Signed-in member |
| Server action `saveProductLine(form)` `apps/web/app/app/productlijnen/actions.ts` | hidden `business`, hidden `line` (empty = new); fields `name`, `category`, `useCases`, `markets` (repeated), `spec.{i}.label`, `spec.{i}.value`, `cert.{i}.name`, `cert.{i}.number`, `cert.{i}.validUntil`, `outlet.{i}.market`, `outlet.{i}.name`, `outlet.{i}.url`, `replaces`, `replacedBy` (i = 0…, stops at the first missing index) | redirect `/app/productlijnen/<id>?opgeslagen=1`; event `product_line.confirmed {productLineId, version, markets: n, created}` | redirect back (`/app/productlijnen?nieuw=1&…` or `/app/productlijnen/<id>?bewerken=1&…`) with `fout=toegang:<LineAccessRefusal>`, `fout=limiet`, or `fout=<field>[.<index>]:<reason>` (first error) | `requireOwnerOf(businessFromForm(form))` (membership), then `productLineAccess(business, session.userId)` |
| Server action `setProductLineStatus(form)` same file | hidden `business`, `line`, `status` (`active` \| `discontinued`) | redirect `/app/productlijnen/<id>?status=1`; event `product_line.status {productLineId, status}` | `fout=toegang:<reason>`, `fout=limiet` | same as above |
| `/app/fouten/[id]` | a line finding | as today, plus "Productlijn: {name} · {market name}" with a link to the line; "Dit klopt wél" goes to `/app/productlijnen/<lineId>?bewerken=1&betwist=<findingId>` instead of `/app/gegevens` | — | as today (`requireOwner`, finding of the active business) |
| `/r/[id]` | a line run id | `notFound()` (a line run has no public report page in this feature) | — | — |

EN paths: `lib/lang-paths.ts` gains a nested map for one segment, `app/productlijnen ↔
app/product-lines`, in `fromUrl` and `localizeHref` (other `/app/*` pages keep their Dutch
segment under `/en`, as today). Query keys stay Dutch, as elsewhere.

Copy: `copy.productLines` (NL `index.ts`, EN `en.ts`, same shape), plus `copy.criteria[13..16]`,
`copy.factKey.{spec,certificate,outlet,successor}`, `copy.mails.monthly.lines`. No price, no
"ranking", no position, no score, no jargon (GEO, AEO, LLM, prompt, platform, zichtbaarheid).

### Worker

```ts
// apps/worker/src/jobs/types.ts
interface ScanJob { /* … */ productLineId?: string; market?: string }
interface ReportJob { businessId: string; scanRunId?: string; /** the month's line runs to wait for */ lines?: { productLineId: string; market: string }[]; waited?: number }
```

| Step | Behaviour |
|---|---|
| `enqueueMonthlyScans` (cron) | after the business job, when `productLineAccess(b, b.ownerUserId).ok`: one `scan {businessId, kind:"monthly", productLineId, market, then:["fixes"]}` per `scannableLineMarkets`, `runAt` = the business slot + 2 min × (i + 1); event `scan.enqueued {kind, jobId, runAt, productLineId, market}`. The existing once-a-month check covers them (they are enqueued in the same pass) |
| `paidOnlyBlock` | a `scan` with `productLineId`, and a `recheck` whose finding has one, are guarded like on-demand scans (paying, not paused, verified), then `productLineAccess` and, for scans, `lineScanRefusal`; skip reasons logged as `job.skipped {kind, reason}` |
| `scan` handler | passes `productLineId`/`market` to `runScan`; a business monthly scan's `report` step carries `lines: scannableLineMarkets(…)` |
| `report` handler | for each expected (line, market): the newest line run of kind `monthly` started in the same Amsterdam month; while any is missing or not `done`/`failed` and `waited < LINE_REPORT_MAX_WAITS` (8), it re-enqueues itself in `LINE_REPORT_WAIT_MINUTES` (15) with `waited + 1` and returns; then sends |
| `spendBlock` | unchanged rule; the spread key includes `productLineId` and `market` so the line jobs of one business do not land on the same second |
| Fixer | `runRecheck` passes the finding's scope to `listPrompts` and `runScan`; `fixPathFor` and `isFindabilityFinding` read `productLineId` (ADR-0014) |

### Mails (`packages/core/src/reporter`)

```ts
// templates.ts: MonthlyReportData gains
lines?: LineMailSection[];
export interface LineMailSection {
  name: string;
  detailUrl: string;                       // dashboard origin + localized /app/productlijnen/<id>
  markets: { market: string; marketName: string; checked: boolean; stip: Stip | null; openErrors: number; named: { named: number; answers: number } | null }[];
  openFindings: OpenFindingLine[];         // max 3 shown, the rest as "en n meer"
}
```

`sendMonthlyReport` builds `lines` from `listProductLines` + the month's line runs (summaries) +
scoped open findings; the business part keeps reading business-only findings. One section per line
after the business blocks: heading "Productlijn: {name}", one sentence per market ("België:
oranje. 2 fouten open. Genoemd als aanrader: 3 van 10 keer."; "nog niet gecontroleerd" when the run
is missing or failed), up to three finding cards (`exampleCards`), a link to the line. Wording in
`copy.mails.monthly.lines` (NL + EN), the owner's `business.language`. The subject stays the
business's. Owner instruction and correction mails gain words for the four keys
(`facts-nl.ts` / `facts-en.ts`) and name the line ("over je productlijn Tigris K5"); letters to
third parties stay Dutch, as today.

### Events (instrumentation)

| Event | Business | Payload | Emitted by |
|---|---|---|---|
| `product_line.confirmed` | yes | `{productLineId, version, markets, created}` | FE-02 action |
| `product_line.status` | yes | `{productLineId, status}` | FE-02 action |
| `product_line.refused` | yes | `{reason}` (`limit` or a `LineAccessRefusal`) | FE-02 action |
| `scan.enqueued`, `scan.started`, `scan.finished` | yes | gain `productLineId`, `market` on line runs | cron, `runScan` |
| `report.waiting` | yes | `{waited, missing}` (counts only) | report handler |

No names, outlet URLs or free text in events.

### Mock seed (`apps/web/lib/demo.ts`, `seedDemoLines(db, businessId)`, called by `seedDemo` on MemDb)

Written by BE-01 through the `Db` methods above, deterministic, so FE builds without keys and
without BE-03/BE-04. Every name is made up.

| Line | Version, status | Markets | Facts |
|---|---|---|---|
| **Haarlems Speltbrood** | v2 (edited once), active | NL, BE | category `speltbrood`; use cases `ontbijt`, `lunch`; specs Gewicht 800 g, Houdbaarheid 4 dagen; certificate EKO, nr. EKO-0000, valid until 2027-06-30; outlets NL "Versmarkt Haarlem" (https://versmarkt-haarlem.example), BE "Broodhuys Gent" (https://broodhuys-gent.example); replaces "Speltbrood Classic" |
| **Grote Houtstraat Kerststol** | v1, active | NL | category `kerststol`; use case `kerstontbijt`; spec Gewicht 1 kg; outlet NL the bakery itself |

Per (line, market) three monthly runs (months 2, 1, 0 back) with prompts, samples, claims and a
saved `RunSummary` (with `recommend`), improving over time. Findings:

- **Held error**: Speltbrood · NL · ChatGPT, `spec` "Gewicht": "500 g" vs "800 g", source
  `https://broodwiki.example/speltbrood`, `third_party`, status `fixing`, one open fix (correction
  mail queued, recheck in 30 days), first seen two months ago.
- **Fixed one**: Kerststol · NL · Perplexity, `spec` "Gewicht": "750 g" vs "1 kg", `resolved` last
  month with `evidenceAfter` (a later correct sample) and a resolved fix, so a proof line exists.
- One more open: Speltbrood · BE · Google AI, `outlet` "BE": "Delhaize" not in the list, `open`.

Recommendation counts in the latest summaries: Speltbrood NL 3 of 10 (others: "Bakkerij Bart",
"Spelt & Zo"), Speltbrood BE 0 of 5, Kerststol NL 4 of 5.

## Authorisation model

| Data | Read | Write |
|---|---|---|
| `product_line`, `product_line_facts` | Members through `member_product_line*`; the owner pages through the service handle after `requireOwner`, scoped to the active business | Service handle only, in `saveProductLine` / `setProductLineStatus`, after `requireOwnerOf` (membership from the form's business, never the cookie) and `productLineAccess` |
| Line rows in `prompt`, `sample` | Service role only (internal, unchanged) | `runScan` |
| Line rows in `scan_run`, `finding`, `fix` | Members through `member_scan`, `member_finding`, `member_fix` (0016), unchanged | `runScan`, fixer |
| Monthly line scans, rechecks | — | Worker, gated by `paidOnlyBlock` + `productLineAccess` + `lineScanRefusal` |

Membership decides which business; `productLineAccess` decides whether this user may spend on it.
That function uses `isVerifiedOwner` (the verified owner's user id), which is the only role
`business_member` has today. When D3 admits colleagues, `productLineAccess` is the one place that
changes (role from `business_member`), nothing else. Nothing the client sends grants value: the
business comes from membership, the limit and plan check run on the server, and every value that
reaches an AI system passes `sanitizeSlot`.

## Failure modes

| What fails | Detected how | What the user sees | What we do |
|---|---|---|---|
| Owner without access opens the page | `productLineAccess` | The page and any existing lines, a banner with the reason ("Bevestig eerst dat je de eigenaar bent", "Productlijnen horen bij Vidalo Monthly", …), no add or save button | Nothing is saved; a crafted POST gets `fout=toegang:<reason>` and `product_line.refused` |
| Two saves race past the limit | `withLock` count | The second gets "Je hebt het maximum aantal productlijnen" | `fout=limiet`, nothing written |
| A form value is refused by the sanitiser | `parseProductLine` | The field's error, tied to the field, before submit (browser) and after (server) | Nothing written |
| Line run fails (engine outage, crash) | `runScan` throws; job retries with backoff | The line shows the previous month; the mail says "nog niet gecontroleerd" for that market | `scan.failed`; cost recorded as today |
| Line runs still running when the report is due | report handler | Mail arrives up to 2 h later | Waits 8 × 15 min, then sends what exists |
| Daily AI ceiling reached | `spendBlock` | Line run a day later; that month's mail may say "nog niet gecontroleerd" | Deferred once, as every monthly check |
| AI does not know the line | ≥ 50 % not-found samples on a key | Grey dot or "niet gevonden" rows | Finding on the "keep checking" path (ADR-0014), honest wording, no remedy claimed |
| A spec answer in other units ("16 bar" vs "PN16") | value mismatch | A wrong finding | Ratio threshold (30 %) and LLM normalisation; the owner disputes from the finding page and edits the spec; QA checks real answers before launch |
| AI names a legitimate reseller the owner did not list | outlet not in list | A wrong finding on "Waar te koop" | Same: dispute → edit the outlets; the copy says "niet in je lijst", not "fout verkooppunt" |
| A line is discontinued while a fix is open | — | The finding stays visible with its fix | Rechecks still run (`lineScanRefusal` allows `recheck`); no new monthly runs |
| Owner downgrades or stops paying | `productLineAccess` at enqueue and run | Lines stay readable; no new checks | Jobs skipped with `job.skipped` |
| A business reader forgets the scope | isolation test (BE-02) | — | CI fails before merge |

## Cost

At today's prices a monthly business check asks up to ~38 questions for about €7–11
(`docs/cost-per-client.md`), so roughly €0.18–0.29 per question per month under the same sampling
rules. A (line, market) asks at most 14 questions.

| | Per month |
|---|---|
| One (line, market) at the cap | ≈ €2.50–4.10 |
| Provisional limits (2 lines × 2 markets) | ≈ €10–16 on top of the business's €7–11 |
| If D2 were 5 lines × 3 markets | ≈ €38–62 |

`docs/cost-per-client.md` gains this row in FE-05. These numbers are why the provisional limit is
2 × 2 and why D1 must be decided before any owner is offered lines. Line runs count towards the
daily AI ceiling (`paidScanCentsSince` sums every paid run).

## Surfaces that change in the same PR (AC8)

| Surface | Change | Ticket |
|---|---|---|
| Owner nav (`app/app/layout.tsx`) | "Productlijnen" when the business has lines or `productLineAccess` passes | FE-01 |
| `/app/productlijnen`, `/app/productlijnen/[id]`, `/app/fouten/[id]` | new / extended | FE-01–FE-04 |
| Mails | monthly section per line; owner and correction mails word the four keys | BE-05, BE-06 |
| `docs/CRITERIA.md` | section "Productlijnen": criteria 13–16, severities, thresholds, the question table | FE-05 |
| `docs/ARCHITECTURE.md` | workflow C: line runs; workflow D: line fix paths | FE-05 |
| `docs/MESSAGING.md` | line wording rules (no position, "genoemd als aanrader", "niet in je lijst") | FE-05 |
| `docs/cost-per-client.md` | the cost row above | FE-05 |
| Landing, `/prijzen`, FAQ, assistant | **none on main**: lines are a monthly-plan feature with no price yet (D1) | — |
| `/organisaties`, corporate pricing ("in je dashboard") | **follow-up**: those pages live on the unmerged corporate branch; update them when it merges | follow-up |
| Terms ("what a line includes") | **follow-up, needs D1/D2**: the sentence names the limit and the price; compliance drafts it then, `legal:lock` with a new date | follow-up |
| Privacy, `docs/processors.md`, cookie table | expected none: no new vendor, no personal data (product names, public outlets); compliance confirms in phase 1 | — |
| Data export (ADR-0006) | expected none: a line holds no personal data; compliance confirms | — |
| Report statuses and square marks (corporate branch) | the line pages use `OwnerUi` (`Dot`, `Row`, `Section`, `MarkWrong`/`MarkOk`/`MarkGrey`), so they take that pass when it merges | — |

## Work split

| Ticket | Lane | Depends on | Estimate |
|---|---|---|---|
| [BE-01](tickets/BE-01.md) Contract: types, criteria 13–16, `Db` signatures + scope, MemDb, `parseProductLine`, `productLineAccess`, limits, copy keys, mock seed | backend | — | 6 h |
| [BE-02](tickets/BE-02.md) Migration 0020, PgDb, scoped readers, isolation test, RLS script (AC6) | backend | BE-01 | 5 h |
| [BE-03](tickets/BE-03.md) Line questions: templates NL/EN, slot kinds, `generateLinePrompts`, `loadLinePrompts` | backend | BE-01 | 3 h |
| [BE-04](tickets/BE-04.md) Scanning a line: `lineFacts`, extraction and comparison of the four keys, `runScan` branch, `buildReport`/`buildSnapshot`, mock answers, `recommend` in the summary | backend | BE-01, BE-03 | 6 h |
| [BE-05](tickets/BE-05.md) Worker and fixer: monthly line jobs, gating, report wait, line fix paths, rechecks, mail words | backend | BE-01, BE-04 | 4 h |
| [BE-06](tickets/BE-06.md) Monthly mail sections NL/EN, mail lab, `e2e:mock` with a line | backend | BE-04, BE-05 | 3 h |
| [FE-01](tickets/FE-01.md) `/app/productlijnen` list, nav, EN path, access banner | frontend | BE-01 (types, MemDb, seed) | 4 h |
| [FE-02](tickets/FE-02.md) Add, edit, discontinue: form and actions | frontend | BE-01 | 5 h |
| [FE-03](tickets/FE-03.md) Line detail: per market dots, errors, "Wie AI wel noemt", trend | frontend | BE-01 | 5 h |
| [FE-04](tickets/FE-04.md) A line finding on `/app/fouten/[id]`; `/r/[id]` refuses line runs | frontend | BE-01 | 2 h |
| [FE-05](tickets/FE-05.md) Docs and copy surfaces, jargon check, follow-up list | frontend | — | 2 h |

Frontend dependency, flagged: FE-01 to FE-04 compile and run against BE-01, a contract ticket of
types, signatures, MemDb, two pure functions and the seed; no scanner logic. Nothing on the
frontend waits for BE-02 to BE-06: the seed holds everything the pages show (summaries with
`recommend`, scoped findings with fixes and samples). The browser check of a line that came out of
a real mock scan (not the seed) needs BE-04; that is QA's phase, not a build block.

## Interpretations of the brief, named

1. **"Fields on the row" vs versioned facts.** The sketch puts `name`, `category`, `status`,
   `markets` on `product_line` and the rest in versioned `facts`. Here only `status` is on the row;
   name, category and markets are in the version, because a run must be judged against what it was
   asked with and one question must have one answer (ADR-0011).
2. **"Confirmed line"** (AC2). As with business facts on `/app/gegevens`, saving the form is the
   confirmation; every version is confirmed, so there is no provisional state for a line.
3. **"Paying owner"** (AC1). Lines enter the monthly check, which only Vidalo Monthly/Yearly has
   (`plan = "monitor"`), so a Vidalo Scan owner sees the page with the reason "Productlijnen horen
   bij Vidalo Monthly". D1 may change this in `productLineAccess` only.
4. **"Discontinued"** stops new monthly runs of the line; its history, open fixes and rechecks stay.
   A line is never deleted.
5. **"In the market's language"** (AC2) is `scanLang(market)`, as the brief says: Dutch for NL,
   English for every other market, Belgium and Germany included.
6. **`sample.product_line_id`** is kept as the brief asks, but derived by the database from the
   scan run, so it cannot disagree (ADR-0011).
7. **"Genoemd als aanrader"** counts per market over the category questions of that month's run;
   "who else was named" is the top five names across those questions, never a position.
8. **`/en/app/product-lines`**: other owner pages keep their Dutch segment under `/en`; this one is
   translated because the brief names the path. One nested mapping in `lang-paths.ts`.

## What this makes harder later

- **Every business reader carries a scope.** A new `Db` method that reads prompts, runs or
  findings must decide business vs line; forgetting it leaks line rows into the business view. The
  isolation test catches the readers it lists, not ones written later; whoever adds a reader adds
  it to the test.
- **A line has no page of its own.** Not found and not named on a line have no remedy, only
  honest repetition. The obvious next request (a product facts page, or lines on the facts page)
  needs a publisher change and its own fix paths.
- **One run per market multiplies rows**: 2 × 2 lines-markets is four more runs a month per
  business; the archive and progress queries already filter them out, but the job queue and the
  daily ceiling feel them.
- **The stipregel weights are Dutch** (`ENGINE_NL_USAGE`) and apply to every market; a Belgian or
  German line is coloured as if its buyers used AI the way Dutch users do.
- **English for every foreign market** follows `scanLang`; asking Flemish or German buyers'
  questions needs a third scan language, which touches every template file.
- **The limit is code under a lock, not a database number.** A script writing lines with the
  service role and skipping `saveProductLine` is not stopped by the database; only the backstop
  CHECK sizes are.
- **Criteria 13–16 are numbered after the public twelve.** If the public criteria ever grow, they
  start at 17, or the line criteria are renumbered with a data migration of `finding.criterium`.
