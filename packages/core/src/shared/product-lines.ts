/**
 * Product lines (feature 006, ADR-0010..0014): the limits, who may save and scan a line, and the
 * owner's form turned into confirmed data. Pure functions; the server action and the browser form
 * both call parseProductLine, the server stays authoritative.
 */
import type { BusinessRecord } from "../db/types.js";
import type { LineScope, ProductLine, ProductLineCertificate, ProductLineData, ProductLineOutlet, ProductLineSpec, ScanKind } from "../types.js";
import { SLOT_LIMIT, sanitizeSlot, type SlotKind } from "../prompts/slots.js";
import { isCountryCode } from "./country.js";
import { isVerifiedOwner } from "./ownership.js";

/** D2 open (Julian). Provisional, sized by cost (02-architecture.md "Cost"): the only place these numbers live. */
export const PRODUCT_LINE_LIMITS = {
  lines: 2, // active lines per business
  marketsPerLine: 2,
  useCases: 3,
  specs: 5,
  certificates: 3,
  outletsPerMarket: 5,
  replaces: 2,
} as const;

/**
 * Markets a line may be asked in: EU, EEA, UK and CH only (compliance B5). Never a sanctioned country.
 * The market control offers these and parseProductLine refuses anything else.
 */
export const LINE_MARKETS = ["NL", "BE", "DE", "LU", "FR", "GB", "AT", "CH", "DK", "SE", "NO", "FI", "IE", "ES", "IT", "PL"] as const;

/** Launch switch (compliance B3, D1 open): off in production until Julian decides; the mock counts as on. */
export function productLinesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.VIDALO_PRODUCT_LINES === "1" || env.VIDALO_MOCK === "1";
}

export type LineAccessRefusal = "not_enabled" | "not_verified" | "not_paying" | "no_monthly_plan" | "paused";
export type LineAccess = { ok: true } | { ok: false; reason: LineAccessRefusal };

/**
 * D1/D3 open (Julian). The one function that says whether lines may be saved and scanned.
 * Checked in this order; the first failing reason is returned: the switch is on (VIDALO_PRODUCT_LINES=1 or the mock),
 * the user is the verified owner,
 * the business is paying (trial | active), on the monthly plan (plan "monitor"), not paused.
 */
export function productLineAccess(
  business: Pick<BusinessRecord, "plan" | "status" | "ownerVerifiedAt" | "ownerUserId" | "pauseUntil">,
  userId: string | null | undefined,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): LineAccess {
  if (!productLinesEnabled(env)) return { ok: false, reason: "not_enabled" };
  if (!isVerifiedOwner(business, userId)) return { ok: false, reason: "not_verified" };
  if (business.status !== "trial" && business.status !== "active") return { ok: false, reason: "not_paying" };
  if (business.plan !== "monitor") return { ok: false, reason: "no_monthly_plan" };
  if (business.pauseUntil && new Date(business.pauseUntil) > now) return { ok: false, reason: "paused" };
  return { ok: true };
}

/** Worker: null when this (line, market) may be scanned now; else the reason. A recheck may scan a discontinued line. */
export function lineScanRefusal(line: ProductLine | null, businessId: string, market: string, kind: ScanKind): "no_line" | "other_business" | "discontinued" | "not_a_market" | null {
  if (!line) return "no_line";
  if (line.businessId !== businessId) return "other_business";
  if (line.status !== "active" && kind !== "recheck") return "discontinued";
  if (!line.current.markets.includes(market)) return "not_a_market";
  return null;
}

/** Active lines × their current markets, in name order, within today's limits. The cron, the report wait and the mail use it. */
export function scannableLineMarkets(lines: ProductLine[]): { productLineId: string; version: number; market: string }[] {
  // Clamped to today's limits (S-23): lowering a limit stops the spend at once, not at the owner's next edit. The oldest
  // active lines are the ones that stay; the stored backstop (10 markets) is wider than what is asked.
  return lines
    .filter((l) => l.status === "active")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .slice(0, PRODUCT_LINE_LIMITS.lines)
    .sort((a, b) => a.current.name.localeCompare(b.current.name, "nl") || a.id.localeCompare(b.id))
    .flatMap((l) => l.current.markets.slice(0, PRODUCT_LINE_LIMITS.marketsPerLine).map((market) => ({ productLineId: l.id, version: l.current.version, market })));
}

/** The scope a finding's reads need: undefined for a business finding. */
export function lineScopeOf(f: { productLineId?: string | null; market?: string | null }): LineScope | undefined {
  if (!f.productLineId) return undefined;
  return f.market ? { productLineId: f.productLineId, market: f.market } : { productLineId: f.productLineId };
}

