import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { ready } from "@/lib/db";
import { localizeHref } from "@/lib/lang-paths";
import { requestBehindGate } from "@/lib/gate-state";
import { startFreeCheck } from "@/lib/free-check-start";
import { confirmOnce, findPending, parseConfirmToken } from "@vidalo/core/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/scan/bevestigen (t=<link secret>): the button on /scan/bevestigen.
 * The address that got the link is now proven; the free check starts through the
 * same caps as before (lib/free-check-start.ts). A link works once: a second press
 * goes where the first one went.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const t = String(form.get("t") ?? "");
  const parsed = parseConfirmToken(t);
  const db = await ready();
  const business = parsed ? await db.getBusiness(parsed.businessId) : null;
  const found = parsed && business ? findPending(await db.listEvents(business.id, 500), parsed.hash) : null;
  const lang = found?.ok ? found.pending.lang : "nl";
  const to = (path: string) => `${env.baseUrl}${localizeHref(path, lang)}`;
  if (requestBehindGate(req)) return NextResponse.redirect(to("/binnenkort"), 303);
  if (!found || !business || !parsed) return NextResponse.redirect(to(`/scan/bevestigen?t=${encodeURIComponent(t)}`), 303);
  if (!found.ok) {
    if (found.reason === "used" && found.to) return NextResponse.redirect(to(found.to), 303);
    return NextResponse.redirect(to(`/scan/bevestigen?t=${encodeURIComponent(t)}`), 303);
  }
  // Claim the link, count the caps and record the start under one lock: parallel presses of
  // one link wait for each other, and every press after the first finds the link used (SEC-01).
  // A refusal for the daily cap ("/scan/druk") leaves the link working until it expires.
  const next = await confirmOnce(db, business.id, parsed.hash, (p) => startFreeCheck(req, business, { email: p.email, marketing: p.marketing }, p.lang, "confirm"), "/scan/druk");
  return NextResponse.redirect(to(next ?? `/scan/bevestigen?t=${encodeURIComponent(t)}`), 303);
}
