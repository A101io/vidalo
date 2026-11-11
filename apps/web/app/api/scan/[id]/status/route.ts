import { NextResponse } from "next/server";
import { ready } from "@/lib/db";
import { getScanState } from "@/lib/core";
import { scanStatusBody } from "@vidalo/core/scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/scan/[token]/status → { status, stage, profile, questions, engines, reportUrl }
 * Exactly these fields (02-architecture.md "Waiting-room state"): never the stored error text,
 * never the business id or scan run id beyond the report path of a finished scan.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await ready();
  const state = await getScanState(id);
  if (!state) return NextResponse.json({ status: "missing" }, { status: 404, headers: { "cache-control": "no-store" } });
  return NextResponse.json(
    scanStatusBody(state),
    { headers: { "cache-control": "no-store" } },
  );
}