// ---------------------------------------------------------------------------
// The owner's form
// ---------------------------------------------------------------------------

export interface ProductLineFormInput {
  name: string;
  category: string;
  useCases: string; // one per line (textarea)
  markets: string[]; // checked country codes
  specs: { label: string; value: string }[];
  certificates: { name: string; number: string; validUntil: string }[]; // validUntil "" or YYYY-MM-DD
  outlets: { market: string; name: string; url: string }[];
  replaces: string; // one per line (textarea)
  replacedBy: string;
}
export type ProductLineField = "name" | "category" | "useCases" | "markets" | "specs" | "certificates" | "outlets" | "replaces" | "replacedBy";
export type ProductLineFieldError = { field: ProductLineField; index?: number; reason: "required" | "refused" | "too_long" | "too_many" | "invalid" | "outside_markets" };

const MAX = { name: 80, category: 60, specValue: 60, certNumber: 40, outletName: 80, url: 300, replacedBy: 80 } as const;

/** Plain text as prompts/slots.ts plainText(): NFKC, control and format characters out, one space between words. Null for bidi overrides. */
function plain(raw: unknown): string | null {
  if (typeof raw !== "string") return "";
  const cap = raw.slice(0, 1000);
  if (/[\u202a-\u202e\u2066-\u2069]/.test(cap)) return null;
  return cap
    .normalize("NFKC")
    .replace(/[\t\n\r\u0085\u2028\u2029]/g, " ")
    .replace(/[\p{Cc}\p{Cf}\u00ad\u200b-\u200f\u2060-\u2064\ufeff]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

type Check = { ok: true; text: string } | { ok: false; reason: ProductLineFieldError["reason"] };

/** A required text that must also pass the slot sanitiser (its value reaches an AI system). */
function slotText(raw: unknown, slot: SlotKind, max: number): Check {
  const text = plain(raw);
  if (text === null) return { ok: false, reason: "refused" };
  if (!text) return { ok: false, reason: "required" };
  if (text.length > max) return { ok: false, reason: "too_long" };
  if (sanitizeSlot(text, slot) === null) return { ok: false, reason: "refused" };
  return { ok: true, text };
}

/** Text that must never turn into a link or markup in a mail or page (security S-21). */
function looksLikeLinkOrMarkup(text: string): boolean {
  return /[<>]/.test(text) || text.includes("://") || /www\./i.test(text);
}

/** A required plain text (never reaches an AI system, never a link or markup). */
function plainText(raw: unknown, max: number): Check {
  const text = plain(raw);
  if (text === null || (text && looksLikeLinkOrMarkup(text))) return { ok: false, reason: "refused" };
  if (!text) return { ok: false, reason: "required" };
  if (text.length > max) return { ok: false, reason: "too_long" };
  return { ok: true, text };
}

/** Linear time and cut to MAX_ROWS + 1 kept lines (SEC-V03): a 700 KB textarea must not cost minutes of CPU. */
function lines(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of String(raw ?? "").split(/\r\n|\r|\n/)) {
    if (out.length > MAX_ROWS) break;
    const t = plain(part);
    if (t === null) out.push(part); // kept so the slot check refuses it with its index
    else if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

/** A real calendar date written YYYY-MM-DD. */
function isRealDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** The normalised href of an http(s) URL without credentials, or null (security S-19). */
function httpUrl(v: string): string | null {
  if (v.length > MAX.url) return null;
  try {
    const u = new URL(v);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname || u.username || u.password) return null;
    return u.href.length > MAX.url ? null : u.href;
  } catch {
    return null;
  }
}

/** Form rows read past this are refused as too many, not iterated (security S-11). */
const MAX_ROWS = 100;

export function parseProductLine(input: ProductLineFormInput): { ok: true; data: ProductLineData } | { ok: false; errors: ProductLineFieldError[] } {
  const L = PRODUCT_LINE_LIMITS;
  const errors: ProductLineFieldError[] = [];
  const err = (field: ProductLineField, reason: ProductLineFieldError["reason"], index?: number) =>
    errors.push(index === undefined ? { field, reason } : { field, index, reason });

  // name, category
  const name = slotText(input.name, "name", MAX.name);
  if (!name.ok) err("name", name.reason);
  const category = slotText(input.category, "category", MAX.category);
  if (!category.ok) err("category", category.reason);

  // useCases
  const useCases: string[] = [];
  const useRows = lines(input.useCases).slice(0, MAX_ROWS);
  useRows.forEach((raw, i) => {
    const c = slotText(raw, "use", SLOT_LIMIT.use);
    if (c.ok) useCases.push(c.text);
    else err("useCases", c.reason === "required" ? "refused" : c.reason, i);
  });
  if (useRows.length > L.useCases) err("useCases", "too_many");

  // markets
  const markets: string[] = [];
  let marketsBad = false;
  for (const raw of input.markets ?? []) {
    const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
    if (!(LINE_MARKETS as readonly string[]).includes(code) || !isCountryCode(code)) {
      if (!marketsBad) err("markets", "invalid");
      marketsBad = true;
    } else if (!markets.includes(code)) markets.push(code);
  }
  // One order for the same set (QA-11): the allow-list's, so a reordered post is not a new version.
  markets.sort((a, b) => LINE_MARKETS.indexOf(a as (typeof LINE_MARKETS)[number]) - LINE_MARKETS.indexOf(b as (typeof LINE_MARKETS)[number]));
  if (!markets.length && !marketsBad) err("markets", "required");
  if (markets.length > L.marketsPerLine) err("markets", "too_many");

  // specs
  const specs: ProductLineSpec[] = [];
  let specRows = 0;
  (input.specs ?? []).slice(0, MAX_ROWS).forEach((row, i) => {
    if (!plain(row?.label) && !plain(row?.value)) return; // both parts empty: dropped
    specRows++;
    const label = slotText(row.label, "spec", SLOT_LIMIT.spec);
    const value = plainText(row.value, MAX.specValue);
    if (!label.ok) err("specs", label.reason, i);
    else if (!value.ok) err("specs", value.reason, i);
    else specs.push({ label: label.text, value: value.text });
  });
  if (specRows > L.specs || (input.specs ?? []).length > MAX_ROWS) err("specs", "too_many");

  // certificates
  const certificates: ProductLineCertificate[] = [];
  let certRows = 0;
  (input.certificates ?? []).slice(0, MAX_ROWS).forEach((row, i) => {
    if (!plain(row?.name) && !plain(row?.number) && !plain(row?.validUntil)) return;
    certRows++;
    const cname = slotText(row.name, "certificate", SLOT_LIMIT.certificate);
    if (!cname.ok) return err("certificates", cname.reason, i);
    const number = plain(row.number);
    if (number === null || looksLikeLinkOrMarkup(number)) return err("certificates", "refused", i);
    if (number.length > MAX.certNumber) return err("certificates", "too_long", i);
    const until = plain(row.validUntil);
    if (until === null || (until !== "" && !isRealDate(until))) return err("certificates", "invalid", i);
    certificates.push({ name: cname.text, number: number || null, validUntil: until || null });
  });
  if (certRows > L.certificates || (input.certificates ?? []).length > MAX_ROWS) err("certificates", "too_many");

  // outlets
  const outlets: ProductLineOutlet[] = [];
  const perMarket = new Map<string, number>();
  (input.outlets ?? []).slice(0, MAX_ROWS).forEach((row, i) => {
    if (!plain(row?.name) && !plain(row?.url)) return;
    const market = typeof row.market === "string" ? row.market.trim().toUpperCase() : "";
    if (!markets.includes(market)) return err("outlets", "outside_markets", i);
    const oname = plainText(row.name, MAX.outletName);
    if (!oname.ok) return err("outlets", oname.reason, i);
    const rawUrl = plain(row.url);
    const url = rawUrl ? httpUrl(rawUrl) : "";
    if (rawUrl === null || url === null) return err("outlets", "invalid", i);
    const n = (perMarket.get(market) ?? 0) + 1;
    perMarket.set(market, n);
    if (n > L.outletsPerMarket) return err("outlets", "too_many", i);
    outlets.push({ market, name: oname.text, url: url || null });
  });

  // replaces
  const replaces: string[] = [];
  const replRows = lines(input.replaces).slice(0, MAX_ROWS);
  replRows.forEach((raw, i) => {
    const c = slotText(raw, "name", MAX.name);
    if (!c.ok) return err("replaces", c.reason === "required" ? "refused" : c.reason, i);
    if (name.ok && c.text.toLowerCase() === name.text.toLowerCase()) return err("replaces", "invalid", i);
    replaces.push(c.text);
  });
  if (replRows.length > L.replaces) err("replaces", "too_many");

  // replacedBy
  let replacedBy: string | null = null;
  const rb = plain(input.replacedBy);
  if (rb === null || (rb && looksLikeLinkOrMarkup(rb))) err("replacedBy", "refused");
  else if (rb.length > MAX.replacedBy) err("replacedBy", "too_long");
  else replacedBy = rb || null;

  if (errors.length || !name.ok || !category.ok) return { ok: false, errors };
  return { ok: true, data: { name: name.text, category: category.text, useCases, markets, specs, certificates, outlets, replaces, replacedBy } };
}
