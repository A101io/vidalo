import { NextResponse } from "next/server";
import { REPORT_EMAIL_EVENT, REPORT_EMAIL_PER_IP, REPORT_EMAIL_WINDOW_MS, clientIp, makeLimiter, reportEmailCheck } from "@vidalo/core/shared";
import { COMING_SOON_ROUTE } from "@vidalo/core/shared/gate";
import { ready } from "@/lib/db";
import { env } from "@/lib/env";
import { isEmail } from "@/lib/format";
import { requestBehindGate } from "@/lib/gate-state";
import { langFromReferer } from "@/lib/request-lang";

export const runtime = "nodejs";

const limited = makeLimiter(REPORT_EMAIL_PER_IP, REPORT_EMAIL_WINDOW_MS);

/** POST email + scan + business → stores owner_email, enqueues the report e-mail job. */
export async function POST(req: Request) {
  // The middleware skips /api/, so the launch gate is checked here.
  if (requestBehindGate(req)) return NextResponse.redirect(`${env.baseUrl}${COMING_SOON_ROUTE}`, 303);
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const scanRunId = String(form.get("scan") ?? "");
  const businessId = String(form.get("business") ?? "");
  const back = `${env.baseUrl}/r/${encodeURIComponent(scanRunId)}`;
  if (!isEmail(email)) return NextResponse.redirect(`${back}?mail=fout#report-email`, 303);
  if (limited(clientIp(req))) {
    console.warn("report-email refused: rate limit");
    return NextResponse.redirect(`${back}?mail=fout#report-email`, 303);
  }
  const db = await ready();
  const business = await db.getBusiness(businessId);
  if (!business) return NextResponse.redirect(back, 303);
  const check = reportEmailCheck(await db.getScanRun(scanRunId), business.id, scanRunId, await db.listEvents(business.id));
  if (check === "mismatch") {
    console.warn("report-email refused: scan run does not belong to the business");
    return NextResponse.redirect(back, 303);
  }
  // Same answer as a first request, so a repeat cannot be told apart and sends nothing.
  if (check === "duplicate") return NextResponse.redirect(`${back}?mail=ok`, 303);
  // The first address on a business also sets the language its mails go out in: the language of the report page it was asked on.
  // Later the owner changes it on the account page; an address already on file keeps both.
  const first = business.ownerEmail ? {} : { ownerEmail: email, language: langFromReferer(req) };
  await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, ...first });
  await db.enqueueJob("email", { template: "baseline", scanRunId, businessId: business.id });
  await db.logEvent(business.id, REPORT_EMAIL_EVENT, { scanRunId, email });
  return NextResponse.redirect(`${back}?mail=ok`, 303);
}
