/**
 * Product lines on the owner pages (feature 006, FE-01..FE-03). Reads go through the service handle AFTER requireOwner,
 * scoped to the active business: a line of another business is null here, never a row (security S-27). The save and
 * status logic is here too, without next/*, so a test can drive it with a MemDb and a made-up session: the server
 * actions in app/app/productlijnen/actions.ts only add the session, the redirect and the cache.
 */
import type { BusinessRecord, Db } from "@vidalo/core/db";
import { openFixesByFinding, runSummaries, type ArchiveRow } from "@vidalo/core/db";
import { PROGRESS_SCAN_KINDS, type ScanSnapshot } from "@vidalo/core/progress";
import type { EngineStip, Finding, Fix, ProductLine, Stip } from "@vidalo/core/types";
import { PRODUCT_LINE_LIMITS, parseProductLine, productLineAccess, productLinesEnabled, type LineAccessRefusal, type ProductLineFieldError, type ProductLineFormInput } from "@vidalo/core/shared";
import { groupByQuestion, type FindingGroup } from "./owner-data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isLineId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const OPEN: Finding["status"][] = ["open", "fixing", "recheck"];

// ---------------------------------------------------------------------------
// The list (FE-01)
// ---------------------------------------------------------------------------

export interface MarketItem {
  market: string;
  checkedAt: string | null;
  stip: Stip | null;
  engineStips: EngineStip[];
  /** open errors, one per question (the same error on three AI systems is one) */
  openErrors: number;
  named: { named: number; answers: number } | null;
}
export interface LineListItem {
  line: ProductLine;
  markets: MarketItem[];
}

/** The newest finished check of a (line, market): its summary, or null before the first run. */
async function latestOf(db: Db, businessId: string, productLineId: string, market: string): Promise<ArchiveRow | null> {
  return (await runSummaries(db, businessId, 1, { productLineId, market }))[0] ?? null;
}

function marketItem(market: string, latest: ArchiveRow | null, open: Finding[]): MarketItem {
  const s = latest?.summary ?? null;
  const rec = s?.recommend && s.recommend.answers > 0 ? { named: s.recommend.named, answers: s.recommend.answers } : null;
  return {
    market,
    checkedAt: latest ? latest.createdAt : null,
    stip: s?.stip ?? null,
    engineStips: s?.snapshot.engineStips ?? [],
    openErrors: groupByQuestion(open).length,
    named: rec,
  };
}

/** Every line of the business with, per market of its current version, the latest check. The lines come first as listProductLines orders them. */
export async function loadProductLines(business: BusinessRecord, db: Db): Promise<LineListItem[]> {
  const lines = await db.listProductLines(business.id);
  return Promise.all(
    lines.map(async (line) => ({
      line,
      markets: await Promise.all(
        line.current.markets.map(async (market) => {
          const [latest, open] = await Promise.all([latestOf(db, business.id, line.id, market), db.listFindings(business.id, OPEN, { productLineId: line.id, market })]);
          return marketItem(market, latest, open);
        }),
      ),
    })),
  );
}

// ---------------------------------------------------------------------------
// The detail (FE-03)
// ---------------------------------------------------------------------------

export interface MarketDetail {
  market: string;
  /** oldest first, finished full checks only (a recheck asks a few questions and is no "check") */
  snapshots: ScanSnapshot[];
  latest: ArchiveRow | null;
  recommend: { named: number; answers: number; others: { name: string; answers: number }[] } | null;
  open: FindingGroup[];
  resolved: Finding[];
  /** the open fix of each open finding, by finding id */
  fixes: Map<string, Fix>;
}
export interface LineDetail {
  line: ProductLine;
  versions: number;
  markets: MarketDetail[];
}

const SNAPSHOTS = 12;

/** One line with its checks per market; null when the id is not a line of this business (the page answers 404). */
export async function loadProductLineDetail(id: string, business: BusinessRecord, db: Db): Promise<LineDetail | null> {
  if (!isLineId(id)) return null;
  const line = await db.getProductLine(id);
  if (!line || line.businessId !== business.id) return null;
  const versions = (await db.listProductLineVersions(line.id)).length;
  const fixes = await openFixesByFinding(db, business.id, { productLineId: line.id });
  const markets = await Promise.all(
    line.current.markets.map(async (market): Promise<MarketDetail> => {
      const scope = { productLineId: line.id, market };
      const [rows, findings] = await Promise.all([runSummaries(db, business.id, SNAPSHOTS, scope), db.listFindings(business.id, undefined, scope)]);
      const full = rows.filter((r) => r.summary && PROGRESS_SCAN_KINDS.includes(r.kind));
      const open = findings.filter((f) => OPEN.includes(f.status));
      return {
        market,
        snapshots: full.map((r) => r.summary!.snapshot).sort((a, b) => a.checkedAt.localeCompare(b.checkedAt)),
        latest: full[0] ?? null,
        recommend: full[0]?.summary?.recommend && full[0].summary.recommend.answers > 0 ? full[0].summary.recommend : null,
        open: groupByQuestion(open),
        resolved: findings.filter((f) => f.status === "resolved").sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? "")),
        fixes,
      };
    }),
  );
  return { line, versions, markets };
}

