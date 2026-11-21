/**
 * Feature 006: which (line, market) runs belong to a business's month. One place for the cron, the scan handler and the
 * report wait, so they cannot disagree. Counts and ids only.
 */
import { productLineAccess, scannableLineMarkets } from "@vidalo/core/shared";
import { getDb } from "./compat.js";

/** The active lines x markets, within today's limits, for a business that may have lines; empty otherwise. */
export async function listProductLines(businessId: string) {
  const db = getDb();
  const business = await db.getBusiness(businessId);
  if (!business || !productLineAccess(business, business.ownerUserId).ok) return [];
  return scannableLineMarkets(await db.listProductLines(businessId));
}

/** The shape the report job carries. */
export async function expectedLineRuns(businessId: string): Promise<{ productLineId: string; market: string }[]> {
  return (await listProductLines(businessId)).map((l) => ({ productLineId: l.productLineId, market: l.market }));
}
