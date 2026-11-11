/**
 * The free check starts only after the requester confirms their e-mail address
 * (decided 11 Nov 2026). Why: every free check costs real AI calls, and a bot
 * that solves the human check could otherwise start checks in bulk, fill the
 * daily allowance before real visitors arrive, and have Vidalo mail reports to
 * addresses of people who never asked. A link in a mailbox is something a bot
 * farm does not have in bulk.
 *
 *  - POST /api/scan stores a pending request on the business (the address,
 *    the news box, the language and a hash of a random secret) and mails a
 *    link with the secret. The address never travels in a URL.
 *  - The link opens a page with one button; only that POST starts the check
 *    (a mail scanner that opens links must not start one).
 *  - A link works once and for SCAN_CONFIRM_TTL_MS.
 *  - A signed-in visitor proved the address with the sign-in link and skips this.
 *  - Confirmation mails are limited per address, per internet address and
 *    site-wide, so the mail itself cannot be used to fill someone's inbox.
 */
import { createHash, randomBytes } from "node:crypto";
import { dayStart } from "./scan-limit.js";
import type { Db } from "../db/types.js";

/**
 * Lock (Db.withLock) around every start of a free check and every confirmation mail:
 * claim the link, count the caps and record the start as one step, so parallel presses of
 * one link start one check and parallel posts cannot overrun a cap (security SEC-01, 11 Nov 2026).
 */
export const FREE_CHECK_LOCK = "vidalo.free-check";
export const SCAN_CONFIRM_EVENT = "scan.confirm_requested";
export const SCAN_CONFIRMED_EVENT = "scan.confirmed";
export const SCAN_CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;
/** Confirmation mails one address may receive per UTC day. */
export const CONFIRM_MAILS_PER_ADDRESS = 3;
/** Confirmation mails one internet address (IPv6 per /64) may trigger per UTC day. */
export const CONFIRM_MAILS_PER_IP = 5;
/** Site-wide: confirmation mails per rolling 24 h, as a multiple of the daily free-check cap. */
export const CONFIRM_MAILS_PER_CAP = 4;

export type ConfirmLang = "nl" | "en";
export interface PendingCheck {
  email: string;
  marketing: boolean;
  lang: ConfirmLang;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** A new link secret for this business: `<businessId>.<random>`; only its hash is stored. */
export function newConfirmToken(businessId: string): { token: string; hash: string } {
  const token = `${businessId}.${randomBytes(24).toString("base64url")}`;
  return { token, hash: sha(token) };
}

/** The business id and the stored hash for a token from a link; null when it cannot be one. */
export function parseConfirmToken(token: unknown): { businessId: string; hash: string } | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const [businessId, secret, extra] = token.split(".");
  if (!businessId || !secret || extra !== undefined || !/^[A-Za-z0-9_-]{32}$/.test(secret) || !/^[A-Za-z0-9_-]{1,80}$/.test(businessId)) return null;
  return { businessId, hash: sha(token) };
}

/** The payload of the pending event. */
export function pendingPayload(r: { email: string; marketing: boolean }, lang: ConfirmLang, hash: string): Record<string, unknown> {
  return { email: r.email, marketing: r.marketing, lang, hash };
}

export type PendingLookup = { ok: true; pending: PendingCheck; at: string } | { ok: false; reason: "unknown" | "expired" } | { ok: false; reason: "used"; to: string | null };

/** Finds the pending request this link belongs to among the business's events (latest first). */
export function findPending(events: { type: string; payload: Record<string, unknown>; at: string }[], hash: string, now = Date.now()): PendingLookup {
  const used = events.find((e) => e.type === SCAN_CONFIRMED_EVENT && e.payload.hash === hash);
  if (used) return { ok: false, reason: "used", to: typeof used.payload.to === "string" ? used.payload.to : null };
  const ev = events.find((e) => e.type === SCAN_CONFIRM_EVENT && e.payload.hash === hash);
  if (!ev || typeof ev.payload.email !== "string") return { ok: false, reason: "unknown" };
  if (now - new Date(ev.at).getTime() > SCAN_CONFIRM_TTL_MS) return { ok: false, reason: "expired" };
  return { ok: true, at: ev.at, pending: { email: ev.payload.email, marketing: ev.payload.marketing === true, lang: ev.payload.lang === "en" ? "en" : "nl" } };
}

/**
 * Uses a link once: under FREE_CHECK_LOCK it reads the business's events again, and only
 * when the link is still unused does it call `start` and record where that went. Parallel
 * presses wait for each other; every later press gets the first press's route. `start`
 * returning `refused` (the daily cap) leaves the link usable. Returns null for an unknown
 * or expired link.
 */
export async function confirmOnce(
  db: Pick<Db, "withLock" | "listEvents" | "logEvent">,
  businessId: string,
  hash: string,
  start: (p: PendingCheck) => Promise<string>,
  refused: string,
): Promise<string | null> {
  return db.withLock(FREE_CHECK_LOCK, async () => {
    const found = findPending(await db.listEvents(businessId, 500), hash);
    if (!found.ok) return found.reason === "used" ? found.to : null;
    const to = await start(found.pending);
    if (to !== refused) await db.logEvent(businessId, SCAN_CONFIRMED_EVENT, { hash, to });
    return to;
  });
}

/** Event type that counts one confirmation mail to this address today; holds a hash, never the address. */
export function confirmAddressEvent(email: string, now: Date = new Date()): string {
  const day = dayStart(now).toISOString().slice(0, 10);
  return `scan.confirm.mail.${sha(`${day}|${email.toLowerCase()}`).slice(0, 24)}`;
}
