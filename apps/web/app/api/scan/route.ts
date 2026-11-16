import { NextResponse } from "next/server";
import { copyFor } from "@vidalo/core/copy";
import { localizeHref } from "@/lib/lang-paths";
import { langFromReferer } from "@/lib/request-lang";
import { env } from "@/lib/env";
import { ready } from "@/lib/db";
import { resolveBusiness, prepareBusiness, parseQuery, unlistedCandidate, type BusinessCandidate } from "@/lib/core";
import { requestBehindGate } from "@/lib/gate-state";
import { TURNSTILE_FIELD, clientIp, identityMatches, identityText, parseBusinessIdentity, parseTypedWebsite, typedBusinessProblem } from "@vidalo/core/shared";
import { passesTurnstile, kiesToken } from "@/lib/turnstile";
import { CHECK_COOKIE, CHECK_COOKIE_OPTIONS, checkCookieValue, checkFromCookie } from "@/lib/free-check";
import { parseFreeCheckRequest } from "@vidalo/core/shared";
import { freeCheckRefusal, startFreeCheck } from "@/lib/free-check-start";
import { getSession } from "@/lib/session";
import { CONFIRM_MAILS_PER_ADDRESS, FREE_CHECK_LOCK, confirmAddressEvent, dayStart } from "@vidalo/core/shared";
import type { BusinessRecord } from "@/lib/db";
import { requestConfirmation } from "@/lib/scan-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Input = { q: string; pick: number | null; unlisted: boolean; place: string | null; form: FormData; email: unknown; marketing: unknown; website: unknown; identity: unknown };

async function readInput(req: Request): Promise<Input> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = (await req.json()) as { q?: string; pick?: number; unlisted?: string; place?: string; email?: string; marketing?: string; website?: string; identity?: string; [TURNSTILE_FIELD]?: string };
    const form = new FormData();
    if (typeof body[TURNSTILE_FIELD] === "string") form.set(TURNSTILE_FIELD, body[TURNSTILE_FIELD]);
    return { q: String(body.q ?? "").trim(), pick: typeof body.pick === "number" ? body.pick : null, unlisted: body.unlisted === "1", place: body.place?.trim() || null, form, email: body.email, marketing: body.marketing, website: body.website, identity: body.identity };
  }
  const form = await req.formData();
  const pick = form.get("pick");
  const place = String(form.get("place") ?? "").trim();
  return { q: String(form.get("q") ?? "").trim(), pick: pick != null && pick !== "" ? Number(pick) : null, unlisted: form.get("unlisted") === "1", place: place || null, form, email: form.get("email"), marketing: form.get("marketing"), website: form.get("website"), identity: form.get("identity") };
}

