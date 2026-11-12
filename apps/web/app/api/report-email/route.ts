import { NextResponse } from "next/server";
import { ready } from "@/lib/db";
import { env } from "@/lib/env";
import { isEmail } from "@/lib/format";
import { langFromReferer } from "@/lib/request-lang";
import { REPORT_EMAIL_EVENT } from "@vidalo/core/reporter";
import { makeLimiter } from "@vidalo/core/shared";

export const runtime = "nodejs";

/**
 * Limits (security review, 11 Nov 2026: since the form also sends a copy to another address it must not become a mail relay):
 * 5 posts per IP per 10 minutes, 100 mails per hour site-wide, at most 3 addresses per report.
 */
const perIp = makeLimiter(5, 10 * 60 * 1000);
const siteWide = makeLimiter(100, 60 * 60 * 1000);
export const REPORT_EMAIL_MAX_ADDRESSES = 3;

/** The form only ever posts from our own pages. */
function fromOwnSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // some browsers omit it on same-origin form posts
  try {
    const host = new URL(origin).host;
    return host === new URL(env.baseUrl).host || host === new URL(req.url).host;
  } catch {
    return false;
  }
}

/**
 * POST email + scan + business → enqueues the report e-mail to that address.
 * The address is kept on the event only, never as the business's owner: anyone
 * can post this form, so it proves nothing (review R-03). Ownership comes from
 * a payment or a confirmed sign-in.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const scanRunId = String(form.get("scan") ?? "");
  const businessId = String(form.get("business") ?? "");
  const back = `${env.baseUrl}/r/${encodeURIComponent(scanRunId)}`;
  if (!fromOwnSite(req)) return NextResponse.redirect(back, 303);
  if (!isEmail(email)) return NextResponse.redirect(`${back}?mail=fout#report-email`, 303);
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (perIp(ip)) return NextResponse.redirect(`${back}?mail=druk#report-email`, 303);
  const db = await ready();
  const business = await db.getBusiness(businessId);
  const run = business ? await db.getScanRun(scanRunId) : null;
  if (!business || run?.businessId !== business.id) return NextResponse.redirect(back, 303);
  // A business with an owner gets its mails there; this form must not become a way to fill that inbox.
  // Same "ok" either way, and once per (scan, address), so the answer says nothing about the business.
  const forThisScan = (await db.listEvents(business.id, 500)).filter((e) => e.type === REPORT_EMAIL_EVENT && e.payload.scanRunId === scanRunId);
  const asked = forThisScan.some((e) => e.payload.email === email);
  if (!business.ownerEmail && !asked) {
    if (forThisScan.length >= REPORT_EMAIL_MAX_ADDRESSES) return NextResponse.redirect(`${back}?mail=genoeg#report-email`, 303);
    if (siteWide("all")) return NextResponse.redirect(`${back}?mail=druk#report-email`, 303);
    const lang = langFromReferer(req);
    await db.logEvent(business.id, REPORT_EMAIL_EVENT, { scanRunId, email, lang });
    await db.enqueueJob("email", { template: "baseline", scanRunId, businessId: business.id, to: email, lang });
  }
  return NextResponse.redirect(`${back}?mail=ok`, 303);
}
