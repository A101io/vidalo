/**
 * Facts history and the yearly "Klopt dit nog?". Pure: versions and scan runs
 * in, a list to render out. The web app words every change from copy; nothing
 * here is customer-facing text.
 *
 * - diffFacts: what changed between two versions, field by field.
 * - buildFactsHistory: every version, newest first, with its changes against
 *   the version before and the checks that ran while it was current.
 * - reconfirmation: whether the owner is due to say the facts are still right
 *   (one year after the last confirmed version, then every year after that).
 */
import type { Facts, Hours, PriceItem, ScanRun } from "./types.js";

/** Single-value fields, compared as strings. Raw values (openStatus code, sector slug, "yes"/"no"); the page words them. */
export const VALUE_FIELDS = ["name", "place", "address", "postcode", "phone", "email", "website", "openStatus", "sector", "serviceAreaRadiusKm", "urgencyAvailable", "urgencyHours"] as const;
export type ValueField = (typeof VALUE_FIELDS)[number];

/** List fields, compared as sets (order does not count). */
export const LIST_FIELDS = ["servicesYes", "servicesNo", "policies", "paymentMethods", "notConfusedWith", "serviceAreaPlaces", "credentials"] as const;
export type ListField = (typeof LIST_FIELDS)[number];

export type FactChange =
  | { kind: "value"; field: ValueField; before: string | null; after: string | null }
  | { kind: "list"; field: ListField; added: string[]; removed: string[] }
  | { kind: "prices"; added: PriceItem[]; removed: PriceItem[] }
  | { kind: "hours"; days: { day: Hours["day"]; before: Hours | null; after: Hours | null }[] };

type FactsData = Omit<Facts, "businessId" | "version" | "provisional" | "verifiedAt" | "createdAt">;

const blank = (v: string | null | undefined): string | null => (v == null || v.trim() === "" ? null : v.trim());

function value(f: FactsData, field: ValueField): string | null {
  switch (field) {
    case "sector":
      return blank(f.sector ?? null);
    case "serviceAreaRadiusKm":
      return f.serviceArea?.radiusKm != null ? String(f.serviceArea.radiusKm) : null;
    case "urgencyAvailable":
      return f.urgency ? (f.urgency.available ? "yes" : "no") : null;
    case "urgencyHours":
      return blank(f.urgency?.hoursNl ?? null);
    default:
      return blank(f[field]);
  }
}

function list(f: FactsData, field: ListField): string[] {
  const raw = field === "serviceAreaPlaces" ? (f.serviceArea?.places ?? []) : field === "credentials" ? (f.credentials ?? []) : f[field];
  return [...new Set(raw.map((s) => s.trim()).filter(Boolean))];
}

const priceKey = (p: PriceItem) => `${p.label.trim()}\u0000${p.amount}\u0000${(p.unit ?? "").trim()}`;

function sameHours(a: Hours | null, b: Hours | null): boolean {
  if (!a || !b) return a === b;
  if (a.closed || b.closed) return a.closed === b.closed;
  return blank(a.open) === blank(b.open) && blank(a.close) === blank(b.close);
}

/** What changed from `prev` to `next`, in field order. Empty when nothing did. */
export function diffFacts(prev: FactsData, next: FactsData): FactChange[] {
  const out: FactChange[] = [];
  for (const field of VALUE_FIELDS.slice(0, 8)) {
    const before = value(prev, field);
    const after = value(next, field);
    if (before !== after) out.push({ kind: "value", field, before, after });
  }
  const days: { day: Hours["day"]; before: Hours | null; after: Hours | null }[] = [];
  for (const day of [0, 1, 2, 3, 4, 5, 6] as const) {
    const before = prev.hours.find((h) => h.day === day) ?? null;
    const after = next.hours.find((h) => h.day === day) ?? null;
    if (!sameHours(before, after)) days.push({ day, before, after });
  }
  if (days.length) out.push({ kind: "hours", days });
  for (const field of LIST_FIELDS) {
    const a = list(prev, field);
    const b = list(next, field);
    const added = b.filter((x) => !a.includes(x));
    const removed = a.filter((x) => !b.includes(x));
    if (added.length || removed.length) out.push({ kind: "list", field, added, removed });
  }
  const pa = new Map(prev.prices.map((p) => [priceKey(p), p]));
  const pb = new Map(next.prices.map((p) => [priceKey(p), p]));
  const addedPrices = [...pb].filter(([k]) => !pa.has(k)).map(([, p]) => p);
  const removedPrices = [...pa].filter(([k]) => !pb.has(k)).map(([, p]) => p);
  if (addedPrices.length || removedPrices.length) out.push({ kind: "prices", added: addedPrices, removed: removedPrices });
  for (const field of VALUE_FIELDS.slice(8)) {
    const before = value(prev, field);
    const after = value(next, field);
    if (before !== after) out.push({ kind: "value", field, before, after });
  }
  return out;
}

