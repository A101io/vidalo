import { readCheckCookie, signCheckCookie } from "@vidalo/core/shared";

/** The free check's address on its way to /scan/kies (core/shared/free-check.ts). In the cookie table. */
export const CHECK_COOKIE = "vidalo_check";
export const CHECK_COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 15 * 60 };

/** Signed with the Turnstile secret, like the pick token; a fixed key where the check is off (local, mock). */
function secret(): string {
  return process.env.TURNSTILE_SECRET_KEY?.trim() || "vidalo-local";
}

export function checkCookieValue(r: { email: string; marketing: boolean }): string {
  return signCheckCookie(secret(), r);
}

export function checkFromCookie(req: Request): { email: string; marketing: boolean } | null {
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${CHECK_COOKIE}=([^;]*)`));
  return m ? readCheckCookie(secret(), decodeURIComponent(m[1]!)) : null;
}
