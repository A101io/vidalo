import { NextResponse, type NextRequest } from "next/server";
import { fromUrl } from "@/lib/lang-paths";
import { gateRoute, PREVIEW_COOKIE } from "@vidalo/core/shared/gate";

/**
 * /en/... is the same page in English: rewrite to the Dutch route and tell
 * the page which language to render (x-vidalo-lang) and which route it is
 * (x-vidalo-route, for hreflang and the language switch).
 *
 * Next.js 16 renamed this convention to `proxy`, but a proxy always runs on the
 * Node.js runtime, which OpenNext on Cloudflare calls experimental and does not
 * maintain (build warning, 22 Oct 2026). `middleware` keeps the edge runtime,
 * the path OpenNext supports; Next only prints a deprecation notice. Move to
 * `proxy` once OpenNext supports it on Cloudflare.
 *
 * The launch gate (core/shared/gate.ts) sits on the same rewrite: while
 * VIDALO_COMING_SOON=1 the marketing routes render /binnenkort, unless the
 * browser carries the preview cookie.
 */
export function middleware(req: NextRequest) {
  const fromPath = fromUrl(req.nextUrl.pathname);
  // On Cloudflare (OpenNext) a rewrite runs the middleware a second time, on
  // the rewritten Dutch route: without this the second pass sets "nl" over the
  // first pass's "en". A visitor sending the header themselves only changes
  // the language of their own page.
  const prior = req.headers.get("x-vidalo-lang");
  const keep = fromPath.lang === "nl" && prior === "en" && req.headers.get("x-vidalo-route") === fromPath.route;
  const { lang, route: asked } = keep ? { lang: "en" as const, route: fromPath.route } : fromPath;
  const route = gateRoute(asked, { comingSoon: process.env.VIDALO_COMING_SOON === "1", preview: req.cookies.get(PREVIEW_COOKIE)?.value === "1" });
  const headers = new Headers(req.headers);
  headers.set("x-vidalo-lang", lang);
  headers.set("x-vidalo-route", route);
  if ((lang === "nl" || keep) && route === asked) return NextResponse.next({ request: { headers } });
  const url = req.nextUrl.clone();
  url.pathname = route;
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  // Pages only: not the API, Next's own files, or files with an extension.
  matcher: ["/((?!api/|_next/|.*\\.[a-z0-9]+$).*)"],
};
