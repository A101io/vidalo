/**
 * Cloudflare Turnstile on the two forms that spend money or send mail: the
 * free check (/api/scan: Places lookup and engine calls) and the sign-in
 * link (/inloggen: a real e-mail). Baseline B4.
 *
 * Off only where nothing real happens: no secret and a mock or dev build.
 * A production build with real engines and no secret is "misconfigured" and
 * refuses every post (fail closed; a missing secret must never mean no check).
 *
 * Cloudflare's published test keys (always pass / always fail) are below, for
 * local runs and tests: https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */
export const TURNSTILE_TEST_KEYS = {
  sitePass: "1x00000000000000000000AA",
  secretPass: "1x0000000000000000000000000000000AA",
  secretFail: "2x0000000000000000000000000000000AA",
} as const;

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** The hidden field the widget adds to its form. */
export const TURNSTILE_FIELD = "cf-turnstile-response";

export type TurnstileMode = "off" | "on" | "misconfigured";

export function turnstileMode(o: { secret?: string; siteKey?: string; production: boolean; mock: boolean }): TurnstileMode {
  if (o.secret && o.siteKey) return "on";
  if (!o.production || o.mock) return "off";
  return "misconfigured";
}

/** Asks Cloudflare whether the token is good. Any failure (no token, network, bad answer) is a no. */
export async function verifyTurnstile(token: unknown, o: { secret: string; ip?: string | null; fetchFn?: typeof fetch }): Promise<boolean> {
  const t = typeof token === "string" ? token.trim() : "";
  if (!t || t.length > 2048) return false;
  const body = new URLSearchParams({ secret: o.secret, response: t });
  if (o.ip) body.set("remoteip", o.ip);
  try {
    const res = await (o.fetchFn ?? fetch)(TURNSTILE_VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: unknown };
    return data.success === true;
  } catch {
    return false;
  }
}

/** The whole decision for one post: passes when off, or when on and Cloudflare says yes. */
export async function turnstilePasses(mode: TurnstileMode, token: unknown, o: { secret?: string; ip?: string | null; fetchFn?: typeof fetch }): Promise<boolean> {
  if (mode === "off") return true;
  if (mode === "misconfigured" || !o.secret) return false;
  return verifyTurnstile(token, { secret: o.secret, ip: o.ip, fetchFn: o.fetchFn });
}
