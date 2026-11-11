/**
 * How long a sign-in lives (feature 002, ADR-0002, Julian Q2): it ends after
 * 30 days without use or 90 days after signing in, or when it was signed out.
 * Pure: the clock is passed in. The row is `auth_session` (migration 0018),
 * written by the confirm action after Supabase accepted the link.
 */
import type { BrowserFamily, OsFamily, SignInRow } from "../db/types.js";

export const IDLE_DAYS = 30;
export const MAX_DAYS = 90;
/** Deleting everything and changing the address need a sign-in this recent. */
export const FRESH_MINUTES = 15;

export type SessionVerdict = "ok" | "missing" | "ended" | "idle" | "max_age";

const DAY = 86_400_000;

export function sessionVerdict(row: SignInRow | null, now: Date): SessionVerdict {
  if (!row) return "missing";
  if (row.endedAt) return "ended";
  const t = now.getTime();
  if (t - Date.parse(row.signedInAt) > MAX_DAYS * DAY) return "max_age";
  if (t - Date.parse(row.lastSeenAt) > IDLE_DAYS * DAY) return "idle";
  return "ok";
}

/** Signed in at most FRESH_MINUTES ago. `signedInAt` comes from the auth_session row, never from a cookie or a token. */
export function isFreshSignIn(s: { signedInAt: string }, now: Date): boolean {
  const at = Date.parse(s.signedInAt);
  return Number.isFinite(at) && now.getTime() - at <= FRESH_MINUTES * 60_000 && now.getTime() >= at - 60_000;
}

/** The browser and system family of a user agent; the string itself is never stored (Q9). */
export function uaFamily(userAgent: string | null): { browser: BrowserFamily; os: OsFamily } {
  const ua = userAgent ?? "";
  const browser: BrowserFamily = /Edg(e|A|iOS)?\//.test(ua)
    ? "edge"
    : /Firefox\/|FxiOS\//.test(ua)
      ? "firefox"
      : /Chrome\/|CriOS\/|Chromium\//.test(ua)
        ? "chrome"
        : /Safari\//.test(ua) && /Version\//.test(ua)
          ? "safari"
          : "other";
  const os: OsFamily = /iPhone|iPad|iPod/.test(ua)
    ? "ios"
    : /Android/.test(ua)
      ? "android"
      : /Windows/.test(ua)
        ? "windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macos"
          : /Linux|X11/.test(ua)
            ? "linux"
            : "other";
  return { browser, os };
}
