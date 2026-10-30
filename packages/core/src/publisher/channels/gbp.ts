/**
 * Google Business Profile adapter.
 *
 * Real mode (GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET set, channel
 * has a refresh token in meta): refresh the access token, read the location via
 * the Business Information API, diff against the facts and PATCH
 * regularHours / phoneNumbers / websiteUri.
 *
 * Mock mode (no keys or VIDALO_MOCK=1): a deterministic "current" location is
 * synthesised, the diff is logged, nothing is called.
 */
import type { Channel, Facts, Hours } from "../../types.js";
import { log } from "../../shared/log.js";
import { diffFacts, type ChannelAdapter, type ChannelDiffEntry, type SyncResult } from "./types.js";

const GBP_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
const DAY_ENUM = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;

interface GbpTimeOfDay {
  hours?: number;
  minutes?: number;
}
interface GbpPeriod {
  openDay: string;
  openTime: GbpTimeOfDay;
  closeDay: string;
  closeTime: GbpTimeOfDay;
}
interface GbpLocation {
  name: string;
  title?: string;
  phoneNumbers?: { primaryPhone?: string };
  websiteUri?: string;
  regularHours?: { periods: GbpPeriod[] };
  storefrontAddress?: { addressLines?: string[]; postalCode?: string; locality?: string };
}

type ChannelWithMeta = Channel & { meta?: { refreshToken?: string; accessToken?: string; diffApproval?: DiffApproval } };

/**
 * The owner's decision on one set of changes (docs/ARCHITECTURE.md, Workflow
 * B: "approve diff"). A live Business Profile is never changed before the
 * owner has seen the diff; `key` ties the decision to exactly those changes,
 * so a later, different diff waits for a new decision.
 */
export interface DiffApproval {
  key: string;
  decision: "approved" | "declined";
  at: string;
}

