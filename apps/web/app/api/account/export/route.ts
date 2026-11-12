import { NextResponse } from "next/server";
import { isBusinessId, streamMyData } from "@vidalo/core/shared";
import { ready } from "@/lib/db";
import { getSession } from "@/lib/session";
import { listMyBusinesses } from "@/lib/active-business";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });

/**
 * GET /api/account/export?business=<uuid>: everything Vidalo keeps about that business and this
 * login, as a JSON download (feature 002, ADR-0006). Only for a business this login is a member
 * of: another login's, an unknown or a malformed id all get the same 404, and nothing is written
 * about them. Streamed in pages, without access keys (core/shared/export-stream.ts).
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return json({ error: "login_required" }, 401);
  const id = new URL(req.url).searchParams.get("business") ?? "";
  const business = isBusinessId(id) ? ((await listMyBusinesses(session)).find((b) => b.id === id) ?? null) : null;
  if (!business) return json({ error: "not_found" }, 404);
  const db = await ready();
  await db.logEvent(business.id, "account.exported", {});
  return new NextResponse(streamMyData(db, business.id, { signedInAs: session.email, userId: session.userId }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="vidalo-${business.slug}.json"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
