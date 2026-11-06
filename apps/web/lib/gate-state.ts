import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { PREVIEW_COOKIE, PREVIEW_TOKEN_LABEL, samePreviewToken } from "@vidalo/core/shared/gate";
import { env } from "@/lib/env";

/** The preview cookie's value for the current key (core/shared/gate.ts previewToken, with node:crypto); null without a key. */
export function currentPreviewToken(): string | null {
  const key = env.previewKey;
  return key ? createHmac("sha256", key).update(PREVIEW_TOKEN_LABEL).digest("hex") : null;
}

/** The preview cookie from a Cookie header. */
export function previewCookieOf(header: string | null): string | undefined {
  return new RegExp(`(?:^|;\\s*)${PREVIEW_COOKIE}=([^;]*)`).exec(header ?? "")?.[1];
}

/**
 * True while the launch gate is on and this browser has no valid preview cookie:
 * the visitor sees /binnenkort, so site features that belong to the open
 * product (the website assistant) stay off, on every page.
 */
export async function behindGate(): Promise<boolean> {
  if (!env.comingSoon) return false;
  return !samePreviewToken((await cookies()).get(PREVIEW_COOKIE)?.value, currentPreviewToken());
}

/** The same test for a route handler, from the request's own Cookie header. */
export function requestBehindGate(req: Request): boolean {
  if (!env.comingSoon) return false;
  return !samePreviewToken(previewCookieOf(req.headers.get("cookie")), currentPreviewToken());
}
