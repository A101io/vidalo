import { turnstileMode, turnstilePasses, signKiesToken, verifyKiesToken, TURNSTILE_FIELD, type TurnstileMode } from "@vidalo/core/shared";
import { env } from "./env";

/** Turnstile on the free check and the sign-in form (core/shared/turnstile.ts, baseline B4). */
export function turnstile(): { mode: TurnstileMode; siteKey?: string } {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim() || undefined;
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim() || undefined;
  return { mode: turnstileMode({ secret, siteKey, production: process.env.NODE_ENV === "production", mock: !env.realEngines }), siteKey };
}

/** Whether this form post passed the check. */
export function passesTurnstile(form: FormData, ip: string | null): Promise<boolean> {
  return turnstilePasses(turnstile().mode, form.get(TURNSTILE_FIELD), { secret: process.env.TURNSTILE_SECRET_KEY?.trim(), ip });
}

/** Token for the /scan/kies redirect after a passed check; null while the check is off (no token needed). */
export function kiesToken(q: string, place: string): string | null {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  return turnstile().mode === "on" && secret ? signKiesToken(secret, q, place) : null;
}

/** Whether /scan/kies may look this query up: check off, or a valid token from /api/scan. */
export function kiesAllowed(q: string, place: string, token: unknown): boolean {
  const mode = turnstile().mode;
  if (mode === "off") return true;
  return mode === "on" && verifyKiesToken(process.env.TURNSTILE_SECRET_KEY?.trim() ?? "", token, q, place);
}