export interface FactsVersionEntry {
  version: number;
  provisional: boolean;
  /** When the owner confirmed it; null for a provisional version. */
  confirmedAt: string | null;
  /** When it was stored (falls back to confirmedAt for rows read without a created date). */
  since: string | null;
  /** Changes against the version before; null for the first version. */
  changes: FactChange[] | null;
  /** Checks that started while this version was the current one, newest first. */
  runs: ScanRun[];
}

/** When a version became current. */
const sinceOf = (f: Facts): string | null => f.createdAt ?? f.verifiedAt ?? null;

/**
 * Every version, newest first. A check belongs to the newest version that was
 * stored before the check started; a check older than every version (or one
 * of a version without a date) is left out.
 */
export function buildFactsHistory(versions: Facts[], runs: ScanRun[]): FactsVersionEntry[] {
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  const entries: FactsVersionEntry[] = sorted.map((f, i) => ({
    version: f.version,
    provisional: f.provisional,
    confirmedAt: f.provisional ? null : f.verifiedAt,
    since: sinceOf(f),
    changes: i === 0 ? null : diffFacts(sorted[i - 1]!, f),
    runs: [],
  }));
  for (const run of [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
    const t = new Date(run.startedAt).getTime();
    for (let i = entries.length - 1; i >= 0; i--) {
      const since = entries[i]!.since;
      if (since && new Date(since).getTime() <= t) {
        entries[i]!.runs.push(run);
        break;
      }
    }
  }
  return entries.reverse();
}

/** The newest version the owner confirmed, or null. */
export function lastConfirmed(versions: Facts[]): Facts | null {
  let best: Facts | null = null;
  for (const f of versions) if (!f.provisional && f.verifiedAt && (!best || f.version > best.version)) best = f;
  return best;
}

/** The moment `years` calendar years after `iso` (29 Feb → 1 Mar in a non-leap year). */
export function addYears(iso: string, years: number): Date {
  const d = new Date(iso);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

export interface Reconfirmation {
  /** The confirmed version the question is about. */
  version: number;
  confirmedAt: string;
  /** One year after confirmedAt. */
  dueAt: string;
  due: boolean;
  /**
   * Whole years since confirmedAt (1 in the first year it is due, 2 a year
   * later when nobody answered). With `version` the key that keeps the mail
   * to once a year.
   */
  cycle: number;
}

/**
 * The yearly question for the last confirmed facts. Due from one year after
 * the confirmation until the owner confirms again (which makes a new version
 * and starts a new year). null when nothing was ever confirmed: then the
 * setup steps ask for it, not this.
 */
export function reconfirmation(confirmed: Pick<Facts, "version" | "verifiedAt" | "provisional"> | null, now: Date = new Date()): Reconfirmation | null {
  if (!confirmed || confirmed.provisional || !confirmed.verifiedAt) return null;
  let cycle = 0;
  while (addYears(confirmed.verifiedAt, cycle + 1).getTime() <= now.getTime()) cycle++;
  return { version: confirmed.version, confirmedAt: confirmed.verifiedAt, dueAt: addYears(confirmed.verifiedAt, 1).toISOString(), due: cycle >= 1, cycle };
}

/** Event logged when the yearly mail is queued; payload { version, cycle }. */
export const RECONFIRM_EVENT = "facts.reconfirm_requested";

/**
 * The mail goes out in the first days of a due year only. The cron looks for
 * the event among the newest events of the business; inside this window that
 * list always still holds it, so a busy year cannot push it out of sight and
 * cause a second mail. A worker that is down longer than this skips the mail
 * for that year; the banner in the app still asks.
 */
export const RECONFIRM_MAIL_WINDOW_DAYS = 30;

export function inReconfirmMailWindow(r: Pick<Reconfirmation, "confirmedAt" | "cycle" | "due">, now: Date = new Date()): boolean {
  if (!r.due) return false;
  const start = addYears(r.confirmedAt, r.cycle).getTime();
  return now.getTime() - start < RECONFIRM_MAIL_WINDOW_DAYS * 86_400_000;
}

/** True when the mail for this version and year was already queued. */
export function reconfirmAlreadyAsked(events: { type: string; payload: Record<string, unknown> }[], r: Pick<Reconfirmation, "version" | "cycle">): boolean {
  return events.some((e) => e.type === RECONFIRM_EVENT && e.payload.version === r.version && e.payload.cycle === r.cycle);
}
