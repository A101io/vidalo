import { turnstileMode, turnstilePasses, TURNSTILE_FIELD, type TurnstileMode } from "@vidalo/core/shared";
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
