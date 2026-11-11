import { cache } from "react";
import { cookies } from "next/headers";
import { env } from "./env";
import { createServerSupabase } from "./supabase";
import { getActiveBusiness } from "./active-business";
import { ready } from "./core";
import { log, sessionVerdict, type SessionVerdict } from "@vidalo/core/shared";
import type { SignInEnd, SignInRow } from "@vidalo/core/db";

export const MOCK_SESSION_COOKIE = "vidalo_mock_session";

export interface Session {
  userId: string;
  email: string;
  /** Supabase JWT claim `session_id`; in mock auth the `sid` in the mock cookie. */
  sessionId: string;
  /** auth_session.signed_in_at of this browser's sign-in, ISO. Always from the row, never from a cookie or token. */
  signedInAt: string;
}

/** Who the browser claims to be, before the auth_session row has judged it. */
type Claimed = { userId: string; email: string; sessionId: string; signOut: () => Promise<void> };

/**
 * The signed-in user, or null (feature 002, ADR-0002). Supabase's claims are verified
 * (getClaims), then the browser's auth_session row decides: missing, ended, unused for
 * 30 days or older than 90 days all sign the browser out (the row is ended, the refresh
 * token is revoked at Supabase). Without Supabase in mock mode, a cookie set by /inloggen
 * names the user and its sign-in, and the same row rules apply. One lookup per request.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const claimed = await claim();
  if (!claimed) return null;
  const db = await ready();
  const row = await db.getSignIn(claimed.sessionId);
  const now = new Date();
  const verdict = row && row.userId !== claimed.userId ? "missing" : sessionVerdict(row, now);
  if (verdict !== "ok") {
    if (row && !row.endedAt && (verdict === "idle" || verdict === "max_age")) await db.endSignIns(claimed.userId, verdict, { sessionId: claimed.sessionId });
    await claimed.signOut().catch(() => {});
    // Reason only: no user, session or address.
    log.info("auth.session_ended", { reason: verdict });
    return null;
  }
  await db.touchSignIn(claimed.sessionId, now);
  return { userId: claimed.userId, email: claimed.email, sessionId: claimed.sessionId, signedInAt: row!.signedInAt };
});

async function claim(): Promise<Claimed | null> {
  const supabase = await createServerSupabase();
  if (supabase) {
    // Signature checked (or, for a symmetric key, confirmed with Supabase): never the cookie's decode alone.
    const { data, error } = await supabase.auth.getClaims();
    const c = data?.claims;
    if (error || !c || typeof c.sub !== "string" || typeof c.email !== "string" || !c.email || typeof c.session_id !== "string") return null;
    return { userId: c.sub, email: c.email, sessionId: c.session_id, signOut: async () => void (await supabase.auth.signOut({ scope: "local" })) };
  }
  if (!env.hasSupabase && env.allowMockAuth) {
    const store = await cookies();
    const mock = readMockCookie(store.get(MOCK_SESSION_COOKIE)?.value);
    if (!mock) return null;
    return {
      ...mock,
      signOut: async () => {
        try {
          store.delete(MOCK_SESSION_COOKIE);
        } catch {
          // A server component cannot change cookies; the row is what counts.
        }
      },
    };
  }
  return null;
}

/** The mock cookie's user and sign-in. Its signedInAt (if any) is never read: the row decides (SEC-24). */
export function readMockCookie(raw: string | undefined): { userId: string; email: string; sessionId: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { userId?: unknown; email?: unknown; sid?: unknown };
    if (typeof parsed.userId === "string" && typeof parsed.email === "string" && typeof parsed.sid === "string" && parsed.userId && parsed.email && parsed.sid) {
      return { userId: parsed.userId, email: parsed.email, sessionId: parsed.sid };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Why this browser's last sign-in ended, to choose a sentence on /inloggen, nothing else:
 * the session id is read from the cookie without verifying it, so it decides no access.
 */
export async function endedSignInReason(): Promise<SignInEnd | null> {
  let sessionId: string | undefined;
  const supabase = await createServerSupabase();
  if (supabase) {
    const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    const token = data.session?.access_token;
    if (token) {
      try {
        const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { session_id?: unknown };
        if (typeof payload.session_id === "string") sessionId = payload.session_id;
      } catch {
        /* not a JWT */
      }
    }
  } else if (env.allowMockAuth) {
    sessionId = readMockCookie((await cookies()).get(MOCK_SESSION_COOKIE)?.value)?.sessionId;
  }
  if (!sessionId) return null;
  const row: SignInRow | null = await (await ready()).getSignIn(sessionId);
  return row?.endedReason ?? null;
}

export type { SessionVerdict };

/** @deprecated Alias of getActiveBusiness (lib/active-business.ts), kept so the existing callers need no edit. */
export const getOwnedBusiness = getActiveBusiness;
