import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { localizeHref } from "@/lib/lang-paths";
import { COMING_SOON_ROUTE, PREVIEW_COOKIE } from "@vidalo/core/shared/gate";

export const runtime = "nodejs";

const COOKIE = { httpOnly: true, sameSite: "lax" as const, path: "/" };

/** GET → what the preview bar needs to know: is the gate on, and does this browser bypass it. */
export async function GET(req: Request) {
  const preview = /(?:^|;\s*)vidalo_preview=1(?:;|$)/.test(req.headers.get("cookie") ?? "");
  return NextResponse.json({ comingSoon: env.comingSoon, preview }, { headers: { "cache-control": "no-store" } });
}

/** Same length and same bytes, compared without stopping at the first difference. */
function sameKey(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * POST → set or clear the preview cookie, then go to the site or back to
 * /binnenkort. Setting it needs the key (VIDALO_PREVIEW_KEY, a Worker secret);
 * there is no public button any more (removed 18 Oct 2026), so the gate is a gate.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const lang = String(form.get("lang") ?? "nl") === "en" ? "en" : "nl";
  const page = (route: string) => `${env.baseUrl}${localizeHref(route, lang)}`;
  if (String(form.get("action") ?? "") === "uit") {
    const res = NextResponse.redirect(page(COMING_SOON_ROUTE), 303);
    res.cookies.set(PREVIEW_COOKIE, "", { ...COOKIE, maxAge: 0 });
    return res;
  }
  const key = String(form.get("key") ?? "");
  const expected = env.previewKey;
  const allowed = !!expected && key.length > 0 && sameKey(key, expected);
  if (!allowed) return NextResponse.redirect(page(COMING_SOON_ROUTE), 303);
  const res = NextResponse.redirect(page("/"), 303);
  // A session cookie: closing the browser ends the preview (copy.legal.cookies says so).
  res.cookies.set(PREVIEW_COOKIE, "1", COOKIE);
  return res;
}
