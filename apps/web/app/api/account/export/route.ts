import { NextResponse } from "next/server";
import { exportMyData } from "@vidalo/core/shared";
import { ready } from "@/lib/db";
import { getOwnedBusiness, getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/account/export: everything Vidalo keeps about the signed-in owner's business, as a JSON download (core/shared/my-data.ts). */
export async function GET() {
  const session = await getSession();
  const business = session ? await getOwnedBusiness(session) : null;
  if (!session || !business) return NextResponse.json({ error: "login_required" }, { status: 401 });
  const db = await ready();
  const data = await exportMyData(db, business.id);
  await db.logEvent(business.id, "account.exported", {});
  return new NextResponse(JSON.stringify({ ...data, signedInAs: session.email }, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="vidalo-${business.slug}.json"`,
      "cache-control": "no-store",
    },
  });
}
