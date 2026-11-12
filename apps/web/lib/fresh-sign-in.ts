import { redirect } from "next/navigation";
import { getSession, type Session } from "./session";
import { getI18n } from "./i18n";
import { isFreshSignIn } from "@vidalo/core/shared";

/**
 * For the irreversible (deleting everything) and the address change (feature 002, AC-5c): the
 * browser must have signed in within the last 15 minutes. The time is the auth_session row's
 * signed_in_at, which a token refresh never moves. Otherwise to /inloggen?opnieuw=1, whose link
 * returns to `next` (a Dutch route; the sign-in page localises it).
 */
export async function requireFreshSignIn(next: string): Promise<Session> {
  const { href } = await getI18n();
  const session = await getSession();
  if (!session || !fresh(session.signedInAt)) redirect(href(`/inloggen?opnieuw=1&next=${encodeURIComponent(next)}`));
  return session;
}

/**
 * isFreshSignIn, except that a test server (never a production build) may shorten the window with
 * VIDALO_TEST_FRESH_SECONDS, so the browser tests can see a stale sign-in without waiting 15 minutes.
 */
function fresh(signedInAt: string): boolean {
  const seconds = process.env.NODE_ENV !== "production" ? Number(process.env.VIDALO_TEST_FRESH_SECONDS) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) return Date.now() - Date.parse(signedInAt) <= seconds * 1000;
  return isFreshSignIn({ signedInAt }, new Date());
}
