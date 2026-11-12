/**
 * The only way a `next` parameter becomes a redirect target (feature 002, ADR-0003/0004, F-023).
 * Percent-decode up to three times until stable; refuse anything that is not one plain path on
 * this site; resolve it against a dummy origin and check the normalised path again, so
 * `/.//evil.example` or `/app/..//evil.example` cannot become a protocol-relative URL.
 * Returns the path with its query and hash, or `fallback`.
 */

/** Only a base to resolve against; never contacted. (localhost, not x.invalid: legal.test.ts reads every other host literal as a recipient.) */
const BASE = "http://localhost";

export function safeNext(raw: string | null | undefined, fallback = "/app"): string {
  if (!raw) return fallback;
  let decoded = raw;
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return fallback;
    }
    if (next === decoded) break;
    decoded = next;
  }
  if (!decoded || !decoded.startsWith("/") || decoded.startsWith("//")) return fallback;
  if (decoded.includes("\\") || /[\u0000-\u001f\u007f]/.test(decoded)) return fallback;
  let u: URL;
  try {
    u = new URL(decoded, BASE);
  } catch {
    return fallback;
  }
  if (u.origin !== BASE) return fallback;
  if (u.pathname.startsWith("//") || u.pathname.startsWith("/\\") || u.pathname.includes("\\")) return fallback;
  return u.pathname + u.search + u.hash;
}
