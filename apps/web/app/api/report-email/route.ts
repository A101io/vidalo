import { NextResponse } from "next/server";
import { ready } from "@/lib/db";
import { env } from "@/lib/env";
import { isEmail } from "@/lib/format";
import { langFromReferer } from "@/lib/request-lang";
import { REPORT_EMAIL_EVENT } from "@vidalo/core/reporter";

export const runtime = "nodejs";

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
  if (!isEmail(email)) return NextResponse.redirect(`${back}?mail=fout#report-email`, 303);
  const db = await ready();
  const business = await db.getBusiness(businessId);
  const run = business ? await db.getScanRun(scanRunId) : null;
  if (!business || run?.businessId !== business.id) return NextResponse.redirect(back, 303);
  // A business with an owner gets its mails there; this form must not become a way to fill that inbox.
  // Same "ok" either way, and once per (scan, address), so the answer says nothing about the business.
  const asked = (await db.listEvents(business.id, 500)).some((e) => e.type === REPORT_EMAIL_EVENT && e.payload.scanRunId === scanRunId && e.payload.email === email);
  if (!business.ownerEmail && !asked) {
    const lang = langFromReferer(req);
    await db.logEvent(business.id, REPORT_EMAIL_EVENT, { scanRunId, email, lang });
    await db.enqueueJob("email", { template: "baseline", scanRunId, businessId: business.id, to: email, lang });
  }
  return NextResponse.redirect(`${back}?mail=ok`, 303);
}
