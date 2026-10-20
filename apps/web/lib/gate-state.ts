import { cookies } from "next/headers";
import { PREVIEW_COOKIE } from "@vidalo/core/shared/gate";
import { env } from "@/lib/env";

/**
 * True while the launch gate is on and this browser has no preview cookie:
 * the visitor sees /binnenkort, so site features that belong to the open
 * product (the website assistant) stay off, on every page.
 */
export async function behindGate(): Promise<boolean> {
  if (!env.comingSoon) return false;
  return (await cookies()).get(PREVIEW_COOKIE)?.value !== "1";
}

/** The same test for a route handler, from the request's own Cookie header. */
export function requestBehindGate(req: Request): boolean {
  if (!env.comingSoon) return false;
  return !new RegExp(`(?:^|;\\s*)${PREVIEW_COOKIE}=1(?:;|$)`).test(req.headers.get("cookie") ?? "");
}
