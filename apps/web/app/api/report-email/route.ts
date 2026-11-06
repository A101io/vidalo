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
  if (!business) return NextResponse.redirect(back, 303);
  // Logged before the job, which reads the address and the report page's language from this event.
  await db.logEvent(business.id, REPORT_EMAIL_EVENT, { scanRunId, email, lang: langFromReferer(req) });
  await db.enqueueJob("email", { template: "baseline", scanRunId, businessId: business.id });
  return NextResponse.redirect(`${back}?mail=ok`, 303);
}
