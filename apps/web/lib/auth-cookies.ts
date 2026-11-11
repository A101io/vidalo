/**
 * Options for every auth cookie the app writes (Supabase's sb-… cookies, the mock
 * session, vidalo_business). Edge-safe: the middleware imports this, so no core
 * import and no Node API here. Feature 002, ADR-0002.
 *
 * No browser Supabase client exists, so HttpOnly costs nothing. Secure only on
 * https: a browser never sends a Secure cookie back to http://localhost.
 */
export const AUTH_COOKIE_MAX_AGE = 90 * 86400;

export function authCookieOptions(baseUrl = process.env.PUBLIC_BASE_URL ?? ""): { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/"; maxAge: number } {
  return { httpOnly: true, secure: baseUrl.startsWith("https:"), sameSite: "lax", path: "/", maxAge: AUTH_COOKIE_MAX_AGE };
}

/**
 * The options a Supabase cookie is written with: ours forced over the library's,
 * except that a removal (maxAge 0) stays a removal.
 */
export function forceAuthOptions(options: Record<string, unknown> | undefined, baseUrl?: string): ReturnType<typeof authCookieOptions> {
  const forced = authCookieOptions(baseUrl);
  return options?.maxAge === 0 ? { ...forced, maxAge: 0 } : forced;
}

/** A response that sets a session cookie is never stored by any cache (F-018). */
export const NO_STORE = "private, no-store";

/** True for a Supabase auth cookie name (sb-<ref>-auth-token, its chunks and the code verifier). */
export function isAuthCookieName(name: string): boolean {
  return name.startsWith("sb-");
}