/** ?markt= is accepted only when it is one of the line's markets; anything else is the first (security S-27). Never echoed. */
export function pickMarket(line: ProductLine, param: string | undefined): string {
  return param && line.current.markets.includes(param) ? param : line.current.markets[0]!;
}

/** Whether the page may read lines at all: off in production until the launch switch is on (compliance B3, L-42). */
export const linesReadable = (): boolean => productLinesEnabled();

/** A link that is safe to render as an anchor: http(s) only, checked again at render time (security S-19). */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ?fout= : the codes the actions can send back, mapped to words (security S-28)
// ---------------------------------------------------------------------------

export type LineFout =
  | { kind: "field"; field: ProductLineFieldError["field"]; index?: number; reason: ProductLineFieldError["reason"] }
  | { kind: "access"; reason: LineAccessRefusal }
  | { kind: "limit" };

const FIELDS = ["name", "category", "useCases", "markets", "specs", "certificates", "outlets", "replaces", "replacedBy"] as const;
const ACCESS = ["not_enabled", "not_verified", "not_paying", "no_monthly_plan", "paused"] as const;

/** Anything that is not exactly one of the codes is null, and renders nothing. The text itself comes from the copy lookup. */
export function parseFout(code: string | undefined): LineFout | null {
  if (!code) return null;
  if (code === "limiet") return { kind: "limit" };
  const access = /^toegang:([a-z_]+)$/.exec(code);
  if (access) return (ACCESS as readonly string[]).includes(access[1]!) ? { kind: "access", reason: access[1] as LineAccessRefusal } : null;
  const m = /^([A-Za-z]+)(?:\.(\d{1,3}))?:([a-z_]+)$/.exec(code);
  if (!m || !(FIELDS as readonly string[]).includes(m[1]!)) return null;
  return { kind: "field", field: m[1] as ProductLineFieldError["field"], ...(m[2] !== undefined ? { index: Number(m[2]) } : {}), reason: m[3] as ProductLineFieldError["reason"] };
}

/** The code a refusal travels as in a redirect. */
export function foutCode(e: ProductLineFieldError): string {
  return `${e.field}${e.index === undefined ? "" : `.${e.index}`}:${e.reason}`;
}

/** How many a "too_many" message names, per field. */
export const FIELD_MAX: Record<ProductLineFieldError["field"], number> = {
  name: 1,
  category: 1,
  useCases: PRODUCT_LINE_LIMITS.useCases,
  markets: PRODUCT_LINE_LIMITS.marketsPerLine,
  specs: PRODUCT_LINE_LIMITS.specs,
  certificates: PRODUCT_LINE_LIMITS.certificates,
  outlets: PRODUCT_LINE_LIMITS.outletsPerMarket,
  replaces: PRODUCT_LINE_LIMITS.replaces,
  replacedBy: 1,
};

type ErrorCopy = Record<string, Record<string, string | ((n: number) => string)>>;
/** The sentence for a field error, or null when the copy has none for that pair (so a crafted ?fout= says nothing). */
export function fieldErrorText(errors: ErrorCopy, field: string, reason: string): string | null {
  if (!Object.hasOwn(errors, field)) return null;
  const forField = errors[field]!;
  if (!Object.hasOwn(forField, reason)) return null;
  const v = forField[reason]!;
  return typeof v === "function" ? v(FIELD_MAX[field as ProductLineFieldError["field"]] ?? 1) : v;
}

// ---------------------------------------------------------------------------
// The form's fields, and the two writes (FE-02)
// ---------------------------------------------------------------------------

/** Indexed groups are read from 0 until the first index with no field present, and never past this (security S-11). */
const GROUP_CAP = 101;

const text = (form: FormData, key: string): string => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

function rows<T>(form: FormData, prefix: string, keys: readonly string[], read: (i: number) => T): T[] {
  const out: T[] = [];
  for (let i = 0; i < GROUP_CAP; i++) {
    if (!keys.some((k) => form.has(`${prefix}.${i}.${k}`))) break;
    out.push(read(i));
  }
  return out;
}

