import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { fromUrl } from "@/lib/lang-paths";
import { authCookieOptions, forceAuthOptions, isAuthCookieName, NO_STORE } from "@/lib/auth-cookies";
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
 *
 * The Supabase session is refreshed here (feature 002, ADR-0002): a server
 * component cannot save a refreshed token, so before this every page after the
 * first hour refreshed with the same refresh token until Supabase saw the reuse
 * and revoked the session. No database here and no core import beyond the gate.
 */
export async function middleware(req: NextRequest) {
  const fromPath = fromUrl(req.nextUrl.pathname);
  // On Cloudflare (OpenNext) a rewrite runs the middleware a second time, on
  // the rewritten Dutch route: without this the second pass sets "nl" over the
  // first pass's "en". A visitor sending the header themselves only changes
  // the language of their own page.
  const prior = req.headers.get("x-vidalo-lang");
  const keep = fromPath.lang === "nl" && prior === "en" && req.headers.get("x-vidalo-route") === fromPath.route;
  const { lang, route: asked } = keep ? { lang: "en" as const, route: fromPath.route } : fromPath;
  const route = gateRoute(asked, { comingSoon: process.env.VIDALO_COMING_SOON === "1", preview: req.cookies.get(PREVIEW_COOKIE)?.value === "1" });

  const refreshed = await refreshSession(req);

  // Built after the refresh, so the page renders with the new tokens and never refreshes again with the old one.
  const headers = new Headers(req.headers);
  headers.set("x-vidalo-lang", lang);
  headers.set("x-vidalo-route", route);
  if (refreshed) headers.set("cookie", req.cookies.getAll().map((c) => `${c.name}=${c.value}`).join("; "));
  let res: NextResponse;
  if ((lang === "nl" || keep) && route === asked) {
    res = NextResponse.next({ request: { headers } });
  } else {
    const url = req.nextUrl.clone();
    url.pathname = route;
    res = NextResponse.rewrite(url, { request: { headers } });
  }
  if (refreshed) {
    for (const c of refreshed.cookies) res.cookies.set(c.name, c.value, forceAuthOptions(c.options));
    for (const [k, v] of Object.entries(refreshed.headers)) res.headers.set(k, v);
    // F-018: never cached, whatever the page would have said.
    if (!/no-store/.test(res.headers.get("cache-control") ?? "")) res.headers.set("cache-control", NO_STORE);
  }
  return res;
}

type Pending = { cookies: { name: string; value: string; options?: Record<string, unknown> }[]; headers: Record<string, string> };

/**
 * When the browser carries a Supabase cookie: let Supabase refresh an expired
 * access token. Returns the cookies (and the no-cache headers) to write, or
 * null when nothing changed. A failure leaves the request as it came.
 */
async function refreshSession(req: NextRequest): Promise<Pending | null> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url?.trim() || !anonKey?.trim()) return null;
  if (!req.cookies.getAll().some((c) => isAuthCookieName(c.name))) return null;
  const pending: Pending = { cookies: [], headers: {} };
  const supabase = createServerClient(url.trim(), anonKey.trim(), {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list, headers) => {
        for (const c of list) {
          if (c.value === "" || c.options?.maxAge === 0) req.cookies.delete(c.name);
          else req.cookies.set(c.name, c.value);
        }
        pending.cookies.push(...list);
        Object.assign(pending.headers, headers ?? {});
      },
    },
  });
  try {
    // getSession refreshes a token within 90 s of expiry (auth-js EXPIRY_MARGIN_MS). Refresh earlier
    // here, so the page's own client (same 90 s rule, no way to save a cookie) never finds a token in
    // that window during rendering: its refresh would be lost and the next request would reuse the
    // old refresh token, which Supabase answers by revoking the session. Trust is not decided here:
    // getSession() in lib/session.ts verifies the claims.
    const { data } = await supabase.auth.getSession();
    const expiresAt = data.session?.expires_at;
    if (expiresAt && expiresAt * 1000 - Date.now() < REFRESH_AHEAD_MS) await supabase.auth.refreshSession();
  } catch {
    // Supabase unreachable: the page treats the visitor as signed out; nothing to write.
  }
  return pending.cookies.length ? pending : null;
}

/** Refresh this long before expiry: 30 s more than auth-js's own 90 s margin, the time a page has to render. */
const REFRESH_AHEAD_MS = 120_000;

export const config = {
  // Pages only: not the API, Next's own files, or files with an extension.
  matcher: ["/((?!api/|_next/|.*\\.[a-z0-9]+$).*)"],
};
