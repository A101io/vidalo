import { NextResponse } from "next/server";
import { NO_STORE } from "@/lib/auth-cookies";
import { cookies } from "next/headers";
import { matchProfileLocation, type ProfileLocation } from "@vidalo/core/shared";
import { env } from "@/lib/env";
import { ready } from "@/lib/db";
import { getSession } from "@/lib/session";
import { GOOGLE_STATE_COOKIE } from "@/lib/google";

/** Every Business Profile location the signed-in Google account manages, with its place id. */
async function listLocations(accessToken: string): Promise<ProfileLocation[]> {
  const out: ProfileLocation[] = [];
  const acc = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", { headers: { authorization: `Bearer ${accessToken}` } });
  if (!acc.ok) throw new Error(`accounts ${acc.status}`);
  const accounts = ((await acc.json()) as { accounts?: { name: string }[] }).accounts ?? [];
  for (const a of accounts) {
    let pageToken: string | undefined;
    do {
      const u = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations`);
      u.searchParams.set("readMask", "name,title,metadata");
      u.searchParams.set("pageSize", "100");
      if (pageToken) u.searchParams.set("pageToken", pageToken);
      const res = await fetch(u, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!res.ok) break;
      const body = (await res.json()) as { locations?: { name: string; title?: string; metadata?: { placeId?: string } }[]; nextPageToken?: string };
      for (const l of body.locations ?? []) out.push({ name: l.name, title: l.title ?? null, placeId: l.metadata?.placeId ?? null });
      pageToken = body.nextPageToken;
    } while (pageToken);
  }
  return out;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

/**
 * OAuth callback. Proves ownership before anything else: the account must hold
 * a Business Profile location whose place id is this business's. Only then do
 * we record this person as the owner (replacing any unproven claim), store the
 * tokens and start setup for a paying business. A failed match stores nothing.
 */
async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const session = await getSession();
  const jar = await cookies();
  const raw = jar.get(GOOGLE_STATE_COOKIE)?.value;
  jar.delete(GOOGLE_STATE_COOKIE);
  let expected: { state?: string; businessId?: string } = {};
  try {
    expected = raw ? (JSON.parse(raw) as typeof expected) : {};
  } catch {
    /* treated as missing */
  }
  const fail = (reason: string, businessId?: string) =>
    NextResponse.redirect(`${env.baseUrl}/eigenaar?fout=${reason}${businessId ? `&business=${encodeURIComponent(businessId)}` : ""}`);

  if (!session) return NextResponse.redirect(`${env.baseUrl}/inloggen`);
  const state = url.searchParams.get("state");
  if (!expected.state || !expected.businessId || state !== expected.state) return fail("error");

  const db = await ready();
  const business = await db.getBusiness(expected.businessId);
  if (!business) return fail("error");

  let tokens: TokenResponse;
  let locations: ProfileLocation[];
  if (!env.hasGoogle) {
    // Mock: the account manages exactly this business.
    tokens = { access_token: "mock-access", refresh_token: "mock-refresh", expires_in: 3600, scope: "business.manage" };
    locations = [{ name: "locations/mock-1", title: business.name, placeId: business.googlePlaceId }];
  } else {
    const code = url.searchParams.get("code");
    if (!code) return fail("error", business.id);
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: env.googleClientId!, client_secret: env.googleClientSecret!, redirect_uri: `${env.baseUrl}/api/google/callback`, grant_type: "authorization_code" }),
    });
    if (!res.ok) return fail("error", business.id);
    tokens = (await res.json()) as TokenResponse;
    try {
      locations = await listLocations(tokens.access_token);
    } catch {
      return fail("error", business.id);
    }
  }

  const check = matchProfileLocation(business, locations);
  if (!check.ok) {
    await db.logEvent(business.id, "owner.verify_failed", { reason: check.reason, userId: session.userId, email: session.email, locations: locations.length });
    return fail(check.reason, business.id);
  }

  const previous = { ownerEmail: business.ownerEmail, ownerUserId: business.ownerUserId };
  await db.upsertBusiness({
    id: business.id,
    slug: business.slug,
    name: business.name,
    place: business.place,
    ownerUserId: session.userId,
    ownerEmail: session.email,
    ownerVerifiedAt: new Date().toISOString(),
    ownerVerifiedVia: "google_business_profile",
  });
  await db.logEvent(business.id, "owner.verified", { via: "google_business_profile", location: check.location.name, userId: session.userId, email: session.email, previous });

  const channel = await db.upsertChannel({
    businessId: business.id,
    type: "gbp",
    name: "Google Bedrijfsprofiel",
    externalId: check.location.name,
    url: null,
    status: "pending",
    lastSyncedAt: null,
    meta: { refreshToken: tokens.refresh_token ?? null, accessToken: tokens.access_token, expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(), scope: tokens.scope, mock: !env.hasGoogle },
  });
  await db.logEvent(business.id, "google.connected", { mock: !env.hasGoogle });

  // A paying business waited for this: setup and sync were skipped until now.
  if (business.status === "trial" || business.status === "active") {
    await db.enqueueJob("setup", { businessId: business.id });
    await db.enqueueJob("sync", { businessId: business.id, channelIds: [channel.id] });
  }
  return NextResponse.redirect(`${env.baseUrl}/app/google?gekoppeld=1`);
}

/** It reads the session: no answer of it may be stored by a cache (V-SEC-03). */
export async function GET(req: Request) {
  const res = await handle(req);
  res.headers.set("cache-control", NO_STORE);
  return res;
}
