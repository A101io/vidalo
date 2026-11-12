import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { ready } from "@/lib/db";
import { getSession } from "@/lib/session";
import { listMyBusinesses } from "@/lib/active-business";
import { safeNext } from "@vidalo/core/shared";
import { LANGS, localizeHref, type Lang } from "@/lib/lang-paths";

/**
 * The NL · EN switch for a signed-in owner: saves the language on the business named by `?business=` (only one this
 * login is a member of, F-020) and continues to the same page in that language. Not signed in, no business or not a
 * member: just the redirect, so the link works for everyone and writes nothing.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const to = url.searchParams.get("to") as Lang | null;
  const route = safeNext(url.searchParams.get("next"), "/");
  if (!to || !LANGS.includes(to)) return NextResponse.redirect(`${env.baseUrl}${route}`, 303);
  const session = await getSession();
  const named = url.searchParams.get("business") ?? "";
  const business = session && named ? ((await listMyBusinesses(session)).find((b) => b.id === named) ?? null) : null;
  if (business && business.language !== to) {
    const db = await ready();
    await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, language: to });
    await db.logEvent(business.id, "account.language_set", { language: to });
  }
  return NextResponse.redirect(`${env.baseUrl}${localizeHref(route, to)}`, 303);
}
