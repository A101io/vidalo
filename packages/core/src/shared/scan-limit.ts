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

/**
 * What one visitor is counted as: an IPv4 address as it is, an IPv6 address by
 * its /64. One IPv6 connection holds a whole /64 (2^64 addresses), so counting
 * the full address would give a bot a new allowance on every request.
 */
export function ipBucket(ip: string): string {
  const raw = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0]!;
  if (!raw.includes(":")) return raw;
  // An IPv4 address written as IPv6 (::ffff:1.2.3.4) is that IPv4 address.
  const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1]!;
  const [head = "", tail = ""] = raw.split("::");
  const h = head ? head.split(":") : [];
  const t = raw.includes("::") ? (tail ? tail.split(":") : []) : [];
  const groups = raw.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return `${groups.slice(0, 4).map((g) => (g.replace(/^0+/, "") || "0")).join(":")}::/64`;
}

/** Event type that counts one free check for this address today. */
export function scanIpEvent(ip: string, now: Date = new Date()): string {
  return ipDayEvent("scan.ip", ip, now);
}

/** Event type that counts one confirmation mail triggered from this address today. */
export function confirmIpEvent(ip: string, now: Date = new Date()): string {
  return ipDayEvent("scan.confirm.ip", ip, now);
}

function ipDayEvent(prefix: string, ip: string, now: Date): string {
  const day = dayStart(now).toISOString().slice(0, 10);
  return `${prefix}.${createHash("sha256").update(`${day}|${ipBucket(ip)}`).digest("hex").slice(0, 24)}`;
}
