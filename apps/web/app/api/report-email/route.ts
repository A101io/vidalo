import { NextResponse } from "next/server";
import { ready } from "@/lib/db";
import { env } from "@/lib/env";
import { isEmail } from "@/lib/format";
import { langFromReferer } from "@/lib/request-lang";

export const runtime = "nodejs";

/** POST email + scan + business → stores owner_email, enqueues the report e-mail job. */
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
  // The first address on a business also sets the language its mails go out in: the language of the report page it was asked on.
  // Later the owner changes it on the account page; an address already on file keeps both.
  const first = business.ownerEmail ? {} : { ownerEmail: email, language: langFromReferer(req) };
  await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, ...first });
  await db.enqueueJob("email", { template: "baseline", scanRunId, businessId: business.id });
  await db.logEvent(business.id, "report_email.requested", { scanRunId, email });
  return NextResponse.redirect(`${back}?mail=ok`, 303);
}
