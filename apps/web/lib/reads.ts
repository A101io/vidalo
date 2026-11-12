/**
 * Dashboard reads. With Supabase configured these run as the signed-in user
 * through the anon client, so RLS (supabase/migrations/0001_init.sql) decides
 * what is visible. Without Supabase they fall back to the service db (mock).
 */
import type { Channel, Facts, Finding, ScanRun } from "@vidalo/core/types";
import { createServerSupabase } from "./supabase";
import { ready } from "./core";
import { lastConfirmed } from "@vidalo/core/facts-history";
import { OVERVIEW_LIMITS, dashboardRows } from "@vidalo/core/db";

export interface DashboardData {
  facts: Facts | null;
  findings: Finding[];
  channels: Channel[];
  scanRuns: ScanRun[];
}

type Row = Record<string, unknown>;

/**
 * The channel columns a member's JWT may read (migration 0016, F-017). Never meta: it holds the Google
 * refresh and access tokens. Anything that needs meta reads it with the service handle after requireOwner.
 */
const CHANNEL_COLUMNS = "id, business_id, type, name, external_id, url, status, last_synced_at";

function camel(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  return out;
}

export async function loadDashboard(businessId: string): Promise<DashboardData> {
  const supabase = await createServerSupabase();
  if (!supabase) {
    // Bounded in core (OVERVIEW_LIMITS): the newest 12 checks, findings capped per status group.
    return dashboardRows(await ready(), businessId);
  }
  // The same limits through RLS: open findings and resolved ones are capped apart, newest first (OVERVIEW_LIMITS.findingsPerStatus).
  const [factsRes, openRes, resolvedRes, channelsRes, runsRes] = await Promise.all([
    supabase.from("facts").select("*").eq("business_id", businessId).order("version", { ascending: false }).limit(1),
    supabase.from("finding").select("*").eq("business_id", businessId).neq("status", "resolved").order("first_seen_at", { ascending: false }).limit(OVERVIEW_LIMITS.findingsPerStatus),
    supabase.from("finding").select("*").eq("business_id", businessId).eq("status", "resolved").order("first_seen_at", { ascending: false }).limit(OVERVIEW_LIMITS.findingsPerStatus),
    supabase.from("channel").select(CHANNEL_COLUMNS).eq("business_id", businessId),
    supabase.from("scan_run").select("*").eq("business_id", businessId).order("created_at", { ascending: false }).limit(OVERVIEW_LIMITS.runs),
  ]);
  const findingsRes = { data: [...(openRes.data ?? []), ...(resolvedRes.data ?? [])] };
  const factsRow = (factsRes.data?.[0] ?? null) as Row | null;
  const facts = factsRow
    ? ({ ...(factsRow.data as Row), businessId, version: factsRow.version, provisional: factsRow.provisional, verifiedAt: factsRow.verified_at ?? null } as unknown as Facts)
    : null;
  return {
    facts,
    findings: ((findingsRes.data ?? []) as Row[]).map(camel) as unknown as Finding[],
    channels: ((channelsRes.data ?? []) as Row[]).map((r) => ({ ...camel(r), meta: {} })) as unknown as Channel[],
    scanRuns: ((runsRes.data ?? []) as Row[]).map(camel) as unknown as ScanRun[],
  };
}

function factsFromRow(row: Row, businessId: string): Facts {
  return { ...(row.data as Row), businessId, version: row.version, provisional: row.provisional, verifiedAt: row.verified_at ?? null, createdAt: row.created_at ?? undefined } as unknown as Facts;
}

/** Every facts version (oldest first) and the checks, for /app/gegevens/versies. */
export async function loadFactsHistory(businessId: string): Promise<{ versions: Facts[]; runs: ScanRun[] }> {
  const supabase = await createServerSupabase();
  if (!supabase) {
    const db = await ready();
    const [versions, runs] = await Promise.all([db.listFacts(businessId), db.listScanRuns(businessId, 500)]);
    return { versions, runs };
  }
  const [factsRes, runsRes] = await Promise.all([
    supabase.from("facts").select("*").eq("business_id", businessId).order("version", { ascending: true }),
    supabase.from("scan_run").select("*").eq("business_id", businessId).order("created_at", { ascending: false }).limit(500),
  ]);
  return {
    versions: ((factsRes.data ?? []) as Row[]).map((r) => factsFromRow(r, businessId)),
    // started_at is null until a worker picks the run up; the queue time stands in, as in PgDb.
    runs: ((runsRes.data ?? []) as Row[]).map(camel).map((r) => ({ ...r, startedAt: r.startedAt ?? r.createdAt })) as unknown as ScanRun[],
  };
}

/** The newest facts version the owner confirmed, or null (the yearly "Klopt dit nog?"). */
export async function loadLastConfirmedFacts(businessId: string): Promise<Facts | null> {
  const supabase = await createServerSupabase();
  if (!supabase) {
    const db = await ready();
    return lastConfirmed(await db.listFacts(businessId));
  }
  const res = await supabase.from("facts").select("*").eq("business_id", businessId).eq("provisional", false).not("verified_at", "is", null).order("version", { ascending: false }).limit(1);
  const row = (res.data?.[0] ?? null) as Row | null;
  return row ? factsFromRow(row, businessId) : null;
}
