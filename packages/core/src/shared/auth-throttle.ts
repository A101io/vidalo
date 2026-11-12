/**
 * The sign-in link limit (feature 002, ADR-0004): 5 links per address and 20 per IP address per
 * rolling hour, counted in Postgres (auth_throttle, migration 0018) so it holds across Workers and
 * isolates. Only HMAC-SHA256 keys are stored, under VIDALO_AUTH_SECRET: no address or IP readable.
 * Web Crypto, so it runs on Workers and Node alike.
 */
export const LINK_LIMITS = { perAddress: 5, perIp: 20, windowMs: 3_600_000 } as const;

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** [addressKey, ipKey]: the address is normalised (trim, lower case) as Supabase receives it. */
export async function throttleKeys(email: string, ip: string, secret: string): Promise<[string, string]> {
  return [await hmacHex(secret, `addr:${email.trim().toLowerCase()}`), await hmacHex(secret, `ip:${ip}`)];
}

/** counts = [this address, this IP] in the window, this request included. */
export function overLimit(counts: [number, number] | number[]): boolean {
  return (counts[0] ?? 0) > LINK_LIMITS.perAddress || (counts[1] ?? 0) > LINK_LIMITS.perIp;
}

/**
 * The visitor's IP for the limit. On Cloudflare only cf-connecting-ip is trusted: x-forwarded-for
 * is set by the client there (SEC-31). Without either, one shared key, so nobody escapes the limit
 * by leaving the header out.
 */
export function throttleIp(headers: Pick<Headers, "get">, trustForwarded: boolean): string {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  if (trustForwarded) {
    const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
  }
  return "unknown";
}
