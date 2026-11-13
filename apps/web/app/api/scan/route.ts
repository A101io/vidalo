import { NextResponse } from "next/server";
import { copyFor } from "@vidalo/core/copy";
import { localizeHref } from "@/lib/lang-paths";
import { langFromReferer } from "@/lib/request-lang";
import { env } from "@/lib/env";
import { ready } from "@/lib/db";
import { resolveBusiness, prepareBusiness, parseQuery, type BusinessCandidate } from "@/lib/core";
import { requestBehindGate } from "@/lib/gate-state";
import { TURNSTILE_FIELD, clientIp, parseTypedWebsite, typedBusinessProblem } from "@vidalo/core/shared";
import { passesTurnstile, kiesToken } from "@/lib/turnstile";
import { CHECK_COOKIE, CHECK_COOKIE_OPTIONS, checkCookieValue, checkFromCookie } from "@/lib/free-check";
import { parseFreeCheckRequest } from "@vidalo/core/shared";
import { freeCheckRefusal } from "@/lib/free-check-start";
import { requestConfirmation } from "@/lib/scan-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readInput(req: Request): Promise<{ q: string; pick: number | null; place: string | null; form: FormData; email: unknown; marketing: unknown; website: unknown }> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = (await req.json()) as { q?: string; pick?: number; place?: string; email?: string; marketing?: string; website?: string; [TURNSTILE_FIELD]?: string };
    const form = new FormData();
    if (typeof body[TURNSTILE_FIELD] === "string") form.set(TURNSTILE_FIELD, body[TURNSTILE_FIELD]);
    return { q: String(body.q ?? "").trim(), pick: typeof body.pick === "number" ? body.pick : null, place: body.place?.trim() || null, form, email: body.email, marketing: body.marketing, website: body.website };
  }
  const form = await req.formData();
  const pick = form.get("pick");
  const place = String(form.get("place") ?? "").trim();
  return { q: String(form.get("q") ?? "").trim(), pick: pick != null && pick !== "" ? Number(pick) : null, place: place || null, form, email: form.get("email"), marketing: form.get("marketing"), website: form.get("website") };
}

/**
 * POST /api/scan  (q=<name or website>, email=<address>[, marketing=ja][, place=<plaats>][, pick=<candidate index>][, website=<own website>])
 * Resolves the business; with several candidates (or none / no place) redirects to
 * /scan/kies; otherwise prepares business + provisional facts + prompts and mails the
 * address a link that starts the check (core/shared/scan-confirm.ts, lib/scan-confirm.ts):
 * nothing that costs AI calls runs before the address is confirmed. Without an address
 * nothing runs (shared/free-check.ts); between the form and the pick page the address
 * rides in the signed cookie, not in the URL.
 */
export async function POST(req: Request) {
  const lang = langFromReferer(req);
  // Redirects land on pages in the language the form was posted from.
  const base = env.baseUrl;
  const to = (path: string) => `${base}${localizeHref(path, lang)}`;
  // While the launch gate is on, only a browser with the preview cookie may start a check.
  // The gate hides the scan form, but a direct POST would otherwise still spend engine and
  // Places calls before launch. Checked before anything else, the lookup included.
  if (requestBehindGate(req)) return NextResponse.redirect(to("/binnenkort"), 303);
  const { q, pick, place: placeInput, form, email, marketing, website } = await readInput(req);
  const copy = copyFor(lang);
  if (!q) return NextResponse.redirect(to("/?fout=leeg#controle"), 303);
  // Length and markup limits on what was typed, before anything that costs money (security S-04). The place can ride in the name ("Sonable, Rotterdam").
  if (typedBusinessProblem(q, placeInput ?? parseQuery(q).place)) return NextResponse.redirect(to("/?fout=leeg#controle"), 303);
  // The address: from this post, or from the cookie the first post set (the pick page's forms carry none).
  const asked = email != null && String(email).trim() !== "" ? parseFreeCheckRequest({ email, marketing }) : null;
  const requester = asked?.ok ? asked : asked === null ? checkFromCookie(req) : null;
  // No usable address: back to the field, before the bot check and the lookup (nothing spent).
  if (!requester) {
    const p = placeInput ?? parseQuery(q).place;
    return NextResponse.redirect(to(`/scan/kies?q=${encodeURIComponent(q)}${p ? `&place=${encodeURIComponent(p)}` : ""}&fout=mail`), 303);
  }
  // Bot check before the Places lookup: every post past this line can cost money.
  if (!(await passesTurnstile(form, clientIp(req)))) return NextResponse.redirect(to("/scan/druk?check=1"), 303);
  // The daily cap and this visitor's allowance, before the Places lookup: a visitor who cannot start a check costs nothing.
  const refusal = await freeCheckRefusal(req);
  if (refusal) {
    await (await ready()).logEvent(null, "scan.refused", { reason: refusal, at: "form" });
    return NextResponse.redirect(to("/scan/druk"), 303);
  }

  const parsed = parseQuery(q);
  const place = placeInput ?? parsed.place;
  const candidates = await resolveBusiness(parsed.query, place);
  // The pick page looks the business up again; the token says this visitor passed the check.
  const k = kiesToken(q, place ?? "");
  const kies = to(`/scan/kies?q=${encodeURIComponent(q)}${place ? `&place=${encodeURIComponent(place)}` : ""}${k ? `&k=${encodeURIComponent(k)}` : ""}`);
  // The pick page keeps the address in the cookie; its forms post without one.
  const withCookie = (res: NextResponse) => {
    res.cookies.set(CHECK_COOKIE, checkCookieValue(requester), CHECK_COOKIE_OPTIONS);
    return res;
  };
  if (candidates.length === 0) return withCookie(NextResponse.redirect(kies, 303));

  let candidate: BusinessCandidate | undefined;
  if (candidates.length === 1) candidate = candidates[0];
  else if (pick != null && candidates[pick]) candidate = candidates[pick];
  if (!candidate) return withCookie(NextResponse.redirect(kies, 303));
  // A business Google does not list: the website is asked for on /scan/kies (ADR-0007), the only place it is. A first post (no pick) goes there.
  const unlisted = !candidate.placeId && !candidate.website;
  if (unlisted && pick == null) return withCookie(NextResponse.redirect(kies, 303));
  // What the visitor typed is checked here, before anything is stored or fetched; a refusal goes back next to the field and the value is never echoed.
  let typedWebsite: string | null = null;
  if (unlisted) {
    const parsed = parseTypedWebsite(website);
    if (!parsed.ok) return withCookie(NextResponse.redirect(`${kies}&fout=website&kandidaat=${pick ?? 0}`, 303));
    typedWebsite = parsed.url;
  }
  const finalPlace = candidate.place ?? place;
  if (!finalPlace) return withCookie(NextResponse.redirect(`${kies}&plaats=1`, 303));

  const { business } = await prepareBusiness({ name: candidate.name, place: finalPlace, candidate, website: typedWebsite });

  // The address is not proven yet: it gets a link, and only that link starts the check.
  // The address is done travelling: the cookie goes.
  const next = await requestConfirmation(req, business, requester, lang);
  const res = NextResponse.redirect(to(next), 303);
  res.cookies.set(CHECK_COOKIE, "", { ...CHECK_COOKIE_OPTIONS, maxAge: 0 });
  return res;
}

export async function GET(req: Request) {
  const copy = copyFor(langFromReferer(req));
  return NextResponse.json({ ok: true, stages: ["understand", "choose", "ask", "compare", "done"], note: copy.scan.waiting });
}
