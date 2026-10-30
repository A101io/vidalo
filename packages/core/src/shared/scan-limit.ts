/**
 * The free check's limit per visitor. Every free check costs real engine calls,
 * so next to the site-wide daily cap (FREE_SCANS_PER_DAY) one address may start
 * only FREE_SCANS_PER_IP checks per calendar day (UTC).
 *
 * Counted through the event table, so it holds across Worker isolates; an
 * in-memory counter would not. The address itself is never stored: the event
 * type carries a hash of the address and the day, so a stored row cannot be
 * tied back to an address, nor to the same address on another day.
 */
import { createHash } from "node:crypto";

export const FREE_SCANS_PER_IP = 2;

/** The visitor's address as Cloudflare (or a proxy) reports it. */
export function clientIp(req: Pick<Request, "headers">): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

/** Start of the UTC day of `now`: the window the per-address count runs over. */
export function dayStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Event type that counts one free check for this address today. */
export function scanIpEvent(ip: string, now: Date = new Date()): string {
  const day = dayStart(now).toISOString().slice(0, 10);
  return `scan.ip.${createHash("sha256").update(`${day}|${ip}`).digest("hex").slice(0, 24)}`;
}
