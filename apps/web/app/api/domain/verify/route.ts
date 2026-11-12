import { NextResponse } from "next/server";
import { promises as dns } from "node:dns";
import { ready } from "@/lib/db";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { listMyBusinesses } from "@/lib/active-business";
import { markFactsHostVerified } from "@vidalo/core/db";
import { cnameTarget } from "@/lib/factsPage";
import { isVerifiedOwner } from "@vidalo/core/shared";
import { factsHostTaken, isOurName } from "@vidalo/core/publisher";

export const runtime = "nodejs";

/**
 * POST business, host → looks up the CNAME; when it points at FACTS_CNAME_TARGET, marks facts_host verified.
 * The business is the one the form was rendered for (hidden `business`, F-020), only if this login is a member of it and
 * has proven ownership; no business, a business of another login and an unknown id all go back to /app/domein with nothing done.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${env.baseUrl}/inloggen?next=/app/domein`, 303);
  const form = await req.formData();
  const named = String(form.get("business") ?? "");
  const business = (await listMyBusinesses(session)).find((b) => b.id === named) ?? null;
  if (!business) return NextResponse.redirect(`${env.baseUrl}/app`, 303);
  if (!isVerifiedOwner(business, session.userId)) return NextResponse.redirect(`${env.baseUrl}/app/google?eerst=1`, 303);
  const host = String(form.get("host") ?? "").trim().toLowerCase();
  if (!host) return NextResponse.redirect(`${env.baseUrl}/app/domein`, 303);
  // Names under vidalo.io are ours (no CNAME proves them), and a host another
  // business already verified stays theirs.
  const db = await ready();
  if (isOurName(host) || (await factsHostTaken(host, business.id))) {
    await db.logEvent(business.id, "domain.refused", { host });
    return NextResponse.redirect(`${env.baseUrl}/app/domein?dns=nee`, 303);
  }

  let ok = false;
  try {
    const records = await dns.resolveCname(host);
    ok = records.some((r) => r.replace(/\.$/, "").toLowerCase() === cnameTarget().toLowerCase());
  } catch {
    ok = false;
  }
  if (!ok && env.mock && form.get("simulate") === "1") ok = true;

  if (ok) {
    // One business at most holds a verified host (migration 0016): losing a race for it is "taken", not an error.
    if ((await markFactsHostVerified(db, business, host)) === "taken") {
      await db.logEvent(business.id, "domain.refused", { host });
      return NextResponse.redirect(`${env.baseUrl}/app/domein?dns=nee`, 303);
    }
    await db.upsertChannel({ businessId: business.id, type: "facts_page", name: "Feitenpagina", url: `https://${host}`, externalId: null, status: "pending" });
    await db.enqueueJob("publish", { businessId: business.id });
    await db.logEvent(business.id, "domain.verified", { host });
  } else {
    await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, factsHost: host });
    await db.logEvent(business.id, "domain.check_failed", { host });
  }
  return NextResponse.redirect(`${env.baseUrl}/app/domein?dns=${ok ? "ok" : "nee"}`, 303);
}