/** Stable identity of a diff: the fields and both values, order-free. */
export function diffKey(diff: ChannelDiffEntry[]): string {
  return JSON.stringify(diff.map((d) => [d.field, d.current, d.expected]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

export type DiffDecision = "approved" | "declined" | "pending";

/** What the owner said about this diff: approved, declined, or nothing yet. */
export function diffDecision(meta: { diffApproval?: DiffApproval } | undefined, diff: ChannelDiffEntry[]): DiffDecision {
  const a = meta?.diffApproval;
  if (!a || a.key !== diffKey(diff)) return "pending";
  return a.decision;
}

/** Notes the sync writes when it holds a change for the owner (publisher/index.ts stores the diff as meta.pendingDiff on the first). */
export const NOTE_AWAITING_APPROVAL = "awaiting_owner_approval";
export const NOTE_DECLINED = "declined_by_owner";

function oauthConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret || process.env.VIDALO_MOCK === "1") return null;
  return { clientId, clientSecret };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const cfg = oauthConfig();
  if (!cfg) throw new Error("google oauth not configured");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`google token refresh failed: ${res.status}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

function pad(n: number | undefined): string {
  return String(n ?? 0).padStart(2, "0");
}

/** Convert a GBP location to the flat {field: value} shape used by diffFacts. */
export function gbpToCurrent(loc: GbpLocation): Record<string, string | null> {
  const cur: Record<string, string | null> = {
    phone: loc.phoneNumbers?.primaryPhone ?? null,
    website: loc.websiteUri ?? null,
    address: loc.storefrontAddress
      ? `${(loc.storefrontAddress.addressLines ?? []).join(" ")}, ${[loc.storefrontAddress.postalCode, loc.storefrontAddress.locality].filter(Boolean).join(" ")}`
      : null,
  };
  for (let d = 0; d < 7; d++) cur[`hours.${d}`] = "gesloten";
  for (const p of loc.regularHours?.periods ?? []) {
    const idx = DAY_ENUM.indexOf(p.openDay as (typeof DAY_ENUM)[number]);
    if (idx < 0) continue;
    cur[`hours.${idx}`] = `${pad(p.openTime.hours)}:${pad(p.openTime.minutes)}-${pad(p.closeTime.hours)}:${pad(p.closeTime.minutes)}`;
  }
  return cur;
}

export function factsToGbpPeriods(hours: Hours[]): GbpPeriod[] {
  const periods: GbpPeriod[] = [];
  for (const h of hours) {
    if (h.closed || !h.open || !h.close) continue;
    const [oh, om] = h.open.split(":").map(Number);
    const [ch, cm] = h.close.split(":").map(Number);
    periods.push({
      openDay: DAY_ENUM[h.day],
      openTime: { hours: oh ?? 0, minutes: om ?? 0 },
      closeDay: DAY_ENUM[h.day],
      closeTime: { hours: ch ?? 0, minutes: cm ?? 0 },
    });
  }
  return periods;
}

/** Build the PATCH body + updateMask from a diff. Only hours/phone/website are written. */
export function buildGbpPatch(diff: ChannelDiffEntry[], facts: Facts): { body: Partial<GbpLocation>; updateMask: string[] } {
  const body: Partial<GbpLocation> = {};
  const mask: string[] = [];
  if (diff.some((d) => d.field.startsWith("hours."))) {
    body.regularHours = { periods: factsToGbpPeriods(facts.hours) };
    mask.push("regularHours");
  }
  if (diff.some((d) => d.field === "phone") && facts.phone) {
    body.phoneNumbers = { primaryPhone: facts.phone };
    mask.push("phoneNumbers");
  }
  if (diff.some((d) => d.field === "website") && facts.website) {
    body.websiteUri = facts.website;
    mask.push("websiteUri");
  }
  return { body, updateMask: mask };
}

/** Deterministic mock location: phone and Saturday hours drift so a diff shows up. */
function mockLocation(channel: Channel, facts: Facts): GbpLocation {
  const periods = factsToGbpPeriods(facts.hours).filter((p) => p.openDay !== "SATURDAY");
  return {
    name: channel.externalId ?? "locations/mock-123",
    title: facts.name,
    phoneNumbers: { primaryPhone: facts.phone ? facts.phone.replace(/\d$/, (d) => String((Number(d) + 1) % 10)) : undefined },
    websiteUri: facts.website ?? undefined,
    regularHours: { periods },
    storefrontAddress: { addressLines: facts.address ? [facts.address] : [], postalCode: facts.postcode ?? undefined, locality: facts.place },
  };
}

async function readLocation(accessToken: string, locationName: string): Promise<GbpLocation> {
  const readMask = "name,title,phoneNumbers,websiteUri,regularHours,storefrontAddress";
  const res = await fetch(`${GBP_API}/${locationName}?readMask=${encodeURIComponent(readMask)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`gbp read failed: ${res.status}`);
  return (await res.json()) as GbpLocation;
}

async function patchLocation(accessToken: string, locationName: string, body: Partial<GbpLocation>, updateMask: string[]): Promise<unknown> {
  const res = await fetch(`${GBP_API}/${locationName}?updateMask=${encodeURIComponent(updateMask.join(","))}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`gbp patch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * A diff the owner has not approved is not applied: the sync reports
 * "mismatch" and carries the diff, so the dashboard can show it and ask.
 * Returns null when there is nothing to hold (no diff, or approved).
 */
function holdForOwner(base: { channelId: string; channelType: Channel["type"] }, meta: ChannelWithMeta["meta"], diff: ChannelDiffEntry[], evidence: Record<string, unknown>): SyncResult | null {
  if (!diff.length) return null;
  const decision = diffDecision(meta, diff);
  if (decision === "approved") return null;
  log.info("gbp.sync.held", { channelId: base.channelId, decision, fields: diff.map((d) => d.field) });
  return {
    ...base,
    status: "mismatch",
    diff,
    evidence: { ...evidence, held: decision, at: new Date().toISOString() },
    note: decision === "declined" ? NOTE_DECLINED : NOTE_AWAITING_APPROVAL,
  };
}

export const gbpAdapter: ChannelAdapter = {
  type: "gbp",
  async syncChannel(channel: Channel, facts: Facts): Promise<SyncResult> {
    const meta = (channel as ChannelWithMeta).meta ?? {};
    const cfg = oauthConfig();
    const base = { channelId: channel.id, channelType: channel.type as Channel["type"] };

    if (!cfg || !meta.refreshToken || !channel.externalId) {
      const loc = mockLocation(channel, facts);
      const diff = diffFacts(gbpToCurrent(loc), facts);
      const patch = buildGbpPatch(diff, facts);
      log.info("gbp.sync.mock", { channelId: channel.id, diff, updateMask: patch.updateMask, reason: cfg ? "no refresh token / location" : "no GOOGLE_OAUTH_* or mock" });
      if (cfg) {
        return { ...base, status: "pending", diff, evidence: { mode: "mock", diff, patch, at: new Date().toISOString() }, note: "Google-koppeling nog niet gemaakt door de eigenaar." };
      }
      const held = holdForOwner(base, meta, diff, { mode: "mock", diff, patch });
      if (held) return held;
      return {
        ...base,
        status: "synced",
        diff,
        evidence: { mode: "mock", diff, patch, applied: diff.length > 0, at: new Date().toISOString() },
        note: "mock",
      };
    }

    try {
      const token = await refreshAccessToken(meta.refreshToken);
      const loc = await readLocation(token, channel.externalId);
      const diff = diffFacts(gbpToCurrent(loc), facts);
      if (!diff.length) {
        return { ...base, status: "synced", diff, evidence: { mode: "live", before: loc, at: new Date().toISOString() } };
      }
      const patch = buildGbpPatch(diff, facts);
      const held = holdForOwner(base, meta, diff, { mode: "live", before: loc, patch });
      if (held) return held;
      const after = patch.updateMask.length ? await patchLocation(token, channel.externalId, patch.body, patch.updateMask) : null;
      log.info("gbp.sync.patched", { channelId: channel.id, updateMask: patch.updateMask });
      return {
        ...base,
        status: "synced",
        diff,
        evidence: { mode: "live", before: loc, patch, after, at: new Date().toISOString() },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("gbp.sync.failed", { channelId: channel.id, error: message });
      return {
        ...base,
        status: "failed",
        diff: [],
        evidence: { mode: "live", error: message, at: new Date().toISOString() },
        followUp: { kind: "operator_task", payload: { reason: "gbp_sync_failed", channelId: channel.id, error: message } },
      };
    }
  },
};
