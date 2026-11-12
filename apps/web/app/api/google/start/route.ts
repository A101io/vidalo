import { NextResponse } from "next/server";
import { NO_STORE } from "@/lib/auth-cookies";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { ready } from "@/lib/db";
import { getSession, getOwnedBusiness } from "@/lib/session";
import { GOOGLE_STATE_COOKIE } from "@/lib/google";
import { listMyBusinesses } from "@/lib/active-business";
import { isBusinessId } from "@vidalo/core/shared";

const SCOPES = ["https://www.googleapis.com/auth/business.manage"];


/**
 * Starts Google OAuth for the Business Profile. This is also how ownership is
 * proven: the callback checks that the account holds a location for the
 * business. `?business=<id>` lets someone who is not (yet) the recorded owner
 * claim a business from its report; otherwise the session's own business.
 */
async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const session = await getSession();
  const claimed = url.searchParams.get("business");
  // Signed out: back to a page after login, never to this route (a server
  // action's redirect cannot follow into a route handler).
  if (!session) return NextResponse.redirect(`${env.baseUrl}${claimed ? `/eigenaar/bevestigen?business=${encodeURIComponent(claimed)}` : "/inloggen?next=/app/google"}`);

  const db = await ready();
  // A business this login is a member of; otherwise the claim path for a business named in the
  // link (Google's proof in the callback decides). Only an id, never a slug (F-020).
  const mine = claimed ? (await listMyBusinesses(session)).find((b) => b.id === claimed) : undefined;
  const business = claimed ? (mine ?? (isBusinessId(claimed) ? await db.getBusiness(claimed) : null)) : await getOwnedBusiness(session);
  if (!business) return NextResponse.redirect(`${env.baseUrl}/inloggen?fout=geen`);

  const state = randomBytes(16).toString("hex");
  (await cookies()).set(GOOGLE_STATE_COOKIE, JSON.stringify({ state, businessId: business.id }), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: env.baseUrl.startsWith("https://") });
  const redirectUri = `${env.baseUrl}/api/google/callback`;
  if (!env.hasGoogle) return NextResponse.redirect(`${redirectUri}?mock=1&state=${state}`);

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", env.googleClientId!);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", SCOPES.join(" "));
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");
  auth.searchParams.set("state", state);
  return NextResponse.redirect(auth.toString());
}

/** It reads the session: no answer of it may be stored by a cache (V-SEC-03). */
export async function GET(req: Request) {
  const res = await handle(req);
  res.headers.set("cache-control", NO_STORE);
  return res;
}