/**
 * POST /api/scan  (q=<name>, email=<address>, identity=<postcode + house number or website>[, marketing=ja][, place=<plaats>][, pick=<candidate index> | unlisted=1][, website=<own website>])
 * Resolves the business. A candidate is taken without a click only when the typed postcode + house
 * number or website matches it exactly (shared/business-identity.ts), never on the name: Google answers
 * a name it does not know with the nearest one it does. Otherwise /scan/kies, where the visitor picks by
 * full address or says the business is not listed. Then prepares business + provisional facts + prompts and mails the
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
  const { q, pick, unlisted: saysUnlisted, place: placeInput, form, email, marketing, website, identity: typedIdentity } = await readInput(req);
  const copy = copyFor(lang);
  if (!q) return NextResponse.redirect(to("/?fout=leeg#controle"), 303);
  // Length and markup limits on what was typed, before anything that costs money (security S-04). The place can ride in the name ("Sonable, Rotterdam").
  if (typedBusinessProblem(q, placeInput ?? parseQuery(q).place)) return NextResponse.redirect(to("/?fout=leeg#controle"), 303);
  // The address: from this post, or from the cookie the first post set (the pick page's forms carry none).
  const asked = email != null && String(email).trim() !== "" ? parseFreeCheckRequest({ email, marketing }) : null;
  const cookie = checkFromCookie(req);
  // Only the address and the news box: the identity stays out of everything that is stored (QA-06).
  const requester = asked?.ok ? asked : asked === null && cookie ? { email: cookie.email, marketing: cookie.marketing } : null;
  const backToField = (fout: string) => {
    const p = placeInput ?? parseQuery(q).place;
    return NextResponse.redirect(to(`/scan/kies?q=${encodeURIComponent(q)}${p ? `&place=${encodeURIComponent(p)}` : ""}&fout=${fout}`), 303);
  };
  // No usable address: back to the field, before the bot check and the lookup (nothing spent).
  if (!requester) return backToField("mail");
  // The postcode + house number or website: from this post, or from the cookie the first post set.
  const typed = typedIdentity != null && String(typedIdentity).trim() !== "";
  const identity = parseBusinessIdentity(typed ? typedIdentity : cookie?.identity);
  // A choice on /scan/kies (a candidate, or "not listed") needs none; anything else does, before anything is spent.
  const chose = pick != null || saysUnlisted;
  if ((typed || !chose) && !identity) return backToField("herken");
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
  // "Not listed" checks the business as typed: no lookup to pay for (SEC-03).
  const candidates = saysUnlisted ? [] : await resolveBusiness(parsed.query, place);
  // The pick page looks the business up again; the token says this visitor passed the check.
  const k = kiesToken(q, place ?? "");
  const kies = to(`/scan/kies?q=${encodeURIComponent(q)}${place ? `&place=${encodeURIComponent(place)}` : ""}${k ? `&k=${encodeURIComponent(k)}` : ""}`);
  // The pick page keeps the address in the cookie; its forms post without one.
  const withCookie = (res: NextResponse) => {
    res.cookies.set(CHECK_COOKIE, checkCookieValue({ ...requester, identity: identity ? identityText(identity) : null }), CHECK_COOKIE_OPTIONS);
    return res;
  };
  let candidate: BusinessCandidate | undefined;
  if (saysUnlisted) candidate = unlistedCandidate(parsed.query, place ?? undefined);
  else if (pick != null) candidate = candidates[pick];
  else if (identity) {
    // Never the name alone: exactly one candidate with this postcode + house number or website.
    const hits = candidates.filter((c) => identityMatches(c, identity));
    if (hits.length === 1) candidate = hits[0];
    // Nothing listed at all, and a website given: the business is that website (ADR-0007).
    else if (identity.kind === "website" && candidates.length === 1 && !candidates[0]!.placeId && !candidates[0]!.website && !candidates[0]!.kvk) candidate = candidates[0];
  }
  if (!candidate) return withCookie(NextResponse.redirect(kies, 303));
  // A business Google does not list: the website the visitor gave, on /scan/kies or as the identity.
  const unlisted = !candidate.placeId && !candidate.website;
  // What the visitor typed is checked here, before anything is stored or fetched; a refusal goes back next to the field and the value is never echoed.
  let typedWebsite: string | null = null;
  if (unlisted) {
    const parsed = parseTypedWebsite(website);
    if (!parsed.ok) return withCookie(NextResponse.redirect(`${kies}&fout=website&kandidaat=${saysUnlisted ? "geen" : (pick ?? 0)}`, 303));
    typedWebsite = parsed.url ?? (identity?.kind === "website" ? identity.url : null);
  }
  const finalPlace = candidate.place ?? place;
  if (!finalPlace) return withCookie(NextResponse.redirect(`${kies}&plaats=1`, 303));

  const { business } = await prepareBusiness({ name: candidate.name, place: finalPlace, candidate, website: typedWebsite });

  // Signed in with this very address: the sign-in link already proved it, so the check starts now,
  // under the same lock and caps as a confirmed link. Any other address gets a link, and only that
  // link starts the check. The address is done travelling: the cookie goes.
  const next = (await provenBySession(requester.email)) ? await startSignedIn(req, business, requester, lang) : await requestConfirmation(req, business, requester, lang);
  const res = NextResponse.redirect(to(next), 303);
  res.cookies.set(CHECK_COOKIE, "", { ...CHECK_COOKIE_OPTIONS, maxAge: 0 });
  return res;
}

/** True when a visitor is signed in and the check's address is the sign-in's own address (proven by the sign-in link). */
async function provenBySession(email: string): Promise<boolean> {
  const session = await getSession();
  return !!session && session.email.trim().toLowerCase() === email.trim().toLowerCase();
}

/**
 * The signed-in start: under the lock, and with the same daily allowance per address as the mail link
 * (CONFIRM_MAILS_PER_ADDRESS), so one account cannot run more checks a day than one mailbox could.
 */
async function startSignedIn(req: Request, business: BusinessRecord, requester: { email: string; marketing: boolean }, lang: "nl" | "en"): Promise<string> {
  const db = await ready();
  const addrEvent = confirmAddressEvent(requester.email);
  return db.withLock(FREE_CHECK_LOCK, async () => {
    if (env.realEngines && (await db.countEventsSince(addrEvent, dayStart())) >= CONFIRM_MAILS_PER_ADDRESS) {
      await db.logEvent(null, "scan.refused", { reason: "address_cap", at: "signed_in" });
      return "/scan/druk";
    }
    const next = await startFreeCheck(req, business, requester, lang, "signed_in");
    if (env.realEngines && next !== "/scan/druk") await db.logEvent(null, addrEvent, {});
    return next;
  });
}

export async function GET(req: Request) {
  const copy = copyFor(langFromReferer(req));
  return NextResponse.json({ ok: true, stages: ["understand", "choose", "ask", "compare", "done"], note: copy.scan.waiting });
}