export function formInput(form: FormData): ProductLineFormInput {
  return {
    name: text(form, "name"),
    category: text(form, "category"),
    useCases: text(form, "useCases"),
    markets: form.getAll("markets").filter((v): v is string => typeof v === "string"),
    specs: rows(form, "spec", ["label", "value"], (i) => ({ label: text(form, `spec.${i}.label`), value: text(form, `spec.${i}.value`) })),
    certificates: rows(form, "cert", ["name", "number", "validUntil"], (i) => ({ name: text(form, `cert.${i}.name`), number: text(form, `cert.${i}.number`), validUntil: text(form, `cert.${i}.validUntil`) })),
    outlets: rows(form, "outlet", ["market", "name", "url"], (i) => ({ market: text(form, `outlet.${i}.market`), name: text(form, `outlet.${i}.name`), url: text(form, `outlet.${i}.url`) })),
    replaces: text(form, "replaces"),
    replacedBy: text(form, "replacedBy"),
  };
}

const LIST = "/app/productlijnen";

export type LineOutcome =
  /** Dutch route to redirect to (the action localises it). */
  | { to: string }
  /** The form stays on screen with what was typed: a server-side error never empties it (WCAG 3.3.7). */
  | { fields: ProductLineFieldError[]; values: ProductLineFormInput }
  | { limit: true; values: ProductLineFormInput };

interface Who {
  business: BusinessRecord;
  userId: string;
  now?: Date;
  env?: Record<string, string | undefined>;
}

/** Where a refusal goes back to: the line's own page when the form named a real line, else the list. */
function backTo(form: FormData, query: string): string {
  const line = text(form, "line");
  return `${isLineId(line) ? `${LIST}/${line}` : LIST}?${query}`;
}

async function refuse(db: Db, business: BusinessRecord, reason: string): Promise<void> {
  await db.logEvent(business.id, "product_line.refused", { reason });
}

/** The access gate every write goes through (ADR-0012): the first failing reason is the refusal, and it is logged without text. */
async function gate(db: Db, who: Who, form: FormData): Promise<LineOutcome | null> {
  const access = productLineAccess(who.business, who.userId, who.now, who.env);
  if (access.ok) return null;
  await refuse(db, who.business, access.reason);
  return { to: backTo(form, `fout=toegang:${access.reason}`) };
}

const canonical = (v: unknown): unknown => (Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v);
/** The owner's fields of a stored version against a parsed form (the version's own bookkeeping is left out). */
function sameData(stored: object, data: object): boolean {
  const keys = Object.keys(data);
  return JSON.stringify(canonical(Object.fromEntries(keys.map((k) => [k, (stored as Record<string, unknown>)[k]])))) === JSON.stringify(canonical(data));
}

/** saveProductLine, after requireOwnerOf has said who is signed in and which business the form named. */
export async function saveLineFromForm(db: Db, who: Who, form: FormData): Promise<LineOutcome> {
  const refused = await gate(db, who, form);
  if (refused) return refused;
  const values = formInput(form);
  const line = text(form, "line");
  if (line && !isLineId(line)) return { to: LIST };
  const parsed = parseProductLine(values);
  if (!parsed.ok) return { fields: parsed.errors, values };
  // Saved with no change: no new version and no event (S-13), so a script cannot grow either table.
  if (line) {
    const now = await db.getProductLine(line);
    if (now && now.businessId === who.business.id && sameData(now.current, parsed.data)) return { to: `${LIST}/${now.id}?opgeslagen=1` };
  }
  const saved = await db.saveProductLine({ businessId: who.business.id, productLineId: line || null, data: parsed.data, maxActive: PRODUCT_LINE_LIMITS.lines });
  if (!saved.ok) {
    if (saved.reason === "limit") {
      await refuse(db, who.business, "limit");
      return { limit: true, values };
    }
    return { to: LIST };
  }
  await db.logEvent(who.business.id, "product_line.confirmed", { productLineId: saved.line.id, version: saved.line.current.version, markets: parsed.data.markets.length, created: saved.created });
  return { to: `${LIST}/${saved.line.id}?opgeslagen=1` };
}

/** setProductLineStatus: "Niet meer leverbaar" and "Weer actief". Reactivating goes through the same limit. */
export async function setStatusFromForm(db: Db, who: Who, form: FormData): Promise<{ to: string }> {
  const refused = await gate(db, who, form);
  if (refused && "to" in refused) return refused;
  const id = text(form, "line");
  const status = text(form, "status");
  if (!isLineId(id) || (status !== "active" && status !== "discontinued")) return { to: LIST };
  const done = await db.setProductLineStatus({ businessId: who.business.id, productLineId: id, status, maxActive: PRODUCT_LINE_LIMITS.lines });
  if (!done.ok) {
    if (done.reason === "limit") {
      await refuse(db, who.business, "limit");
      return { to: `${LIST}/${id}?fout=limiet` };
    }
    return { to: LIST };
  }
  await db.logEvent(who.business.id, "product_line.status", { productLineId: id, status });
  return { to: `${LIST}/${id}?status=1` };
}
