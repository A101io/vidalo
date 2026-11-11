import { NextResponse } from "next/server";
import { env } from "@/lib/env";

/**
 * Older sign-in links (before 22 Oct 2026) and the address-change link land here. Nothing is
 * used up on a GET (ADR-0003): the same query goes to the confirm page on this site, whose
 * button signs in.
 */
export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL(`/auth/confirm${new URL(req.url).search}`, env.baseUrl), 303);
  res.headers.set("cache-control", "no-store");
  res.headers.set("referrer-policy", "no-referrer");
  return res;
}
